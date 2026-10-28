import { useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { useCandleFeed } from '../hooks/useCandleFeed';
import { INTERVAL_SECONDS } from '../utils/chartSync';
import { initialAnchor, normalizePercent, ratioPoints, ratioPrecision } from '../utils/compare';
import { fmtPct } from '../utils/format';

export const COLOR_A = '#4c8dff';
export const COLOR_B = '#f0b90b';
const COLOR_RATIO = '#b07cff';

const INITIAL_VISIBLE = 120; // bars in the first view
const LOAD_THRESHOLD = 30;   // load older history when this close to the left edge
const MAX_GAP_BARS = 2000;
const REBASE_DELAY_MS = 300; // wait for the drag to settle before re-basing to 0%

const baseOf = (s) => s.replace(/USDT$/, '');
const pctFormat = { type: 'custom', minMove: 0.01, formatter: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` };

const fmtTime = (sec, interval) =>
  new Date(sec * 1000).toLocaleString(
    [],
    interval === '1d'
      ? { month: 'short', day: 'numeric', year: 'numeric' }
      : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
  );

const findAt = (arr, t) => {
  for (let i = arr.length - 1; i >= Math.max(0, arr.length - 4); i -= 1) {
    if (arr[i].time === t) return arr[i];
    if (arr[i].time < t) break;
  }
  return null;
};

const signClass = (v) => (v >= 0 ? 'pos' : 'neg');

export default function CompareChart({
  symbolA,
  symbolB,
  interval,
  metric,        // 'percent' | 'ratio'
  autoRebase,    // percent mode: re-base to 0% at the left edge of the view after dragging
  rebaseTick,    // increments when the user presses "Rebase to view"
  paused,
  pollMs = 2000,
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef({ a: null, b: null });
  const zeroLineRef = useRef(null);
  const feedsRef = useRef({});
  const anchorRef = useRef(0);               // time where both lines are 0%
  const baseRef = useRef({ a: null, b: null });
  const needsInitialRef = useRef(true);      // next render() should also set the first view
  const rafRef = useRef(0);
  const rebaseTimerRef = useRef(0);
  const metricRef = useRef(metric);
  const autoRef = useRef(autoRebase);
  const intervalRef = useRef(interval);
  metricRef.current = metric;
  autoRef.current = autoRebase;
  intervalRef.current = interval;

  const [last, setLast] = useState(null);
  const [hover, setHover] = useState(null);

  // ---------- draw everything from the two candle arrays ----------
  const render = () => {
    const chart = chartRef.current;
    const { a: sa, b: sb } = seriesRef.current;
    if (!chart || !sa) return;

    const A = feedsRef.current.a?.dataRef.current ?? [];
    const B = feedsRef.current.b?.dataRef.current ?? [];
    if (A.length === 0 || B.length === 0) {
      sa.setData([]);
      sb.setData([]);
      baseRef.current = { a: null, b: null };
      setLast(null);
      return;
    }

    const initial = needsInitialRef.current;
    if (initial) anchorRef.current = initialAnchor(A, B, INITIAL_VISIBLE);

    if (metricRef.current === 'percent') {
      const na = normalizePercent(A, anchorRef.current);
      const nb = normalizePercent(B, anchorRef.current);
      sa.setData(na.points);
      sb.setData(nb.points);
      baseRef.current = { a: na.base, b: nb.base };
      setLast({ a: na.points.at(-1)?.value, b: nb.points.at(-1)?.value, anchor: anchorRef.current });
    } else {
      const pts = ratioPoints(A, B);
      sa.setData(pts);
      sb.setData([]);
      const v = pts.at(-1)?.value;
      if (v !== undefined) {
        const precision = ratioPrecision(v);
        sa.applyOptions({ priceFormat: { type: 'price', precision, minMove: 10 ** -precision } });
      }
      setLast({ r: v });
    }

    if (initial) {
      needsInitialRef.current = false;
      try {
        chart.timeScale().setVisibleRange({
          from: anchorRef.current,
          to: Math.max(A.at(-1).time, B.at(-1).time),
        });
      } catch {
        chart.timeScale().fitContent();
      }
    }
  };

  const scheduleRender = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      render();
    });
  };

  // ---------- cheap path for live ticks: update only the last point ----------
  const applyLive = (which) => {
    const { a: sa, b: sb } = seriesRef.current;
    if (!sa) return false;
    const A = feedsRef.current.a?.dataRef.current ?? [];
    const B = feedsRef.current.b?.dataRef.current ?? [];

    try {
      if (metricRef.current === 'percent') {
        const c = (which === 'a' ? A : B).at(-1);
        const base = baseRef.current[which];
        if (!c || !base) return false;
        const value = (c.close / base - 1) * 100;
        (which === 'a' ? sa : sb).update({ time: c.time, value });
        setLast((prev) => (prev ? { ...prev, [which]: value } : prev));
        return true;
      }

      const t = (which === 'a' ? A : B).at(-1)?.time;
      if (t === undefined) return false;
      const ca = findAt(A, t);
      const cb = findAt(B, t);
      if (!ca || !cb) return true; // the other coin has not delivered this candle yet
      const value = ca.close / cb.close;
      sa.update({ time: t, value });
      setLast({ r: value });
      return true;
    } catch {
      return false; // e.g. "cannot update oldest data" -> fall back to a full render
    }
  };

  const handleChange = (which, kind) => {
    if (kind === 'reset' || kind === 'initial') needsInitialRef.current = true;
    if (kind === 'live' && applyLive(which)) return;
    scheduleRender();
  };

  // ---------- re-base to 0% at the left edge of what the user is looking at ----------
  const rebaseToView = (force = false) => {
    const chart = chartRef.current;
    if (!chart || metricRef.current !== 'percent') return;
    const range = chart.timeScale().getVisibleRange();
    if (!range) return;
    const left = Number(range.from);
    if (!force && Math.abs(left - anchorRef.current) < INTERVAL_SECONDS[intervalRef.current]) return;
    anchorRef.current = left;
    render();
  };

  const scheduleRebase = () => {
    if (!autoRef.current) return;
    clearTimeout(rebaseTimerRef.current);
    rebaseTimerRef.current = setTimeout(() => rebaseToView(false), REBASE_DELAY_MS);
  };

  const maybeLoadOlder = () => {
    const r = chartRef.current?.timeScale().getVisibleLogicalRange();
    if (r && r.from < LOAD_THRESHOLD && r.from > -MAX_GAP_BARS) {
      feedsRef.current.a?.loadOlder();
      feedsRef.current.b?.loadOlder();
    }
  };

  // ---------- create the chart once ----------
  useEffect(() => {
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#9aa4b2' },
      grid: { vertLines: { color: '#1f2733' }, horzLines: { color: '#1f2733' } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2a3446', rightOffset: 3 },
      rightPriceScale: { borderColor: '#2a3446', scaleMargins: { top: 0.14, bottom: 0.08 } },
      crosshair: { mode: 0 },
    });
    const lineOptions = { lineWidth: 2, priceLineVisible: false, crosshairMarkerRadius: 4 };
    const sa = chart.addLineSeries({ ...lineOptions, color: COLOR_A, priceFormat: pctFormat });
    const sb = chart.addLineSeries({ ...lineOptions, color: COLOR_B, priceFormat: pctFormat });
    chartRef.current = chart;
    seriesRef.current = { a: sa, b: sb };

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      maybeLoadOlder();
      scheduleRebase();
    });

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setHover(null);
        return;
      }
      setHover({ a: param.seriesData.get(sa)?.value, b: param.seriesData.get(sb)?.value, time: param.time });
    });

    return () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      clearTimeout(rebaseTimerRef.current);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = { a: null, b: null };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- the two candle feeds ----------
  const feedA = useCandleFeed(symbolA, interval, { paused, pollMs, onChange: (k) => handleChange('a', k) });
  const feedB = useCandleFeed(symbolB, interval, { paused, pollMs, onChange: (k) => handleChange('b', k) });
  feedsRef.current = { a: feedA, b: feedB };

  // ---------- % change <-> ratio ----------
  useEffect(() => {
    const { a: sa, b: sb } = seriesRef.current;
    if (!sa) return;
    if (zeroLineRef.current) {
      sa.removePriceLine(zeroLineRef.current);
      zeroLineRef.current = null;
    }
    if (metric === 'percent') {
      sa.applyOptions({ color: COLOR_A, priceFormat: pctFormat });
      sb.applyOptions({ visible: true });
      zeroLineRef.current = sa.createPriceLine({
        price: 0, color: '#3a4558', lineWidth: 1, lineStyle: 2, axisLabelVisible: false,
      });
    } else {
      sa.applyOptions({ color: COLOR_RATIO });
      sb.applyOptions({ visible: false });
    }
    setHover(null);
    scheduleRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric]);

  useEffect(() => { if (rebaseTick) rebaseToView(true); }, [rebaseTick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (autoRebase) rebaseToView(false); }, [autoRebase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- legend ----------
  const baseA = baseOf(symbolA);
  const baseB = baseOf(symbolB);
  const shown = hover ?? last;
  const loading = !feedA.loaded || !feedB.loaded;
  const loadingOlder = feedA.loadingOlder || feedB.loadingOlder;

  let legend = null;
  if (shown) {
    if (metric === 'percent') {
      const spread = shown.a !== undefined && shown.b !== undefined ? shown.a - shown.b : undefined;
      legend = (
        <>
          <span className="lg"><i style={{ background: COLOR_A }} />{baseA}
            <b className={shown.a === undefined ? '' : signClass(shown.a)}>{shown.a === undefined ? '—' : fmtPct(shown.a)}</b>
          </span>
          <span className="lg"><i style={{ background: COLOR_B }} />{baseB}
            <b className={shown.b === undefined ? '' : signClass(shown.b)}>{shown.b === undefined ? '—' : fmtPct(shown.b)}</b>
          </span>
          {spread !== undefined && (
            <span className="lg">Gap <b className={signClass(spread)}>{spread >= 0 ? '+' : ''}{spread.toFixed(2)} pp</b></span>
          )}
          <span className="lg since">
            {hover ? fmtTime(hover.time, interval) : last?.anchor ? `since ${fmtTime(last.anchor, interval)}` : ''}
          </span>
        </>
      );
    } else {
      const r = hover ? hover.a : last?.r;
      legend = (
        <>
          <span className="lg"><i style={{ background: COLOR_RATIO }} />{baseA}/{baseB}
            <b>{r === undefined ? '—' : r.toLocaleString('en-US', { maximumSignificantDigits: 6 })}</b>
          </span>
          {hover && <span className="lg since">{fmtTime(hover.time, interval)}</span>}
        </>
      );
    }
  }

  return (
    <div className="compare-wrap">
      <div ref={containerRef} className="chart" />
      {legend && <div className="legend">{legend}</div>}
      {(loading || loadingOlder) && (
        <div className="chart-loading">{loading ? 'Loading data…' : 'Loading older data…'}</div>
      )}
    </div>
  );
}

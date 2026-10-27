import { useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { fetchKlines } from '../api';
import { usePolling } from '../hooks/usePolling';
import { INTERVAL_SECONDS, logicalToTime, timeToLogical } from '../utils/chartSync';

const INITIAL_LIMIT = 300;   // candles loaded first
const HISTORY_LIMIT = 500;   // candles loaded per "drag to the past"
const LOAD_THRESHOLD = 30;   // start loading when this many bars (or fewer) remain on the left
const MAX_GAP_BARS = 2000;   // don't chain-load history when the view is further than this left of the data
const INITIAL_VISIBLE = 120; // bars shown on first load
const SYNC_EPSILON = 0.05;   // ignore sync updates smaller than this (in bars) -> prevents ping-pong
const ERROR_COOLDOWN_MS = 5000; // pause history loading after a failed request (no retry storm)
const MAX_CATCHUP_BARS = 900;  // away longer than this (tab hidden / chart off-screen) -> reload instead of patching

export default function PriceChart({ id, symbol, interval, pollMs = 2000, sync = null, paused = false }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  const dataRef = useRef([]);            // all candles currently on the chart (ascending)
  const loadedRef = useRef(false);       // initial history loaded?
  const lastTimeRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const noMoreRef = useRef(false);       // reached the start of exchange history
  const errorUntilRef = useRef(0);       // history loading is paused until this time after an error
  const olderCtrlRef = useRef(null);
  const paramsRef = useRef({ symbol, interval });
  const syncRef = useRef(sync);
  const [loadingOlder, setLoadingOlder] = useState(false);

  paramsRef.current = { symbol, interval };
  syncRef.current = sync;

  // ---------- timeline sync helpers (all state lives in refs, so they are safe to call from anywhere) ----------
  const getTimeRange = () => {
    const chart = chartRef.current;
    const data = dataRef.current;
    if (!chart || data.length === 0) return null;
    const r = chart.timeScale().getVisibleLogicalRange();
    if (!r) return null;
    const step = INTERVAL_SECONDS[paramsRef.current.interval];
    return { from: logicalToTime(data, r.from, step), to: logicalToTime(data, r.to, step) };
  };

  const setTimeRange = ({ from, to }) => {
    const chart = chartRef.current;
    const data = dataRef.current;
    if (!chart || data.length === 0) return;
    const step = INTERVAL_SECONDS[paramsRef.current.interval];
    const desired = { from: timeToLogical(data, from, step), to: timeToLogical(data, to, step) };
    const cur = chart.timeScale().getVisibleLogicalRange();
    if (
      cur &&
      Math.abs(cur.from - desired.from) < SYNC_EPSILON &&
      Math.abs(cur.to - desired.to) < SYNC_EPSILON
    ) {
      return; // already showing this window
    }
    chart.timeScale().setVisibleLogicalRange(desired);
  };

  // ---------- load older candles and prepend them ----------
  const loadOlder = async () => {
    if (loadingOlderRef.current || noMoreRef.current || !loadedRef.current) return;
    if (Date.now() < errorUntilRef.current) return;
    const first = dataRef.current[0];
    if (!first) return;

    const { symbol: sym, interval: itv } = paramsRef.current;
    const sameChart = () =>
      paramsRef.current.symbol === sym && paramsRef.current.interval === itv;

    const ctrl = new AbortController();
    olderCtrlRef.current = ctrl;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    let failed = false;

    try {
      const older = await fetchKlines(
        { symbol: sym, interval: itv, limit: HISTORY_LIMIT, endTime: first.time * 1000 - 1 },
        ctrl.signal
      );
      if (!sameChart() || !seriesRef.current) return;

      const fresh = older.filter((c) => c.time < dataRef.current[0].time);
      if (fresh.length === 0) {
        noMoreRef.current = true;
        return;
      }
      if (older.length < HISTORY_LIMIT) noMoreRef.current = true;

      dataRef.current = [...fresh, ...dataRef.current];
      seriesRef.current.setData(dataRef.current); // view stays anchored to the right edge
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(err);
        failed = true;
        errorUntilRef.current = Date.now() + ERROR_COOLDOWN_MS;
      }
    } finally {
      if (sameChart()) {
        loadingOlderRef.current = false;
        setLoadingOlder(false);
        if (!failed) maybeLoadOlder(); // user (or the synced chart) may still be at the left edge
      }
    }
  };

  const maybeLoadOlder = () => {
    const range = chartRef.current?.timeScale().getVisibleLogicalRange();
    if (range && range.from < LOAD_THRESHOLD && range.from > -MAX_GAP_BARS) loadOlder();
  };

  // ---------- create the chart once ----------
  useEffect(() => {
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#9aa4b2' },
      grid: { vertLines: { color: '#1f2733' }, horzLines: { color: '#1f2733' } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2a3342' },
      rightPriceScale: { borderColor: '#2a3342' },
      crosshair: { mode: 0 },
    });
    const series = chart.addCandlestickSeries({
      upColor: '#16c784',
      downColor: '#ea3943',
      wickUpColor: '#16c784',
      wickDownColor: '#ea3943',
      borderVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    // fires on drag / zoom / scroll
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      maybeLoadOlder();
      syncRef.current?.broadcast(id); // no-op when sync is off
    });

    return () => {
      olderCtrlRef.current?.abort();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- join the sync group ----------
  useEffect(() => {
    if (!sync) return undefined;
    return sync.register(id, { getTimeRange, setTimeRange });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, id]);

  // ---------- drop everything that was loaded ----------
  const resetData = () => {
    olderCtrlRef.current?.abort();
    loadedRef.current = false;
    loadingOlderRef.current = false;
    noMoreRef.current = false;
    errorUntilRef.current = 0;
    lastTimeRef.current = 0;
    dataRef.current = [];
    setLoadingOlder(false);
    seriesRef.current?.setData([]);
  };

  // ---------- symbol / timeframe changed -> reset everything ----------
  useEffect(() => {
    resetData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval]);

  // ---------- interval fetch: full history once, then only the latest 2 candles ----------
  usePolling(
    async (signal) => {
      // Normally only the last 2 candles are needed. After the tab was hidden or the chart was
      // off-screen we may be several candles behind: ask for exactly the missing ones (no holes).
      let limit = INITIAL_LIMIT;
      if (loadedRef.current) {
        const behind = Math.ceil((Date.now() / 1000 - lastTimeRef.current) / INTERVAL_SECONDS[interval]) + 1;
        if (behind > MAX_CATCHUP_BARS) resetData(); // too far behind -> start again with fresh history
        else limit = Math.max(2, behind);
      }
      const candles = await fetchKlines({ symbol, interval, limit }, signal);
      if (signal.aborted || !seriesRef.current) return;

      if (!loadedRef.current) {
        dataRef.current = candles;
        seriesRef.current.setData(candles);
        lastTimeRef.current = candles.at(-1)?.time ?? 0;
        loadedRef.current = true;

        // Line up with the other chart when sync is on, otherwise show the latest bars
        const peer = syncRef.current?.peek(id);
        if (peer) {
          setTimeRange(peer);
        } else {
          const n = candles.length;
          chartRef.current.timeScale().setVisibleLogicalRange({
            from: Math.max(0, n - INITIAL_VISIBLE),
            to: n + 5,
          });
        }
        return;
      }

      for (const c of candles) {
        if (c.time < lastTimeRef.current) continue;
        seriesRef.current.update(c);
        lastTimeRef.current = c.time;

        // keep our local copy in sync so a later setData() (history prepend) keeps live candles
        const arr = dataRef.current;
        if (arr.length && arr[arr.length - 1].time === c.time) arr[arr.length - 1] = c;
        else arr.push(c);
      }
    },
    paused ? null : pollMs, // null = no polling while the chart is off-screen
    [symbol, interval]
  );

  return (
    <div className="chart-wrap">
      <div ref={containerRef} className="chart" />
      {loadingOlder && <div className="chart-loading">Loading older data…</div>}
    </div>
  );
}

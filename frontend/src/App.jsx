import { useEffect, useRef, useState } from 'react';
import { fetchPrices } from './api';
import { usePolling } from './hooks/usePolling';
import { createChartSync } from './utils/chartSync';
import ChartPanel from './components/ChartPanel';
import PriceTable from './components/PriceTable';
import LazySearchBox from './components/LazySearchBox';

const DEFAULT_WATCHLIST = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT'];
const MAX_WATCHLIST = 20; // matches the backend limit for /api/prices
const WATCHLIST_KEY = 'crypto-chart:watchlist:v1';
const VIEW_KEY = 'crypto-chart:view:v1';
const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];
const TICKER_POLL_MS = 3000;
const CHART_POLL_MS = 2000;

function loadWatchlist() {
  try {
    const saved = JSON.parse(localStorage.getItem(WATCHLIST_KEY));
    if (
      Array.isArray(saved) &&
      saved.length > 0 &&
      saved.every((s) => typeof s === 'string' && /^[A-Z0-9]{5,15}$/.test(s))
    ) {
      return saved.slice(0, MAX_WATCHLIST);
    }
  } catch {
    /* ignore corrupted / unavailable storage */
  }
  return DEFAULT_WATCHLIST;
}

function loadView() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY));
    return { mode: v?.mode === 'dual' ? 'dual' : 'single', sync: v?.sync !== false };
  } catch {
    return { mode: 'single', sync: true };
  }
}

export default function App() {
  const [watchlist, setWatchlist] = useState(loadWatchlist);
  const [tickers, setTickers] = useState({}); // symbol -> ticker
  const [symbols, setSymbols] = useState(() => {
    const w = loadWatchlist();
    return [w[0], w[1] ?? w[0]]; // coin shown in chart 1 and chart 2
  });
  const [mode, setMode] = useState(() => loadView().mode); // 'single' | 'dual'
  const [syncOn, setSyncOn] = useState(() => loadView().sync);
  const [active, setActive] = useState(0); // chart that receives watchlist / search picks
  const [interval, setIntervalValue] = useState('1m');
  const [status, setStatus] = useState('connecting'); // connecting | live | error
  const [updatedAt, setUpdatedAt] = useState(null);

  const dual = mode === 'dual';
  const watchKey = watchlist.join(',');

  const syncHolder = useRef(null);
  if (!syncHolder.current) syncHolder.current = createChartSync();
  const chartSync = syncHolder.current;

  const activeRef = useRef(active);
  activeRef.current = active;

  // ---- persistence ----
  useEffect(() => {
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
    } catch {
      /* storage may be unavailable */
    }
  }, [watchlist]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ mode, sync: syncOn }));
    } catch {
      /* storage may be unavailable */
    }
  }, [mode, syncOn]);

  // ---- timeline sync on/off (when turned on, line the other chart up with the active one) ----
  useEffect(() => {
    const enabled = syncOn && dual;
    chartSync.setEnabled(enabled);
    if (enabled) chartSync.broadcast(activeRef.current);
  }, [syncOn, dual, chartSync]);

  // ---- a chart's coin was removed from the watchlist -> replace it ----
  useEffect(() => {
    setSymbols((prev) => {
      if (prev.every((s) => watchlist.includes(s))) return prev;
      const kept = prev.map((s) => (watchlist.includes(s) ? s : null));
      return kept.map((s) => s ?? watchlist.find((w) => !kept.includes(w)) ?? watchlist[0]);
    });
  }, [watchlist]);

  // ---- interval fetch for prices (restarts when the watchlist changes) ----
  usePolling(
    async (signal) => {
      try {
        const data = await fetchPrices(watchlist, signal);
        setTickers(Object.fromEntries(data.map((t) => [t.symbol, t])));
        setStatus('live');
        setUpdatedAt(new Date());

        // Drop symbols the exchange no longer lists (e.g. delisted coins from an old saved list)
        const returned = new Set(data.map((t) => t.symbol));
        const missing = watchlist.filter((s) => !returned.has(s));
        if (missing.length && data.length) {
          setWatchlist((w) => w.filter((s) => !missing.includes(s)));
        } else if (!data.length && watchKey !== DEFAULT_WATCHLIST.join(',')) {
          setWatchlist(DEFAULT_WATCHLIST);
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        setStatus('error');
      }
    },
    TICKER_POLL_MS,
    [watchKey]
  );

  // ---- actions ----
  const assignSymbol = (index, sym) =>
    setSymbols((prev) => prev.map((s, i) => (i === index ? sym : s)));

  const setViewMode = (next) => {
    setMode(next);
    if (next === 'single') {
      setActive(0);
    } else {
      // make sure the two charts start with different coins
      setSymbols(([a, b]) => (a !== b ? [a, b] : [a, watchlist.find((s) => s !== a) ?? a]));
    }
  };

  // Load a searched coin into a chart (default: the selected one) and add it to the watchlist
  const addCoin = (coin, index = active) => {
    assignSymbol(index, coin.symbol);
    setActive(index);
    setWatchlist((w) => (w.includes(coin.symbol) || w.length >= MAX_WATCHLIST ? w : [...w, coin.symbol]));
  };

  const removeCoin = (sym) => setWatchlist((w) => (w.length > 1 ? w.filter((s) => s !== sym) : w));

  const panelIds = dual ? [0, 1] : [0];

  return (
    <div className="app">
      <header className="topbar">
        <h1>Crypto Live</h1>
        {!dual && <LazySearchBox watchlist={watchlist} max={MAX_WATCHLIST} onPick={addCoin} />}
        <div className={`status ${status}`}>
          <span className="dot" />
          {status === 'live' && `Live · ${updatedAt?.toLocaleTimeString()}`}
          {status === 'connecting' && 'Connecting…'}
          {status === 'error' && 'Reconnecting…'}
        </div>
      </header>

      <main className={`layout ${dual ? 'dual-layout' : ''}`}>
        <section className="panel main">
          <div className="toolbar">
            <div className="seg" role="group" aria-label="View mode">
              <button className={!dual ? 'on' : ''} onClick={() => setViewMode('single')}>Single</button>
              <button className={dual ? 'on' : ''} onClick={() => setViewMode('dual')}>Dual</button>
            </div>

            {dual && (
              <button
                className={`sync ${syncOn ? 'on' : ''}`}
                aria-pressed={syncOn}
                title="Link horizontal scroll and zoom of both charts"
                onClick={() => setSyncOn((v) => !v)}
              >
                <span className="knob" />
                Sync timeline <b>{syncOn ? 'ON' : 'OFF'}</b>
              </button>
            )}

            <div className="tabs">
              {INTERVALS.map((i) => (
                <button key={i} className={i === interval ? 'on' : ''} onClick={() => setIntervalValue(i)}>
                  {i}
                </button>
              ))}
            </div>
          </div>

          {dual && (
            <div className="hint">
              Use the search box on each chart to change its coin. Clicking a watchlist row loads it into the selected chart.
            </div>
          )}

          <div className={`charts ${dual ? 'dual' : ''}`}>
            {panelIds.map((i) => (
              <ChartPanel
                key={i}
                id={i}
                symbol={symbols[i]}
                tickers={tickers}
                watchlist={watchlist}
                maxWatchlist={MAX_WATCHLIST}
                interval={interval}
                dual={dual}
                active={active === i}
                sync={chartSync}
                pollMs={CHART_POLL_MS}
                onActivate={setActive}
                onPickCoin={addCoin}
              />
            ))}
          </div>
        </section>

        <aside className="panel side">
          <PriceTable
            rows={watchlist.map((s) => tickers[s]).filter(Boolean)}
            selected={panelIds.map((i) => symbols[i])}
            onSelect={(sym) => assignSymbol(active, sym)}
            onRemove={removeCoin}
          />
        </aside>
      </main>
    </div>
  );
}

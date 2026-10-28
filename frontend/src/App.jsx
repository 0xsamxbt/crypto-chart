import { useEffect, useRef, useState } from 'react';
import { fetchPrices } from './api';
import { usePolling } from './hooks/usePolling';
import { createChartSync } from './utils/chartSync';
import { fmtPrice } from './utils/format';
import ChartPanel from './components/ChartPanel';
import LazySearchBox from './components/LazySearchBox';
import MarketStats from './components/MarketStats';
import Watchlist from './components/Watchlist';

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

const IconSingle = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <rect x="1.5" y="2.5" width="11" height="9" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);
const IconDual = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <rect x="1.5" y="2.5" width="4.6" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <rect x="7.9" y="2.5" width="4.6" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);
const BrandMark = () => (
  <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="9" fill="#151c28" stroke="#2a3446" />
    <path d="M10 8v16M16 6v14M22 11v15" stroke="#8b97a8" strokeWidth="1.8" strokeLinecap="round" />
    <rect x="7.5" y="12" width="5" height="8" rx="1.2" fill="#16c784" />
    <rect x="13.5" y="9" width="5" height="7" rx="1.2" fill="#ea3943" />
    <rect x="19.5" y="15" width="5" height="7" rx="1.2" fill="#16c784" />
  </svg>
);

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

  // ---- browser tab title shows the price of the first chart ----
  const lead = tickers[symbols[0]];
  useEffect(() => {
    document.title = lead
      ? `${symbols[0].replace(/USDT$/, '')} $${fmtPrice(lead.price)} · Crypto Live`
      : 'Crypto Live';
  }, [lead, symbols]);

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
  const rows = watchlist.map((s) => tickers[s]).filter(Boolean);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <BrandMark />
            <div>
              <h1>Crypto Live</h1>
              <small>Real-time market charts</small>
            </div>
          </div>

          {!dual && <LazySearchBox watchlist={watchlist} max={MAX_WATCHLIST} onPick={addCoin} />}

          <div className={`status ${status}`} role="status">
            <span className="dot" />
            {status === 'live' && `Live · ${updatedAt?.toLocaleTimeString()}`}
            {status === 'connecting' && 'Connecting…'}
            {status === 'error' && 'Reconnecting…'}
          </div>
        </div>
      </header>

      <div className="app">
        <MarketStats rows={rows} onSelect={(sym) => assignSymbol(active, sym)} />

        <main className={`layout ${dual ? 'dual-layout' : ''}`}>
          <section className="panel main" aria-label="Price chart">
            <div className="toolbar">
              <div className="seg" role="group" aria-label="View mode">
                <button type="button" className={!dual ? 'on' : ''} onClick={() => setViewMode('single')}>
                  <IconSingle /> Single
                </button>
                <button type="button" className={dual ? 'on' : ''} onClick={() => setViewMode('dual')}>
                  <IconDual /> Dual
                </button>
              </div>

              {dual && (
                <button
                  type="button"
                  className={`sync ${syncOn ? 'on' : ''}`}
                  aria-pressed={syncOn}
                  title="Link horizontal scroll and zoom of both charts"
                  onClick={() => setSyncOn((v) => !v)}
                >
                  <span className="knob" />
                  Sync timeline <b>{syncOn ? 'ON' : 'OFF'}</b>
                </button>
              )}

              <div className="seg accent tabs" role="group" aria-label="Timeframe">
                {INTERVALS.map((i) => (
                  <button key={i} type="button" className={i === interval ? 'on' : ''} onClick={() => setIntervalValue(i)}>
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

          <aside className="panel side" aria-label="Watchlist">
            <Watchlist
              rows={rows}
              count={watchlist.length}
              max={MAX_WATCHLIST}
              selected={panelIds.map((i) => symbols[i])}
              status={status}
              onSelect={(sym) => assignSymbol(active, sym)}
              onRemove={removeCoin}
            />
          </aside>
        </main>

        <footer className="footer">
          Market data from Binance, cached for all users. Prices are informational, not financial advice.
        </footer>
      </div>
    </div>
  );
}

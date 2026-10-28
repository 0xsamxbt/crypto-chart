import { lazy, Suspense, useEffect, useState } from 'react';
import CoinIcon from './CoinIcon';
import LazySearchBox from './LazySearchBox';
import ChartSkeleton from './ChartSkeleton';
import { useInView } from '../hooks/useInView';
import { usePriceFlash } from '../hooks/usePriceFlash';
import { fmtPrice } from '../utils/format';

const loadCompareChart = () => import('./CompareChart');
const CompareChart = lazy(loadCompareChart);

const COLORS = ['#4c8dff', '#f0b90b']; // must match COLOR_A / COLOR_B in CompareChart
const baseOf = (symbol) => symbol.replace(/USDT$/, '');

function CoinBlock({ slot, symbol, ticker, active, watchlist, maxWatchlist, onActivate, onPickCoin }) {
  const base = baseOf(symbol);
  const flash = usePriceFlash(ticker?.price, symbol);

  return (
    <div
      className={`coin-block ${active ? 'active' : ''}`}
      style={{ '--slot-color': COLORS[slot] }}
      onMouseDown={() => onActivate(slot)}
    >
      <div className="head-main">
        <CoinIcon base={base} image={ticker?.image} size={38} />
        <div className="head-text">
          <div className="pair">
            <span className="coin-title">{ticker?.name && ticker.name !== base ? ticker.name : base}</span>
            <span className="sym">{base} / USDT</span>
          </div>
          <div className="price-row">
            <span className={`big tick-${flash}`}>{ticker ? `$${fmtPrice(ticker.price)}` : '—'}</span>
            {ticker && (
              <span className={`badge ${ticker.change >= 0 ? 'up' : 'down'}`}>
                {ticker.change >= 0 ? '▲' : '▼'} {Math.abs(ticker.change).toFixed(2)}%
              </span>
            )}
          </div>
        </div>
      </div>
      <LazySearchBox
        compact
        watchlist={watchlist}
        max={maxWatchlist}
        onPick={(coin) => onPickCoin(coin, slot)}
      />
    </div>
  );
}

export default function ComparePanel({
  symbols,
  tickers,
  watchlist,
  maxWatchlist,
  interval,
  active,
  pollMs,
  onActivate,
  onPickCoin,
  onSwap,
}) {
  const [metric, setMetric] = useState('percent'); // 'percent' | 'ratio'
  const [autoRebase, setAutoRebase] = useState(true);
  const [rebaseTick, setRebaseTick] = useState(0);

  // same lazy strategy as the single chart: code downloads early, data only when near the screen
  const [slotRef, inView] = useInView('300px');
  const [seen, setSeen] = useState(false);
  useEffect(() => { loadCompareChart(); }, []);
  useEffect(() => { if (inView) setSeen(true); }, [inView]);

  const [a, b] = symbols;

  return (
    <div className="compare">
      <div className="compare-head">
        <CoinBlock
          slot={0} symbol={a} ticker={tickers[a]} active={active === 0}
          watchlist={watchlist} maxWatchlist={maxWatchlist} onActivate={onActivate} onPickCoin={onPickCoin}
        />
        <button type="button" className="swap" onClick={onSwap} title="Swap coins" aria-label="Swap coins">⇄</button>
        <CoinBlock
          slot={1} symbol={b} ticker={tickers[b]} active={active === 1}
          watchlist={watchlist} maxWatchlist={maxWatchlist} onActivate={onActivate} onPickCoin={onPickCoin}
        />
      </div>

      <div className="compare-tools">
        <div className="seg small" role="group" aria-label="Comparison metric">
          <button type="button" className={metric === 'percent' ? 'on' : ''} onClick={() => setMetric('percent')}>
            % change
          </button>
          <button type="button" className={metric === 'ratio' ? 'on' : ''} onClick={() => setMetric('ratio')}>
            Ratio {baseOf(a)}/{baseOf(b)}
          </button>
        </div>

        {metric === 'percent' && (
          <>
            <label className="check">
              <input type="checkbox" checked={autoRebase} onChange={(e) => setAutoRebase(e.target.checked)} />
              Rebase on drag
            </label>
            {!autoRebase && (
              <button type="button" className="btn-ghost" onClick={() => setRebaseTick((t) => t + 1)}>
                Rebase to view
              </button>
            )}
          </>
        )}

        <span className="tool-hint">
          {metric === 'percent'
            ? 'Both lines start at 0% at the left edge of the view, so you can see which coin did better.'
            : `How many ${baseOf(b)} one ${baseOf(a)} is worth, over time.`}
        </span>
      </div>

      <div ref={slotRef} className="chart-slot">
        {seen ? (
          <Suspense fallback={<ChartSkeleton />}>
            <CompareChart
              symbolA={a}
              symbolB={b}
              interval={interval}
              metric={metric}
              autoRebase={autoRebase}
              rebaseTick={rebaseTick}
              paused={!inView}
              pollMs={pollMs}
            />
          </Suspense>
        ) : (
          <ChartSkeleton />
        )}
      </div>
    </div>
  );
}

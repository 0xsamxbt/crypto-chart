import { lazy, Suspense, useEffect, useState } from 'react';
import LazySearchBox from './LazySearchBox';
import CoinIcon from './CoinIcon';
import { useInView } from '../hooks/useInView';
import { usePriceFlash } from '../hooks/usePriceFlash';
import { fmtCompact, fmtPrice } from '../utils/format';
import ChartSkeleton from './ChartSkeleton';

// The chart library (lightweight-charts) is the heaviest dependency: it gets its own chunk
const loadPriceChart = () => import('./PriceChart');
const PriceChart = lazy(loadPriceChart);

const baseOf = (symbol) => symbol.replace(/USDT$/, '');

export default function ChartPanel({
  id,
  symbol,
  tickers,
  watchlist,
  maxWatchlist,
  interval,
  dual,
  active,
  sync,
  pollMs,
  onActivate,
  onPickCoin,
}) {
  const ticker = tickers[symbol];
  const base = baseOf(symbol);
  const flash = usePriceFlash(ticker?.price, symbol);

  // Start downloading the chart code right away, but only create the chart (and start fetching
  // candles) once the panel is near the screen. Off-screen again -> polling pauses.
  const [slotRef, inView] = useInView('300px');
  const [seen, setSeen] = useState(false);
  useEffect(() => { loadPriceChart(); }, []);
  useEffect(() => { if (inView) setSeen(true); }, [inView]);

  return (
    <div
      className={`chart-card ${dual ? 'dual-card' : ''} ${dual && active ? 'active' : ''}`}
      onMouseDown={() => onActivate(id)}
    >
      <div className="head">
        <div className="head-main">
          <CoinIcon base={base} image={ticker?.image} size={dual ? 40 : 48} />
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

        {dual && (
          <LazySearchBox
            compact
            watchlist={watchlist}
            max={maxWatchlist}
            onPick={(coin) => onPickCoin(coin, id)}
          />
        )}
      </div>

      <dl className="stats">
        <div><dt>24h high</dt><dd>{ticker ? fmtPrice(ticker.high) : '—'}</dd></div>
        <div><dt>24h low</dt><dd>{ticker ? fmtPrice(ticker.low) : '—'}</dd></div>
        <div><dt>24h volume</dt><dd>{ticker ? `$${fmtCompact(ticker.volume)}` : '—'}</dd></div>
      </dl>

      <div ref={slotRef} className="chart-slot">
        {seen ? (
          <Suspense fallback={<ChartSkeleton />}>
            <PriceChart
              id={id}
              symbol={symbol}
              interval={interval}
              pollMs={pollMs}
              sync={sync}
              paused={!inView}
            />
          </Suspense>
        ) : (
          <ChartSkeleton />
        )}
      </div>
    </div>
  );
}

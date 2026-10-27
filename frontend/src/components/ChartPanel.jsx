import { lazy, Suspense, useEffect, useState } from 'react';
import LazySearchBox from './LazySearchBox';
import CoinIcon from './CoinIcon';
import { fmtPrice } from './PriceTable';
import { useInView } from '../hooks/useInView';

// The chart library (lightweight-charts) is the heaviest dependency: it gets its own chunk
const loadPriceChart = () => import('./PriceChart');
const PriceChart = lazy(loadPriceChart);

const baseOf = (symbol) => symbol.replace(/USDT$/, '');

function ChartSkeleton() {
  return (
    <div className="chart-skeleton" aria-busy="true">
      <span>Loading chart…</span>
    </div>
  );
}

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
          <CoinIcon base={base} image={ticker?.image} size={dual ? 36 : 44} />
          <div>
            <div className="pair">
              {ticker?.name && ticker.name !== base ? `${ticker.name} · ` : ''}{base} / USDT
            </div>
            <div className="big">{ticker ? `$${fmtPrice(ticker.price)}` : '—'}</div>
            {ticker && (
              <div className={ticker.change >= 0 ? 'pos' : 'neg'}>
                {ticker.change >= 0 ? '+' : ''}{ticker.change.toFixed(2)}% (24h)
              </div>
            )}
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

import CoinIcon from './CoinIcon';
import { fmtCompact, fmtPct } from '../utils/format';

const baseOf = (symbol) => symbol.replace(/USDT$/, '');

function CoinStat({ label, row, onSelect }) {
  const base = baseOf(row.symbol);
  return (
    <button type="button" className="stat-card clickable" onClick={() => onSelect(row.symbol)} title={`Open ${base} chart`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        <CoinIcon base={base} image={row.image} size={26} />
        <span>{base}</span>
        <span className={`badge ${row.change >= 0 ? 'up' : 'down'}`}>{fmtPct(row.change)}</span>
      </div>
      <div className="stat-sub">{row.name && row.name !== base ? row.name : `${base} / USDT`}</div>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="stat-card" aria-hidden="true">
      <div className="skel skel-line short" />
      <div className="skel skel-line" />
      <div className="skel skel-line short" />
    </div>
  );
}

export default function MarketStats({ rows, onSelect }) {
  if (rows.length === 0) {
    return (
      <section className="overview" aria-busy="true" aria-label="Market overview">
        <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
      </section>
    );
  }

  const byChange = [...rows].sort((a, b) => b.change - a.change);
  const gainer = byChange[0];
  const loser = byChange[byChange.length - 1];
  const up = rows.filter((r) => r.change >= 0).length;
  const down = rows.length - up;
  const volume = rows.reduce((sum, r) => sum + r.volume, 0);

  return (
    <section className="overview" aria-label="Market overview">
      <CoinStat label="Top gainer · 24h" row={gainer} onSelect={onSelect} />
      <CoinStat label="Top loser · 24h" row={loser} onSelect={onSelect} />

      <div className="stat-card">
        <div className="stat-label">Market breadth</div>
        <div className="stat-value">
          <span className="pos">{up} up</span>
          <span className="stat-sep">/</span>
          <span className="neg">{down} down</span>
        </div>
        <div className="breadth" role="img" aria-label={`${up} coins up, ${down} down`}>
          <span className="up" style={{ width: `${(up / rows.length) * 100}%` }} />
          <span className="down" style={{ width: `${(down / rows.length) * 100}%` }} />
        </div>
      </div>

      <div className="stat-card">
        <div className="stat-label">24h volume</div>
        <div className="stat-value">${fmtCompact(volume)}</div>
        <div className="stat-sub">across {rows.length} {rows.length === 1 ? 'coin' : 'coins'} in your watchlist</div>
      </div>
    </section>
  );
}

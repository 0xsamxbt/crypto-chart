import CoinIcon from './CoinIcon';
import { usePriceFlash } from '../hooks/usePriceFlash';
import { fmtPct, fmtPrice } from '../utils/format';

function Row({ row, active, canRemove, onSelect, onRemove }) {
  const flash = usePriceFlash(row.price, row.symbol);
  const base = row.symbol.replace(/USDT$/, '');
  const span = row.high - row.low;
  const pos = span > 0 ? Math.min(100, Math.max(0, ((row.price - row.low) / span) * 100)) : 50;

  const onKeyDown = (e) => {
    if (e.target !== e.currentTarget) return; // ignore keys pressed on the remove button
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(row.symbol);
    }
  };

  return (
    <tr
      className={active ? 'active' : ''}
      tabIndex={0}
      aria-current={active ? 'true' : undefined}
      onClick={() => onSelect(row.symbol)}
      onKeyDown={onKeyDown}
    >
      <td>
        <div className="coin-cell">
          <CoinIcon base={base} image={row.image} size={28} />
          <div className="coin-text">
            <div className="coin-base">{base}<span className="quote">/USDT</span></div>
            {row.name && row.name !== base && <div className="coin-name">{row.name}</div>}
          </div>
        </div>
      </td>
      <td className={`num flash-${flash}`}>{fmtPrice(row.price)}</td>
      <td className={`num chg ${row.change >= 0 ? 'pos' : 'neg'}`}>{fmtPct(row.change)}</td>
      <td className="col-range" title={`24h range ${fmtPrice(row.low)} – ${fmtPrice(row.high)}`}>
        <div className="range"><span style={{ left: `${pos}%` }} /></div>
      </td>
      <td className="rm-cell">
        {canRemove && (
          <button
            type="button"
            className="rm"
            title="Remove from watchlist"
            aria-label={`Remove ${base}`}
            onClick={(e) => { e.stopPropagation(); onRemove(row.symbol); }}
          >
            ×
          </button>
        )}
      </td>
    </tr>
  );
}

export default function PriceTable({ rows, selected, onSelect, onRemove }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Coin</th>
          <th className="num">Price</th>
          <th className="num">24h</th>
          <th className="col-range">24h range</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Row
            key={r.symbol}
            row={r}
            active={selected.includes(r.symbol)}
            canRemove={rows.length > 1}
            onSelect={onSelect}
            onRemove={onRemove}
          />
        ))}
      </tbody>
    </table>
  );
}

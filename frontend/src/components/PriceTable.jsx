import { useEffect, useRef, useState } from 'react';
import CoinIcon from './CoinIcon';

export const fmtPrice = (n) =>
  n >= 1
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });

function Row({ row, active, canRemove, onSelect, onRemove }) {
  const prev = useRef(row.price);
  const [flash, setFlash] = useState('');
  const base = row.symbol.replace(/USDT$/, '');

  useEffect(() => {
    if (row.price === prev.current) return undefined;
    setFlash(row.price > prev.current ? 'up' : 'down');
    prev.current = row.price;
    const t = setTimeout(() => setFlash(''), 600);
    return () => clearTimeout(t);
  }, [row.price]);

  return (
    <tr className={active ? 'active' : ''} onClick={() => onSelect(row.symbol)}>
      <td>
        <div className="coin-cell">
          <CoinIcon base={base} image={row.image} size={28} />
          <div>
            <div>{base}<span className="quote">/USDT</span></div>
            {row.name && row.name !== base && <div className="coin-name">{row.name}</div>}
          </div>
        </div>
      </td>
      <td className={`num flash-${flash}`}>{fmtPrice(row.price)}</td>
      <td className={`num ${row.change >= 0 ? 'pos' : 'neg'}`}>
        {row.change >= 0 ? '+' : ''}{row.change.toFixed(2)}%
      </td>
      <td className="rm-cell">
        {canRemove && (
          <button
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
        <tr><th>Pair</th><th className="num">Price</th><th className="num">24h</th><th /></tr>
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

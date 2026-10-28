import { useMemo, useState } from 'react';
import PriceTable from './PriceTable';

const SORTS = [
  { key: 'default', label: 'Default' },
  { key: 'gainers', label: 'Gainers' },
  { key: 'losers', label: 'Losers' },
  { key: 'volume', label: 'Volume' },
];

const SORTERS = {
  default: null,
  gainers: (a, b) => b.change - a.change,
  losers: (a, b) => a.change - b.change,
  volume: (a, b) => b.volume - a.volume,
};

function SkeletonRows() {
  return (
    <div className="skel-rows" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div className="skel-row" key={i}>
          <div className="skel skel-circle" />
          <div className="skel skel-line" />
          <div className="skel skel-line short" />
        </div>
      ))}
    </div>
  );
}

export default function Watchlist({ rows, count, max, selected, status, onSelect, onRemove }) {
  const [sort, setSort] = useState('default');

  const sorted = useMemo(() => {
    const fn = SORTERS[sort];
    return fn ? [...rows].sort(fn) : rows;
  }, [rows, sort]);

  return (
    <>
      <div className="section-head">
        <h2 className="section-title">
          Watchlist <span className="count-pill">{count}/{max}</span>
        </h2>
        <div className="seg small" role="group" aria-label="Sort watchlist">
          {SORTS.map((s) => (
            <button key={s.key} type="button" className={sort === s.key ? 'on' : ''} onClick={() => setSort(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        status === 'error' ? (
          <div className="empty">Can’t reach the server. Retrying…</div>
        ) : (
          <SkeletonRows />
        )
      ) : (
        <div className="watch-scroll">
          <PriceTable rows={sorted} selected={selected} onSelect={onSelect} onRemove={onRemove} />
        </div>
      )}
    </>
  );
}

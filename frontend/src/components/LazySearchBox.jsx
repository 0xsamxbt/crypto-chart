import { lazy, Suspense } from 'react';

// The search UI (and its result list logic) is downloaded in its own chunk
const SearchBox = lazy(() => import('./SearchBox'));

// Same size as the real input, so nothing jumps when the chunk arrives
function SearchFallback({ compact }) {
  return (
    <div className={`search ${compact ? 'compact' : ''}`}>
      <input disabled placeholder={compact ? 'Search coin…' : 'Search coin by name'} aria-label="Search crypto" />
    </div>
  );
}

export default function LazySearchBox(props) {
  return (
    <Suspense fallback={<SearchFallback compact={props.compact} />}>
      <SearchBox {...props} />
    </Suspense>
  );
}

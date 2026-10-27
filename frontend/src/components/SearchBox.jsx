import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSearch } from '../api';
import CoinIcon from './CoinIcon';

const PAGE_SIZE = 20;

export default function SearchBox({ watchlist, max, onPick, compact = false, placeholder }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);          // first page
  const [loadingMore, setLoadingMore] = useState(false);  // next pages
  const [error, setError] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [active, setActive] = useState(0);

  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  const sentinelRef = useRef(null);

  const queryRef = useRef(query);
  const countRef = useRef(0);
  const moreCtrlRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const scrollToActiveRef = useRef(false);
  queryRef.current = query;
  countRef.current = results.length;

  const isFull = watchlist.length >= max;

  // ---- first page (debounced). Empty query = popular coins, shown immediately ----
  useEffect(() => {
    if (!open) return undefined;
    const ctrl = new AbortController();

    moreCtrlRef.current?.abort();
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setMoreError(false);
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const page = await fetchSearch(query, 0, PAGE_SIZE, ctrl.signal);
        setResults(page.items);
        setHasMore(page.hasMore);
        setActive(0);
        setError(false);
        menuRef.current?.scrollTo?.({ top: 0 });
      } catch (err) {
        if (err.name !== 'AbortError') setError(true);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, query ? 250 : 0);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, open]);

  // ---- next page (called when the bottom of the list scrolls into view) ----
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setMoreError(false);

    const ctrl = new AbortController();
    moreCtrlRef.current = ctrl;

    try {
      const page = await fetchSearch(queryRef.current, countRef.current, PAGE_SIZE, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setResults((prev) => {
        const seen = new Set(prev.map((r) => r.symbol));
        return [...prev, ...page.items.filter((r) => !seen.has(r.symbol))];
      });
      setHasMore(page.hasMore);
    } catch (err) {
      if (err.name !== 'AbortError') setMoreError(true);
    } finally {
      if (!ctrl.signal.aborted) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, []);

  // Watch a small element at the end of the list; when it becomes visible, fetch the next page.
  // The observer is re-created after every page, so a tall menu keeps filling until it overflows.
  useEffect(() => {
    const node = sentinelRef.current;
    const root = menuRef.current;
    if (!open || loading || !hasMore || moreError || !node || !root) return undefined;

    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore(); },
      { root, rootMargin: '0px 0px 100px 0px' }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [open, loading, hasMore, moreError, results.length, loadMore]);

  // Keep the keyboard-selected row visible
  useEffect(() => {
    if (!scrollToActiveRef.current) return;
    scrollToActiveRef.current = false;
    menuRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Close when clicking outside
  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const canPick = (coin) => watchlist.includes(coin.symbol) || !isFull;

  const pick = (coin) => {
    if (!canPick(coin)) return;
    onPick(coin);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      scrollToActiveRef.current = true;
      setActive((i) => Math.min(i + 1, results.length - 1));
      if (hasMore && !moreError && active >= results.length - 3) loadMore();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      scrollToActiveRef.current = true;
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (results[active]) pick(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div className={`search ${compact ? 'compact' : ''}`} ref={boxRef}>
      <input
        ref={inputRef}
        value={query}
        placeholder={placeholder ?? (compact ? 'Search coin…' : 'Search coin by name (e.g. bitcoin, pepe, sol)')}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        aria-label="Search crypto"
        autoComplete="off"
        spellCheck={false}
      />

      {open && (
        <div className="search-menu" role="listbox" ref={menuRef}>
          {error && <div className="search-msg">Search unavailable. Please try again.</div>}
          {!error && loading && results.length === 0 && <div className="search-msg">Searching…</div>}
          {!error && !loading && results.length === 0 && <div className="search-msg">No coins found</div>}

          {!error && results.map((coin, i) => {
            const inList = watchlist.includes(coin.symbol);
            const disabled = !canPick(coin);
            return (
              <button
                type="button"
                key={coin.symbol}
                role="option"
                aria-selected={i === active}
                disabled={disabled}
                className={`search-item ${i === active ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
                onMouseEnter={() => { scrollToActiveRef.current = false; setActive(i); }}
                onClick={() => pick(coin)}
              >
                <CoinIcon base={coin.base} image={coin.image} />
                <span className="si-main">
                  <b>{coin.name}</b>
                  <span className="si-sub">{coin.base}/USDT</span>
                </span>
                <span className={`si-tag ${inList ? 'muted' : ''}`}>{inList ? 'In watchlist' : 'Add'}</span>
              </button>
            );
          })}

          {!error && hasMore && (
            <div className="search-more" ref={sentinelRef}>
              {moreError ? (
                <button type="button" onClick={() => loadMore()}>Couldn’t load more · Retry</button>
              ) : loadingMore ? (
                'Loading more…'
              ) : (
                'Scroll for more'
              )}
            </div>
          )}

          {isFull && (
            <div className="search-msg warn">Watchlist is full ({max}). Remove a coin to add another.</div>
          )}
        </div>
      )}
    </div>
  );
}

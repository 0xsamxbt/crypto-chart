import { useEffect, useRef, useState } from 'react';

/**
 * Returns 'up' | 'down' | '' for ~600 ms after the price changes.
 * `key` (e.g. the symbol) resets the comparison, so switching coins does not flash.
 */
export function usePriceFlash(price, key) {
  const prev = useRef({ key, price });
  const [dir, setDir] = useState('');

  useEffect(() => {
    const p = prev.current;
    prev.current = { key, price };

    if (p.key !== key || p.price === undefined || price === undefined || p.price === price) {
      setDir('');
      return undefined;
    }
    setDir(price > p.price ? 'up' : 'down');
    const t = setTimeout(() => setDir(''), 600);
    return () => clearTimeout(t);
  }, [price, key]);

  return dir;
}

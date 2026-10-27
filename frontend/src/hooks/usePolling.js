import { useEffect, useRef } from 'react';

/**
 * Calls `fn(signal)` immediately, then again `delay` ms AFTER the previous call
 * finishes (so requests never overlap). Restarts when `delay` or `deps` change,
 * aborting any in-flight request. Skips work while the tab is hidden.
 */
export function usePolling(fn, delay, deps = []) {
  const saved = useRef(fn);
  saved.current = fn;

  useEffect(() => {
    if (delay == null) return undefined;

    const ctrl = new AbortController();
    let timer;
    let stopped = false;

    const tick = async () => {
      if (!document.hidden) {
        try {
          await saved.current(ctrl.signal);
        } catch (err) {
          if (err.name !== 'AbortError') console.error(err);
        }
      }
      if (!stopped) timer = setTimeout(tick, delay);
    };

    tick();

    return () => {
      stopped = true;
      clearTimeout(timer);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay, ...deps]);
}

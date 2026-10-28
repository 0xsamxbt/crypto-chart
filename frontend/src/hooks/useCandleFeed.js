import { useEffect, useRef, useState } from 'react';
import { fetchKlines } from '../api';
import { usePolling } from './usePolling';
import { INTERVAL_SECONDS } from '../utils/chartSync';

const INITIAL_LIMIT = 300;
const HISTORY_LIMIT = 500;
const ERROR_COOLDOWN_MS = 5000;
const MAX_CATCHUP_BARS = 900;

/**
 * Keeps the candles of ONE coin up to date (initial history, live polling with gap-free catch-up,
 * older history on demand). It does not draw anything: it tells the owner what happened through
 * onChange(kind) with kind = 'reset' | 'initial' | 'live' | 'prepend'.
 * The candles live in dataRef.current (ascending by time).
 */
export function useCandleFeed(symbol, interval, { paused = false, pollMs = 2000, onChange } = {}) {
  const dataRef = useRef([]);
  const loadedRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const noMoreRef = useRef(false);
  const errorUntilRef = useRef(0);
  const ctrlRef = useRef(null);
  const paramsRef = useRef({ symbol, interval });
  const onChangeRef = useRef(onChange);
  const [loaded, setLoaded] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  paramsRef.current = { symbol, interval };
  onChangeRef.current = onChange;

  const emit = (kind) => onChangeRef.current?.(kind);

  const reset = () => {
    ctrlRef.current?.abort();
    loadedRef.current = false;
    loadingOlderRef.current = false;
    noMoreRef.current = false;
    errorUntilRef.current = 0;
    dataRef.current = [];
    setLoaded(false);
    setLoadingOlder(false);
    emit('reset');
  };

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval]);

  const loadOlder = async () => {
    if (loadingOlderRef.current || noMoreRef.current || !loadedRef.current) return;
    if (Date.now() < errorUntilRef.current) return;
    const first = dataRef.current[0];
    if (!first) return;

    const { symbol: sym, interval: itv } = paramsRef.current;
    const same = () => paramsRef.current.symbol === sym && paramsRef.current.interval === itv;

    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    loadingOlderRef.current = true;
    setLoadingOlder(true);

    try {
      const older = await fetchKlines(
        { symbol: sym, interval: itv, limit: HISTORY_LIMIT, endTime: first.time * 1000 - 1 },
        ctrl.signal
      );
      if (!same()) return;

      const fresh = older.filter((c) => c.time < dataRef.current[0].time);
      if (fresh.length === 0) {
        noMoreRef.current = true;
        return;
      }
      if (older.length < HISTORY_LIMIT) noMoreRef.current = true;

      dataRef.current = [...fresh, ...dataRef.current];
      emit('prepend');
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(err);
        errorUntilRef.current = Date.now() + ERROR_COOLDOWN_MS;
      }
    } finally {
      if (same()) {
        loadingOlderRef.current = false;
        setLoadingOlder(false);
      }
    }
  };

  usePolling(
    async (signal) => {
      // Normally 2 candles are enough; after a pause ask for exactly the missing ones (no holes)
      let limit = INITIAL_LIMIT;
      if (loadedRef.current) {
        const lastTime = dataRef.current.at(-1)?.time ?? 0;
        const behind = Math.ceil((Date.now() / 1000 - lastTime) / INTERVAL_SECONDS[interval]) + 1;
        if (behind > MAX_CATCHUP_BARS) reset();
        else limit = Math.max(2, behind);
      }

      const candles = await fetchKlines({ symbol, interval, limit }, signal);
      if (signal.aborted) return;

      if (!loadedRef.current) {
        dataRef.current = candles;
        loadedRef.current = true;
        setLoaded(true);
        emit('initial');
        return;
      }

      const arr = dataRef.current;
      for (const c of candles) {
        const last = arr[arr.length - 1];
        if (last && c.time < last.time) continue;
        if (last && last.time === c.time) arr[arr.length - 1] = c;
        else arr.push(c);
      }
      emit('live');
    },
    paused ? null : pollMs,
    [symbol, interval]
  );

  return { dataRef, loaded, loadingOlder, loadOlder };
}

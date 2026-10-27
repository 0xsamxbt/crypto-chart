// Seconds per candle for every supported timeframe
export const INTERVAL_SECONDS = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

// Index of the last candle whose time <= t (data is sorted ascending)
function floorIndex(data, t) {
  let lo = 0;
  let hi = data.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (data[mid].time <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Chart "logical index" (can be fractional / outside the data) -> unix time.
// Outside the loaded data we extrapolate with the candle length, so blank space on the left
// or right of a chart still maps to a real point on the timeline.
export function logicalToTime(data, i, step) {
  const n = data.length;
  if (i <= 0) return data[0].time + i * step;
  if (i >= n - 1) return data[n - 1].time + (i - (n - 1)) * step;
  const lo = Math.floor(i);
  return data[lo].time + (i - lo) * (data[lo + 1].time - data[lo].time);
}

// unix time -> chart logical index (inverse of the function above)
export function timeToLogical(data, t, step) {
  const n = data.length;
  if (t <= data[0].time) return (t - data[0].time) / step;
  if (t >= data[n - 1].time) return n - 1 + (t - data[n - 1].time) / step;
  const lo = floorIndex(data, t);
  return lo + (t - data[lo].time) / (data[lo + 1].time - data[lo].time);
}

/**
 * Small coordinator shared by the charts. Charts register two functions:
 *   getTimeRange() -> { from, to } | null   (visible time window, unix seconds)
 *   setTimeRange({ from, to })              (show the same window)
 * Syncing by TIME (not by bar index) keeps coins aligned even when one of them
 * was listed years after the other.
 */
export function createChartSync() {
  const members = new Map();
  let enabled = true;
  let applying = false;

  return {
    setEnabled(value) {
      enabled = value;
    },

    register(id, api) {
      members.set(id, api);
      return () => members.delete(id);
    },

    // Copy the visible window of chart `fromId` to every other chart
    broadcast(fromId) {
      if (!enabled || applying) return;
      const range = members.get(fromId)?.getTimeRange();
      if (!range) return;
      applying = true;
      try {
        for (const [id, member] of members) {
          if (id !== fromId) member.setTimeRange(range);
        }
      } finally {
        applying = false;
      }
    },

    // Visible window of any OTHER chart (a freshly loaded chart uses it to line itself up)
    peek(excludeId) {
      if (!enabled) return null;
      for (const [id, member] of members) {
        if (id === excludeId) continue;
        const range = member.getTimeRange();
        if (range) return range;
      }
      return null;
    },
  };
}

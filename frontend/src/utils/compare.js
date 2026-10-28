// first index whose time is >= t (data is sorted ascending); data.length when none
export function lowerBound(data, t) {
  let lo = 0;
  let hi = data.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (data[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * % change of every candle's close relative to the close at `anchor` (first candle at/after it).
 * Candles before the anchor become negative/positive values relative to that same base.
 */
export function normalizePercent(data, anchor) {
  if (data.length === 0) return { points: [], base: null };
  const i = Math.min(lowerBound(data, anchor), data.length - 1);
  const base = data[i].close;
  return {
    points: data.map((c) => ({ time: c.time, value: (c.close / base - 1) * 100 })),
    base,
  };
}

// close(A) / close(B) for every time both coins have a candle
export function ratioPoints(a, b) {
  const closeB = new Map(b.map((c) => [c.time, c.close]));
  const out = [];
  for (const c of a) {
    const d = closeB.get(c.time);
    if (d) out.push({ time: c.time, value: c.close / d });
  }
  return out;
}

// Start of the first view: the later of the two coins' "last N bars" start
export function initialAnchor(a, b, bars) {
  const at = (d) => d[Math.max(0, d.length - bars)].time;
  return Math.max(at(a), at(b));
}

export const ratioPrecision = (v) => (v >= 100 ? 2 : v >= 1 ? 4 : v >= 0.01 ? 6 : 8);

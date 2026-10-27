const BASE = import.meta.env.VITE_API_URL || '/api';

async function getJson(path, params, signal) {
  // drop undefined values so they are not sent as the string "undefined"
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
  const qs = new URLSearchParams(clean).toString();
  const res = await fetch(`${BASE}${path}?${qs}`, { signal });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

const get = async (path, params, signal) => (await getJson(path, params, signal)).data;

export const fetchPrices = (symbols, signal) =>
  get('/prices', { symbols: symbols.join(',') }, signal);

// endTime (ms) is optional: used to load older candles
export const fetchKlines = ({ symbol, interval, limit, endTime }, signal) =>
  get('/klines', { symbol, interval, limit, endTime }, signal);

// One page of search results -> { items, hasMore }
export async function fetchSearch(q, offset, limit, signal) {
  const json = await getJson('/search', { q, offset, limit }, signal);
  return { items: json.data, hasMore: Boolean(json.hasMore) };
}

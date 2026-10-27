const BASE = process.env.BINANCE_BASE_URL || 'https://api.binance.com';

// If Binance answers 429 / 418 we stop calling it until Retry-After has passed.
let blockedUntil = 0;

export async function request(path, timeoutMs = 5000) {
  if (Date.now() < blockedUntil) {
    const err = new Error('Binance rate-limit cooldown');
    err.status = 503;
    throw err;
  }

  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(timeoutMs) });

  if (res.status === 429 || res.status === 418) {
    const retryAfter = Number(res.headers.get('retry-after')) || 30;
    blockedUntil = Date.now() + retryAfter * 1000;
    const err = new Error(`Binance rate limited, retry in ${retryAfter}s`);
    err.status = 503;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Upstream error ${res.status}`);
    err.status = res.status === 400 ? 400 : 502;
    throw err;
  }
  return res.json();
}

// 24h statistics for a list of symbols (one request)
export async function fetchTickers24h(symbols) {
  const q = encodeURIComponent(JSON.stringify(symbols));
  const rows = await request(`/api/v3/ticker/24hr?symbols=${q}`);
  return rows.map((r) => ({
    symbol: r.symbol,
    price: Number(r.lastPrice),
    change: Number(r.priceChangePercent),
    high: Number(r.highPrice),
    low: Number(r.lowPrice),
    volume: Number(r.quoteVolume),
  }));
}

// Candles. Options: limit (max 1000), startTime / endTime in ms
export async function fetchKlinesRaw(symbol, interval, { limit = 1000, startTime, endTime } = {}) {
  let path = `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  if (startTime !== undefined) path += `&startTime=${startTime}`;
  if (endTime !== undefined) path += `&endTime=${endTime}`;

  const rows = await request(path);
  return rows.map((k) => ({
    time: Math.floor(k[0] / 1000), // seconds (what lightweight-charts expects)
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }));
}

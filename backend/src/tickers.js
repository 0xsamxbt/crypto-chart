import { getDb } from './db.js';
import { fetchTickers24h } from './binance.js';

const TTL_MS = Number(process.env.TICKER_TTL_MS) || 1500;  // shared by all users
const STALE_MAX_MS = 5 * 60 * 1000;                         // serve cached prices this long if Binance is down
const FAIL_BACKOFF_MS = 5000;

const tickers = () => getDb().collection('tickers');

const inflight = new Map();  // symbol -> Promise of the request that is refreshing it
const failedUntil = new Map();

async function refresh(symbols) {
  const rows = await fetchTickers24h(symbols);
  const now = Date.now();
  if (rows.length === 0) return;
  await tickers().bulkWrite(
    rows.map((r) => ({
      replaceOne: {
        filter: { _id: r.symbol },
        replacement: { _id: r.symbol, price: r.price, change: r.change, high: r.high, low: r.low, volume: r.volume, updatedAt: now },
        upsert: true,
      },
    })),
    { ordered: false }
  );
}

const toRow = (d) => ({
  symbol: d._id, price: d.price, change: d.change, high: d.high, low: d.low, volume: d.volume,
});

export async function getTickers(symbols) {
  let docs = await tickers().find({ _id: { $in: symbols } }).toArray();
  const now = Date.now();
  const byId = new Map(docs.map((d) => [d._id, d]));

  const stale = symbols.filter((s) => {
    const d = byId.get(s);
    return (!d || now - d.updatedAt > TTL_MS) && now >= (failedUntil.get(s) ?? 0);
  });

  if (stale.length > 0) {
    // symbols already being refreshed by another request are awaited, not requested again
    const waiting = [];
    const toFetch = [];
    for (const s of stale) {
      const running = inflight.get(s);
      if (running) waiting.push(running);
      else toFetch.push(s);
    }

    if (toFetch.length > 0) {
      const p = refresh(toFetch)
        .catch((err) => {
          toFetch.forEach((s) => failedUntil.set(s, Date.now() + FAIL_BACKOFF_MS));
          throw err;
        })
        .finally(() => toFetch.forEach((s) => inflight.delete(s)));
      toFetch.forEach((s) => inflight.set(s, p));
      waiting.push(p);
    }

    const settled = await Promise.allSettled(waiting);
    docs = await tickers().find({ _id: { $in: symbols } }).toArray();

    const failure = settled.find((r) => r.status === 'rejected');
    docs = docs.filter((d) => Date.now() - d.updatedAt < STALE_MAX_MS);
    if (failure && docs.length === 0) throw failure.reason;
  }

  const byIdFinal = new Map(docs.map((d) => [d._id, d]));
  return symbols.filter((s) => byIdFinal.has(s)).map((s) => toRow(byIdFinal.get(s)));
}

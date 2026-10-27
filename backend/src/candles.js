import { getDb } from './db.js';
import { fetchKlinesRaw } from './binance.js';

export const INTERVAL_SECONDS = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

const PAGE = 1000;                                            // Binance max candles per request
const LIVE_TTL_MS = Number(process.env.KLINE_LIVE_TTL_MS) || 1000;
const FAIL_BACKOFF_MS = 5000;                                 // after a Binance error, serve cache for this long
const MAX_CATCHUP_PAGES = 10;                                 // longer downtime than this -> rebuild from scratch
const MAX_BACKFILL_PAGES = 6;                                 // Binance pages fetched for ONE request, at most
const MAX_BACKFILL_GAP_BARS = 3000;                           // refuse to jump further than this into the past
const MAX_SEC = Number.MAX_SAFE_INTEGER;

/*
 * Storage model
 *   candles        one document per candle   { symbol, interval, t, o, h, l, c, v }
 *   candle_ranges  one document per series   { _id: "BTCUSDT:1m", oldest, newest, complete, refreshedAt }
 *
 * Invariant: every candle between `oldest` and `newest` is stored (the range is contiguous).
 *   - closed candles never change, so once stored they are never requested from Binance again
 *   - only the newest (still open) candle is refreshed, at most once per LIVE_TTL_MS for ALL users
 *   - scrolling into the past extends `oldest`; `complete` means the start of the listing was reached
 */

const candles = () => getDb().collection('candles');
const ranges = () => getDb().collection('candle_ranges');

const toDoc = (symbol, interval, c) => ({
  symbol, interval, t: c.time, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume,
});
const fromDoc = (d) => ({ time: d.t, open: d.o, high: d.h, low: d.l, close: d.c, volume: d.v });

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// ---- run async jobs for the same series one after another (also de-duplicates Binance calls) ----
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(() => undefined, () => undefined);
  locks.set(key, tail);
  tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}

// ---- remember recent Binance failures so a down exchange is not hammered ----
const failures = new Map(); // key -> { until, err }
async function guard(key, fn) {
  try {
    const result = await fn();
    failures.delete(key);
    return result;
  } catch (err) {
    if (err.status !== 400 && err.status !== 404) {
      failures.set(key, { until: Date.now() + FAIL_BACKOFF_MS, err });
    }
    throw err;
  }
}

const isFresh = (meta) => Date.now() - meta.refreshedAt < LIVE_TTL_MS;

// ---------- Mongo helpers ----------
async function saveCandles(symbol, interval, list) {
  if (list.length === 0) return;
  await candles().bulkWrite(
    list.map((c) => ({
      replaceOne: {
        filter: { symbol, interval, t: c.time },
        replacement: toDoc(symbol, interval, c),
        upsert: true,
      },
    })),
    { ordered: false }
  );
}

async function readCandles(symbol, interval, endSec, limit) {
  const docs = await candles()
    .find({ symbol, interval, t: { $lte: endSec } }, { projection: { _id: 0 } })
    .sort({ t: -1 })
    .limit(limit)
    .toArray();
  return docs.reverse().map(fromDoc);
}

// ---------- Binance -> Mongo ----------
// First time we see a series: take the latest PAGE candles
async function seed(symbol, interval, key) {
  const batch = await fetchKlinesRaw(symbol, interval, { limit: PAGE });
  if (batch.length === 0) throw httpError(404, 'No candle data');
  await saveCandles(symbol, interval, batch);

  const meta = {
    _id: key,
    symbol,
    interval,
    oldest: batch[0].time,
    newest: batch[batch.length - 1].time,
    complete: batch.length < PAGE, // fewer than PAGE candles exist -> that is the whole history
    refreshedAt: Date.now(),
  };
  await ranges().replaceOne({ _id: key }, meta, { upsert: true });
  return meta;
}

async function reseed(symbol, interval, key) {
  await candles().deleteMany({ symbol, interval });
  await ranges().deleteOne({ _id: key });
  return seed(symbol, interval, key);
}

// Fetch only what is new since the newest stored candle (normally 1-2 candles)
async function refreshLatest(symbol, interval, key, step, meta) {
  let newest = meta.newest;

  for (let page = 0; ; page += 1) {
    const need = Math.min(PAGE, Math.ceil((Date.now() / 1000 - newest) / step) + 2);
    const batch = await fetchKlinesRaw(symbol, interval, { limit: need, startTime: newest * 1000 });
    await saveCandles(symbol, interval, batch);
    if (batch.length) newest = Math.max(newest, batch[batch.length - 1].time);

    if (batch.length < need) break;
    if (page + 1 >= MAX_CATCHUP_PAGES) return reseed(symbol, interval, key); // was offline for too long
  }

  const refreshedAt = Date.now();
  await ranges().updateOne({ _id: key }, { $set: { newest, refreshedAt } });
  return { ...meta, newest, refreshedAt };
}

// Make sure at least `limit` candles at or before `endSec` are stored (extends `oldest` into the past)
async function backfill(symbol, interval, key, meta, endSec, limit) {
  let { oldest, complete } = meta;

  for (let pages = 0; !complete && pages < MAX_BACKFILL_PAGES; pages += 1) {
    const have = await candles().countDocuments({ symbol, interval, t: { $lte: endSec } }, { limit });
    if (have >= limit) break;

    const batch = await fetchKlinesRaw(symbol, interval, { limit: PAGE, endTime: oldest * 1000 - 1 });
    await saveCandles(symbol, interval, batch);
    if (batch.length) oldest = Math.min(oldest, batch[0].time);
    if (batch.length < PAGE) complete = true;

    await ranges().updateOne({ _id: key }, { $set: { oldest, complete } });
  }
}

// Runs inside the per-series lock
async function sync({ symbol, interval, key, step, live, endSec, limit }) {
  let meta = await ranges().findOne({ _id: key });
  const failure = failures.get(key);
  const blocked = failure && Date.now() < failure.until;

  if (!meta) {
    if (blocked) throw failure.err;
    meta = await guard(key, () => seed(symbol, interval, key));
  } else if (live && !isFresh(meta) && !blocked) {
    meta = await guard(key, () => refreshLatest(symbol, interval, key, step, meta));
  }

  if (!live && !meta.complete && endSec < meta.oldest - MAX_BACKFILL_GAP_BARS * step) {
    throw httpError(400, 'Requested range is too far back, load older history gradually');
  }

  if (!blocked) {
    await guard(key, () => backfill(symbol, interval, key, meta, endSec, limit));
  }
}

/**
 * Candles for the chart.
 *   endTime undefined -> the latest `limit` candles (live)
 *   endTime (ms)      -> `limit` candles that opened at or before endTime (history page)
 */
export async function getKlines(symbol, interval, limit, endTime) {
  const step = INTERVAL_SECONDS[interval];
  const key = `${symbol}:${interval}`;
  const live = endTime === undefined;
  const endSec = live ? MAX_SEC : Math.floor(endTime / 1000);

  // Fast path: answered from Mongo only (no lock, no Binance)
  const meta = await ranges().findOne({ _id: key });
  if (meta && (!live || isFresh(meta))) {
    const rows = await readCandles(symbol, interval, endSec, limit);
    if (rows.length >= limit || meta.complete) return rows;
  }

  // Slow path: one request per series talks to Binance, everybody else waits and then reads Mongo
  let upstreamError = null;
  try {
    await withLock(key, () => sync({ symbol, interval, key, step, live, endSec, limit }));
  } catch (err) {
    if (err.status === 400 || err.status === 404) throw err;
    upstreamError = err; // Binance problem -> still serve whatever is cached
    console.warn(`Binance unavailable for ${key}: ${err.message}`);
  }

  const rows = await readCandles(symbol, interval, endSec, limit);
  if (rows.length === 0 && upstreamError) throw upstreamError;
  return rows;
}

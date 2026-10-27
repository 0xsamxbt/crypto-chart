import 'dotenv/config'; // must stay the first import: other modules read process.env when they load
import express from 'express';
import cors from 'cors';
import { connectDb, closeDb } from './db.js';
import { getKlines, INTERVAL_SECONDS } from './candles.js';
import { getTickers } from './tickers.js';
import { searchSymbols, lookup, filterKnown, warmUp } from './symbols.js';

const app = express();
const PORT = process.env.PORT || 4000;

const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
const SYMBOL_RE = /^[A-Z0-9]{5,15}$/;

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, time: Date.now() }));

// GET /api/prices?symbols=BTCUSDT,ETHUSDT
app.get('/api/prices', async (req, res, next) => {
  try {
    const symbols = req.query.symbols
      ? String(req.query.symbols).toUpperCase().split(',').map((s) => s.trim())
      : DEFAULT_SYMBOLS;

    if (symbols.length === 0 || symbols.length > 20 || !symbols.every((s) => SYMBOL_RE.test(s))) {
      return res.status(400).json({ error: 'Invalid symbols' });
    }

    const known = filterKnown(symbols);
    const rows = known.length ? await getTickers(known) : [];
    const data = rows.map((t) => ({ ...t, ...lookup(t.symbol) })); // adds name + image when available

    res.set('Cache-Control', 'no-store');
    res.json({ data, serverTime: Date.now() });
  } catch (err) {
    next(err);
  }
});

// GET /api/search?q=bitcoin&offset=0&limit=20   (empty q -> popular coins, page through with offset)
app.get('/api/search', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').slice(0, 30);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const offset = Math.min(Math.max(parseInt(req.query.offset, 10) || 0, 0), 5000);

    const page = await searchSymbols(q, limit, offset);
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ data: page.items, hasMore: page.hasMore, total: page.total, serverTime: Date.now() });
  } catch (err) {
    next(err);
  }
});

// GET /api/klines?symbol=BTCUSDT&interval=1m&limit=300[&endTime=<ms>]
app.get('/api/klines', async (req, res, next) => {
  try {
    const symbol = String(req.query.symbol || 'BTCUSDT').toUpperCase();
    const interval = String(req.query.interval || '1m');
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 300, 1), 1000);

    if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
    if (!Object.hasOwn(INTERVAL_SECONDS, interval)) return res.status(400).json({ error: 'Invalid interval' });
    // unknown symbols never reach Binance (protects the shared rate limit)
    if (filterKnown([symbol]).length === 0) return res.status(404).json({ error: 'Unknown symbol' });

    let endTime;
    if (req.query.endTime !== undefined) {
      endTime = Number(req.query.endTime);
      if (!Number.isInteger(endTime) || endTime <= 0) {
        return res.status(400).json({ error: 'Invalid endTime' });
      }
    }

    const data = await getKlines(symbol, interval, limit, endTime);

    // a history page that ends before the previous candle can never change -> browsers may cache it
    const closedPage =
      endTime !== undefined &&
      Math.floor(endTime / 1000) < Math.floor(Date.now() / 1000) - INTERVAL_SECONDS[interval];
    res.set('Cache-Control', closedPage ? 'public, max-age=3600' : 'no-store');
    res.json({ data, serverTime: Date.now() });
  } catch (err) {
    next(err);
  }
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

async function main() {
  await connectDb();
  const server = app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
    warmUp(); // build / load the coin index in the background so the first search is instant
  });

  const shutdown = async () => {
    server.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});

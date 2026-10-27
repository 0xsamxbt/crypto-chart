import { request } from './binance.js';
import { getDb } from './db.js';

const COINGECKO = process.env.COINGECKO_BASE_URL || 'https://api.coingecko.com/api/v3';
const TTL_OK = 6 * 60 * 60 * 1000;   // names loaded -> refresh every 6h
const TTL_RETRY = 5 * 60 * 1000;     // CoinGecko failed -> retry after 5 min
const INDEX_ID = 'coin-index';

let list = null;          // searchable coins (in memory copy of the Mongo document)
let bySymbol = null;      // Map<symbol, coin>
let builtAt = 0;
let ttl = TTL_OK;
let building = null;

const meta = () => getDb().collection('meta');

const hydrate = (c) => ({
  ...c,
  _b: c.base.toLowerCase(),
  _n: c.name.toLowerCase(),
  _s: c.symbol.toLowerCase(),
});

function adopt(coins, at, namesOk) {
  list = coins.map(hydrate);
  bySymbol = new Map(list.map((c) => [c.symbol, c]));
  builtAt = at;
  ttl = namesOk ? TTL_OK : TTL_RETRY;
}

// Best-effort: map "BTC" -> { name: "Bitcoin", image, rank } for the top 500 coins by market cap.
// The first coin per ticker wins (list is ordered by market cap), which avoids fake coins reusing a ticker.
async function loadNames() {
  const names = new Map();
  try {
    for (const page of [1, 2]) {
      const url = `${COINGECKO}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
      for (const c of await res.json()) {
        const base = String(c.symbol).toUpperCase();
        if (!names.has(base)) {
          names.set(base, { name: c.name, image: c.image, rank: c.market_cap_rank ?? 9999 });
        }
      }
    }
  } catch (err) {
    console.warn('Coin names unavailable:', err.message);
  }
  return names;
}

async function build(fallbackNames) {
  const [info, fresh] = await Promise.all([
    request('/api/v3/exchangeInfo?symbolStatus=TRADING', 15000),
    loadNames(),
  ]);
  const names = fresh.size > 0 ? fresh : fallbackNames; // CoinGecko down -> reuse names saved earlier

  const coins = info.symbols
    .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT' && s.isSpotTradingAllowed)
    .map((s) => {
      const m = names.get(s.baseAsset);
      return {
        symbol: s.symbol,
        base: s.baseAsset,
        name: m?.name ?? s.baseAsset,
        image: m?.image ?? null,
        rank: m?.rank ?? 9999,
      };
    });

  return { coins, namesOk: names.size > 0 };
}

async function refresh() {
  // Another run / instance may already have built a fresh index -> reuse it, don't ask Binance again
  const saved = await meta().findOne({ _id: INDEX_ID }).catch(() => null);
  if (saved && Date.now() - saved.builtAt < (saved.namesOk ? TTL_OK : TTL_RETRY)) {
    adopt(saved.coins, saved.builtAt, saved.namesOk);
    return;
  }

  try {
    const fallback = new Map();
    for (const c of saved?.coins ?? []) {
      if (c.rank !== 9999) fallback.set(c.base, { name: c.name, image: c.image, rank: c.rank });
    }
    const { coins, namesOk } = await build(fallback);
    const doc = { _id: INDEX_ID, builtAt: Date.now(), namesOk, coins };
    await meta().replaceOne({ _id: INDEX_ID }, doc, { upsert: true });
    adopt(coins, doc.builtAt, namesOk);
  } catch (err) {
    if (!saved) throw err;
    adopt(saved.coins, Date.now(), false); // keep serving the last saved index, retry in 5 min
  }
}

export async function getIndex() {
  if (list && Date.now() - builtAt < ttl) return list;

  if (!building) {
    building = refresh().finally(() => {
      building = null;
    });
  }

  try {
    await building;
  } catch (err) {
    if (!list) throw err; // nothing to fall back on
  }
  return list;
}

export function warmUp() {
  getIndex().catch((err) => console.warn('Symbol index warm-up failed:', err.message));
}

// ---- sync helpers (only use what is already loaded; never block a request) ----
export function lookup(symbol) {
  const c = bySymbol?.get(symbol);
  return c ? { name: c.name, image: c.image } : {};
}

// Binance rejects the WHOLE ticker request if one symbol is invalid/delisted -> drop unknown ones
export function filterKnown(symbols) {
  return bySymbol ? symbols.filter((s) => bySymbol.has(s)) : symbols;
}

// ---- search ----
function score(c, q) {
  if (c._b === q || c._n === q || c._s === q) return 0;
  if (c._b.startsWith(q) || c._s.startsWith(q)) return 1;
  if (c._n.startsWith(q)) return 2;
  if (c._n.split(/[\s.\-_]+/).some((w) => w.startsWith(q))) return 3;
  if (c._b.includes(q) || c._n.includes(q)) return 4;
  return -1;
}

export async function searchSymbols(query, limit = 20, offset = 0) {
  const coins = await getIndex();
  const q = query.trim().toLowerCase();

  let ranked;
  if (!q) {
    ranked = coins.map((c) => ({ c, s: 0 }));               // popular coins first
  } else {
    ranked = coins.map((c) => ({ c, s: score(c, q) })).filter((x) => x.s >= 0);
  }

  ranked.sort((a, b) => a.s - b.s || a.c.rank - b.c.rank || a.c.base.localeCompare(b.c.base));

  const items = ranked.slice(offset, offset + limit).map(({ c }) => ({
    symbol: c.symbol,
    base: c.base,
    name: c.name,
    image: c.image,
    rank: c.rank === 9999 ? null : c.rank,
  }));

  return { items, hasMore: offset + limit < ranked.length, total: ranked.length };
}

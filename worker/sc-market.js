// Live commodity prices and the current game version for the Star Citizen companion
// (bureau.belpire.com/rsi1/companion/), from the community-run UEX API.
//
//  • Every 10 minutes the cron calls refreshMarket(); it only talks to UEX when the stored snapshot is older
//    than MARKET_EVERY_MS, so the site makes a couple of requests an hour, far under UEX's rate limit.
//  • GET /api/sc-market serves the stored snapshot. The UEX token never leaves the Worker.
//
// Bindings: SC_DATA (KV). Runtime secret: UEX_API_TOKEN (bearer token from a UEX app).
// Optional runtime variable: UEX_API_BASE (defaults to UEX_BASE below).
//
// The row parsers are tolerant on purpose: they accept the field names UEX documents or their obvious
// variants, and when a response has none of them the snapshot records the keys it did see in `errors`
// instead of publishing guesses. The page then falls back to hand-entered prices.

export const UEX_BASE = 'https://uexcorp.space/api/2.0';
const UA = 'BelpireCarnival/1.0 (+https://bureau.belpire.com/rsi1/companion/)';
const MARKET_KEY = 'sc:market';
export const MARKET_EVERY_MS = 55 * 60 * 1000;
const STALE_MS = 3 * 60 * 60 * 1000;
const MAX_ROWS = 6000;

const num = (v) => {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const str = (v, max = 80) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max));
const first = (row, keys) => {
  for (const k of keys) if (row[k] != null && row[k] !== '') return row[k];
  return undefined;
};

// UEX wraps results as { status: "ok", data: ... }.
export function unwrap(json) {
  if (!json || typeof json !== 'object') throw new Error('response was not JSON object');
  if (json.status && json.status !== 'ok') throw new Error(`UEX status ${json.status}`);
  return json.data;
}

// One price row → { commodity, terminal, system, buy, sell, scuBuy, scuSell, at } or null.
export function parsePriceRow(row) {
  if (!row || typeof row !== 'object') return null;
  const commodity = str(first(row, ['commodity_name', 'commodity']));
  const terminal = str(first(row, ['terminal_name', 'terminal', 'terminal_code']));
  if (!commodity || !terminal) return null;
  const buy = num(first(row, ['price_buy', 'price_buy_avg']));
  const sell = num(first(row, ['price_sell', 'price_sell_avg']));
  if (!(buy > 0) && !(sell > 0)) return null;
  const at = num(first(row, ['date_modified', 'date_added']));
  return {
    commodity,
    terminal,
    system: str(first(row, ['star_system_name', 'system_name', 'star_system']), 40),
    place: str(first(row, ['city_name', 'space_station_name', 'outpost_name', 'planet_name', 'moon_name', 'orbit_name']), 60),
    buy: buy > 0 ? buy : null,
    sell: sell > 0 ? sell : null,
    scuBuy: num(first(row, ['scu_buy', 'scu_buy_avg'])),
    scuSell: num(first(row, ['scu_sell_stock', 'scu_sell', 'scu_sell_avg'])),
    at: at && at > 0 ? at : null
  };
}

export function parsePrices(data) {
  if (!Array.isArray(data)) throw new Error('prices: expected a list');
  const rows = data.slice(0, MAX_ROWS).map(parsePriceRow).filter(Boolean);
  if (data.length && !rows.length) {
    const keys = Object.keys(data[0] || {}).slice(0, 40).join(',');
    throw new Error(`prices: no usable rows (first row keys: ${keys})`);
  }
  return rows;
}

// The version endpoint's shape is not pinned down here: look for a version-like string under common names.
export function parseLiveVersion(data) {
  const looks = (v) => typeof v === 'string' && /^\d+\.\d+(\.\d+)?/.test(v.trim());
  if (!data || typeof data !== 'object') return null;
  for (const k of ['live', 'LIVE', 'current', 'version']) if (looks(data[k])) return data[k].trim().slice(0, 40);
  const rows = Array.isArray(data) ? data : [];
  for (const r of rows) {
    const v = first(r || {}, ['live', 'version', 'name']);
    if (looks(v)) return String(v).trim().slice(0, 40);
  }
  return null;
}

async function uex(env, resource) {
  const base = String(env.UEX_API_BASE || UEX_BASE).replace(/\/+$/, '');
  const res = await fetch(`${base}/${resource}/`, {
    headers: { Authorization: `Bearer ${env.UEX_API_TOKEN}`, 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from UEX ${resource}`);
  return unwrap(await res.json());
}

async function readJson(kv, key) {
  try {
    return (await kv.get(key, 'json')) || null;
  } catch {
    return null;
  }
}

export async function buildMarket(env, previous) {
  const errors = [];
  const [prices, version] = await Promise.allSettled([
    uex(env, 'commodities_prices_all').then(parsePrices),
    uex(env, 'game_versions').then(parseLiveVersion)
  ]);
  const rows = prices.status === 'fulfilled' ? prices.value : null;
  if (!rows) errors.push(prices.reason?.message || 'prices failed');
  let live = previous?.version ?? null;
  if (version.status === 'fulfilled' && version.value) live = version.value;
  else errors.push(version.status === 'fulfilled' ? 'version: nothing recognised' : `version: ${version.reason?.message}`);
  return {
    updatedAt: rows ? new Date().toISOString() : previous?.updatedAt ?? null,
    checkedAt: new Date().toISOString(),
    source: 'UEX Corp',
    version: live,
    prices: rows ?? previous?.prices ?? [],
    errors
  };
}

export async function refreshMarket(env, { force = false } = {}) {
  if (!env.UEX_API_TOKEN) return null;
  const previous = await readJson(env.SC_DATA, MARKET_KEY);
  if (!force && previous?.checkedAt && Date.now() - Date.parse(previous.checkedAt) < MARKET_EVERY_MS) return previous;
  const market = await buildMarket(env, previous);
  await env.SC_DATA.put(MARKET_KEY, JSON.stringify(market));
  if (market.errors.length) console.warn('Market refresh warnings:', market.errors.join(' | '));
  return market;
}

// GET /api/sc-market
export async function handleMarket(env, ctx) {
  if (!env.UEX_API_TOKEN) return { enabled: false, prices: [], version: null, updatedAt: null };
  let market = await readJson(env.SC_DATA, MARKET_KEY);
  if (!market) market = await refreshMarket(env);
  else if (Date.now() - Date.parse(market.checkedAt || 0) > STALE_MS) ctx.waitUntil(refreshMarket(env, { force: true }));
  if (!market) return { enabled: true, prices: [], version: null, updatedAt: null };
  // `errors` can name upstream fields; the page only needs to know whether data is fresh.
  const { errors, ...pub } = market;
  return { enabled: true, ...pub, partial: errors.length > 0 };
}

// ------------------------------------------------------------------ ship lookup (Star Citizen Wiki API)
// GET /api/sc-ship?name=Vulture → the first matching vehicle record, cached for a day.
const WIKI_API = 'https://api.star-citizen.wiki/api';
const SHIP_TTL_S = 24 * 60 * 60;

export function cleanShipName(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  return /^[\p{L}\p{N} .'\-/]{2,50}$/u.test(s) ? s : null;
}

export async function handleShip(url, ctx) {
  const name = cleanShipName(url.searchParams.get('name'));
  if (!name) return { status: 400, body: { error: 'bad name' } };
  const cache = globalThis.caches?.default;
  const key = new Request(`https://cache.invalid/ship/${encodeURIComponent(name.toLowerCase())}`);
  const hit = cache ? await cache.match(key) : null;
  if (hit) return { status: 200, body: await hit.json() };
  const res = await fetch(`${WIKI_API}/vehicles?filter[name]=${encodeURIComponent(name)}&page[size]=1`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) return { status: 502, body: { error: 'ship database unavailable' } };
  const json = await res.json();
  const ship = Array.isArray(json?.data) ? json.data[0] : null;
  const body = { ship: ship ?? null, source: 'api.star-citizen.wiki' };
  if (cache && ship) ctx.waitUntil(cache.put(key, new Response(JSON.stringify(body), { headers: { 'Cache-Control': `public, max-age=${SHIP_TTL_S}` } })));
  return { status: 200, body };
}

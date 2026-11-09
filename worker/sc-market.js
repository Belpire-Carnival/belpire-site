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
// Bump when the stored rows gain fields, so the next request rebuilds the snapshot instead of waiting out the hour.
const MARKET_SCHEMA = 2;

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

// UEX's price rows carry the terminal but not where it is. The terminals list does: star system, city / station / outpost.
// Keyed by terminal id and by lower-cased name, nickname and code, so a row joins on whichever it has.
const lc = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
export function parseTerminals(data) {
  const map = new Map();
  if (!Array.isArray(data)) return map;
  for (const t of data) {
    if (!t || typeof t !== 'object') continue;
    const loc = {
      system: str(first(t, ['star_system_name', 'system_name']), 40),
      place: str(first(t, ['city_name', 'space_station_name', 'outpost_name', 'poi_name', 'moon_name', 'planet_name', 'orbit_name']), 60)
    };
    if (!loc.system && !loc.place) continue;
    if (t.id != null) map.set(`id:${t.id}`, loc);
    for (const k of ['name', 'nickname', 'code', 'displayname']) if (t[k]) map.set(`n:${lc(t[k])}`, loc);
  }
  return map;
}

export function parsePrices(data, terminals) {
  if (!Array.isArray(data)) throw new Error('prices: expected a list');
  const rows = [];
  for (const raw of data.slice(0, MAX_ROWS)) {
    const r = parsePriceRow(raw);
    if (!r) continue;
    if (terminals?.size && (!r.system || !r.place)) {
      const loc = terminals.get(`id:${raw.id_terminal}`) || terminals.get(`n:${lc(r.terminal)}`);
      if (loc) { r.system = r.system || loc.system; r.place = r.place || loc.place; }
    }
    rows.push(r);
  }
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
  const [prices, version, terms] = await Promise.allSettled([
    uex(env, 'commodities_prices_all'),
    uex(env, 'game_versions').then(parseLiveVersion),
    uex(env, 'terminals').then(parseTerminals)
  ]);
  const terminals = terms.status === 'fulfilled' ? terms.value : null;
  if (!terminals?.size) errors.push(terms.status === 'fulfilled' ? 'terminals: nothing recognised' : `terminals: ${terms.reason?.message}`);
  let rows = null;
  if (prices.status === 'fulfilled') { try { rows = parsePrices(prices.value, terminals); } catch (e) { prices.status = 'rejected'; prices.reason = e; } }
  if (!rows) errors.push(prices.reason?.message || 'prices failed');
  else if (terminals?.size && rows.every((r) => !r.system)) errors.push('terminals: no price row matched a terminal');
  let live = previous?.version ?? null;
  if (version.status === 'fulfilled' && version.value) live = version.value;
  else errors.push(version.status === 'fulfilled' ? 'version: nothing recognised' : `version: ${version.reason?.message}`);
  return {
    updatedAt: rows ? new Date().toISOString() : previous?.updatedAt ?? null,
    checkedAt: new Date().toISOString(),
    source: 'UEX Corp',
    version: live,
    prices: rows ?? previous?.prices ?? [],
    schema: MARKET_SCHEMA,
    errors
  };
}

export async function refreshMarket(env, { force = false } = {}) {
  if (!env.UEX_API_TOKEN) return null;
  const previous = await readJson(env.SC_DATA, MARKET_KEY);
  if (!force && previous?.schema === MARKET_SCHEMA && previous?.checkedAt && Date.now() - Date.parse(previous.checkedAt) < MARKET_EVERY_MS) return previous;
  const market = await buildMarket(env, previous);
  await env.SC_DATA.put(MARKET_KEY, JSON.stringify(market));
  if (market.errors.length) console.warn('Market refresh warnings:', market.errors.join(' | '));
  return market;
}

// GET /api/sc-market
export async function handleMarket(env, ctx) {
  if (!env.UEX_API_TOKEN) return { enabled: false, prices: [], version: null, updatedAt: null };
  let market = await readJson(env.SC_DATA, MARKET_KEY);
  if (!market || market.schema !== MARKET_SCHEMA) market = (await refreshMarket(env, { force: true })) ?? market;
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

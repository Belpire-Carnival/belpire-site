// Where each ship can be bought or rented in game, from UEX Corp's public vehicle price lists.
// GET /api/sc-shop → { ready, updatedAt, ships: { <normalised ship name>: { buy: [...], rent: [...] } } }
// Each row: { p: price in aUEC, at: shop terminal, where: city/station/outpost, near: planet or moon, sys: star system, d: yyyy-mm-dd }.
// The wiki's own ship price lists are empty for most ships, so this joins UEX rows to ships by name.
const UEX = 'https://api.uexcorp.space/2.0';
const UA = 'BelpireCarnival/1.0 (+https://bureau.belpire.com/rsi1/companion/)';
const MAX_ROWS = 8;

export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const day = (ts) => { const n = Number(ts); return n > 0 ? new Date(n * 1000).toISOString().slice(0, 10) : ''; };

function row(r, key) {
  return {
    p: num(r[key]),
    at: str(r.terminal_name, 80),
    where: str(r.city_name || r.space_station_name || r.outpost_name || r.poi_name || r.moon_name || r.planet_name, 50),
    near: str(r.moon_name || r.planet_name || r.orbit_name, 40),
    sys: str(r.star_system_name, 30),
    d: day(r.date_modified)
  };
}

export function shopMap(vehicles, buys, rents) {
  const byId = new Map();
  for (const v of Array.isArray(vehicles) ? vehicles : []) if (v && v.id) byId.set(v.id, v);
  const out = {};
  const add = (rows, key, field) => {
    for (const r of Array.isArray(rows) ? rows : []) {
      const v = byId.get(r?.id_vehicle);
      const price = num(r?.[key]);
      if (!v || !(price > 0)) continue;
      for (const k of new Set([norm(v.name), norm(v.name_full)])) {
        if (!k) continue;
        const e = (out[k] ||= { buy: [], rent: [] });
        const x = row(r, key);
        // The same terminal can be listed twice by two reports; keep one row per terminal.
        if (!e[field].some((y) => y.at === x.at)) e[field].push(x);
      }
    }
  };
  add(buys, 'price_buy', 'buy');
  add(rents, 'price_rent', 'rent');
  for (const e of Object.values(out)) { e.buy.sort((a, b) => a.p - b.p); e.rent.sort((a, b) => a.p - b.p); e.buy = e.buy.slice(0, MAX_ROWS); e.rent = e.rent.slice(0, MAX_ROWS); }
  return out;
}

async function get(path) {
  const res = await fetch(`${UEX}/${path}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`UEX ${path} ${res.status}`);
  const j = await res.json();
  return j?.data;
}

export async function handleShop(ctx) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request('https://shop.cache.invalid/v1');
  const hit = cache ? await cache.match(key) : null;
  if (hit) return { status: 200, body: await hit.json() };
  let vehicles, buys, rents;
  try { [vehicles, buys, rents] = await Promise.all([get('vehicles'), get('vehicles_purchases_prices'), get('vehicles_rentals_prices')]); }
  catch { return { status: 502, body: { ready: false, error: 'ship prices are unavailable right now' } }; }
  const body = { ready: true, updatedAt: new Date().toISOString(), source: 'UEX Corp', ships: shopMap(vehicles, buys, rents) };
  if (cache) { const put = cache.put(key, new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=21600' } })); if (ctx?.waitUntil) ctx.waitUntil(put); }
  return { status: 200, body };
}

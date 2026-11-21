// Every personal (FPS) weapon in the Star Citizen Wiki's item database, for the Ballistics Matrix rankings.
// GET /api/sc-weapons → { ready, weapons: [{ id, name, mfr, size, sub, kind, img, wpn }] }
// `wpn` is the same shape the weapon picker uses (damage per projectile, rate of fire, magazine, fire mode). Records with
// no damage figure are left out, and copies of one weapon under the same name and maker are listed once.
import { WIKI_API } from './sc-builder.js';
import { slimItem } from './sc-img.js';

const UA = 'BelpireCarnival/1.0 (+https://bureau.belpire.com/rsi1/companion/)';
const MAX_PAGES = 8;

export function slimWeapons(items) {
  const seen = new Set();
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const s = slimItem(it);
    if (!s || !s.wpn) continue;
    const key = `${s.name.toLowerCase()}|${s.mfr.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: s.id, name: s.name, mfr: s.mfr, size: s.size, sub: s.sub, kind: s.kind, img: s.img, wpn: s.wpn });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function handleWeapons(env, ctx) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request('https://weapons.cache.invalid/v1');
  const hit = cache ? await cache.match(key) : null;
  if (hit) return { status: 200, body: await hit.json() };
  const base = String(env?.SC_WIKI_API || WIKI_API).replace(/\/+$/, '');
  const host = new URL(base).hostname;
  let next = `${base}/items?filter%5Btype%5D=WeaponPersonal&page%5Bsize%5D=100`;
  const items = [];
  try {
    for (let i = 0; i < MAX_PAGES && next; i++) {
      const res = await fetch(next, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`wiki answered ${res.status}`);
      const j = await res.json();
      items.push(...(Array.isArray(j?.data) ? j.data : []));
      const n = typeof j?.links?.next === 'string' ? new URL(j.links.next, next) : null;
      next = n && n.protocol === 'https:' && n.hostname === host ? n.toString() : '';
    }
  } catch (err) {
    if (!items.length) return { status: 502, body: { ready: false, error: String(err?.message || err).slice(0, 80) } };
  }
  const weapons = slimWeapons(items);
  const body = { ready: weapons.length > 0, weapons };
  if (body.ready && cache && ctx?.waitUntil) ctx.waitUntil(cache.put(key, new Response(JSON.stringify(body), { headers: { 'Cache-Control': 'public, max-age=86400' } })));
  return { status: body.ready ? 200 : 502, body };
}

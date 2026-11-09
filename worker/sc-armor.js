// Typical damage-taken multipliers for each armor class (Light, Medium, Heavy), from the wiki's torso armor records.
// GET /api/sc-armor → { ready, classes: { Light: { phys, energy, n }, Medium: {...}, Heavy: {...} } }
// phys and energy are the middle value across that class's torso pieces (1.00 = no reduction, 0.60 = 40% less damage).
import { WIKI_API } from './sc-builder.js';

const UA = 'BelpireCarnival/1.0 (+https://bureau.belpire.com/rsi1/companion/)';
const CLASSES = ['Light', 'Medium', 'Heavy'];
const MAX_PAGES = 6;

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r3 = (v) => Math.round(v * 1000) / 1000;

export function armorClasses(items) {
  const by = Object.fromEntries(CLASSES.map((c) => [c, { phys: [], energy: [] }]));
  for (const it of Array.isArray(items) ? items : []) {
    const cls = CLASSES.find((c) => c.toLowerCase() === String(it?.sub_type ?? it?.subtype ?? '').toLowerCase());
    const map = it?.suit_armor?.damage_resistance_map || it?.clothing?.damage_resistance_map;
    if (!cls || !map) continue;
    const p = Number(map.physical), e = Number(map.energy);
    if (Number.isFinite(p) && p > 0 && p <= 1.5) by[cls].phys.push(p);
    if (Number.isFinite(e) && e > 0 && e <= 1.5) by[cls].energy.push(e);
  }
  const classes = {};
  for (const c of CLASSES) if (by[c].phys.length && by[c].energy.length) classes[c] = { phys: r3(median(by[c].phys)), energy: r3(median(by[c].energy)), n: by[c].phys.length };
  return classes;
}

export async function handleArmor(env, ctx) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request('https://armor.cache.invalid/v1');
  const hit = cache ? await cache.match(key) : null;
  if (hit) return { status: 200, body: await hit.json() };
  const base = String(env?.SC_WIKI_API || WIKI_API).replace(/\/+$/, '');
  const host = new URL(base).hostname;
  let next = `${base}/items?filter%5Btype%5D=Char_Armor_Torso&page%5Bsize%5D=100`;
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
  const classes = armorClasses(items);
  const body = { ready: Object.keys(classes).length > 0, classes };
  if (body.ready && cache && ctx?.waitUntil) ctx.waitUntil(cache.put(key, new Response(JSON.stringify(body), { headers: { 'Cache-Control': 'public, max-age=86400' } })));
  return { status: body.ready ? 200 : 502, body };
}

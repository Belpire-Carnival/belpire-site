// Pictures for the companion, served from this site so the page's strict Content-Security-Policy stays as it is.
// GET /api/sc-img?p=<path> fetches one image from the Star Citizen wiki's media server (media.starcitizen.tools)
// and caches it. Only that host, only plain image paths, only image responses under 3 MB are passed through.
// GET /api/sc-item?q=<name> searches the wiki API for a weapon, armor piece, clothing item or ship component
// and returns the few fields the page uses, with the picture path.
import { MEDIA_HOST, IMG_PATH, WIKI_API, imgPath } from './sc-builder.js';

const UA = 'BelpireCarnival/1.0 (+https://bureau.belpire.com/rsi1/companion/)';
const MAX_BYTES = 3 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

export async function handleImg(url, ctx) {
  const p = url.searchParams.get('p') || '';
  if (!IMG_PATH.test(p)) return new Response('bad image path', { status: 400, headers: { 'Cache-Control': 'no-store' } });
  const key = new Request(`https://img.cache.invalid/${p}`);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const hit = cache ? await cache.match(key) : null;
  if (hit) return hit;
  // The wiki may redirect (to a regenerated thumbnail, say). Follow up to three redirects, and only on its own host.
  let res;
  let target = `https://${MEDIA_HOST}/${p}`;
  try {
    for (let hop = 0; hop < 4; hop++) {
      res = await fetch(target, { headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8', Referer: 'https://starcitizen.tools/' }, signal: AbortSignal.timeout(15000), redirect: 'manual' });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!loc) break;
      const next = new URL(loc, target);
      if (next.protocol !== 'https:' || next.hostname !== MEDIA_HOST) return new Response(`image host redirected elsewhere (${next.hostname})`, { status: 502, headers: { 'Cache-Control': 'no-store' } });
      target = next.toString();
    }
  } catch (err) {
    return new Response(`image host unreachable (${String(err?.message || err).slice(0, 80)})`, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!res.ok || !TYPES.has(type)) return new Response(`no image (host answered ${res.status} ${type || 'no type'})`, { status: res.status === 404 ? 404 : 502, headers: { 'Cache-Control': 'public, max-age=300' } });
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return new Response('image too large', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  const out = new Response(buf, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=2592000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
  if (cache && ctx?.waitUntil) ctx.waitUntil(cache.put(key, out.clone()));
  return out;
}

// One wiki item record → what the page shows. `info` is a short stat line built from the record's own numbers:
// the in-game stat list (damage, rate of fire, carrying capacity and so on), armor resistances, and the cheapest shop.
const RESIST = [['physical', 'Phys'], ['energy', 'Energy'], ['distortion', 'Dist'], ['thermal', 'Thermal'], ['biochemical', 'Bio'], ['stun', 'Stun']];
const scalars = (o, max) => (o && typeof o === 'object' ? Object.entries(o).filter(([, v]) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v && v.length < 20)).slice(0, max) : []);
export function itemInfo(it) {
  const bits = [];
  for (const d of Array.isArray(it.description_data) ? it.description_data : []) {
    const n = String(d?.name ?? '').trim(), v = String(d?.value ?? '').trim();
    if (n && v && n.length < 30 && v.length < 30 && bits.length < 5) bits.push(`${n} ${v}`);
  }
  const map = it.suit_armor?.damage_resistance_map || it.clothing?.damage_resistance_map;
  const res = RESIST.map(([k, label]) => (Number.isFinite(Number(map?.[k])) && map[k] !== null ? `${label} ${Math.round(map[k] * 1000) / 1000}` : null)).filter(Boolean);
  if (res.length) bits.push(`Resist ${res.join(' ')}`);
  const wpn = scalars(it.personal_weapon || it.weapon || it.fps_weapon, 6).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`);
  if (wpn.length) bits.push(wpn.join(', '));
  const buys = (it.uex_prices?.purchase || []).map((p) => Number(p?.price_buy)).filter((n) => n > 0);
  if (buys.length) bits.push(`from ${Math.min(...buys).toLocaleString('en-US')} aUEC`);
  return bits.join(' · ').slice(0, 220);
}
// A personal weapon's numbers in the shape the Ballistics Matrix form takes. Damage is per projectile (the wiki
// lists alpha damage per shot, so it is divided by the projectiles per shot). The wiki has no reload time.
const r3 = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 1000) / 1000 : null);
export function weaponStats(it) {
  const pw = it?.personal_weapon;
  if (!pw || typeof pw !== 'object') return null;
  const pellets = Math.max(1, Math.round(Number(pw.pellets_per_shot) || 1));
  const modes = Array.isArray(pw.modes) ? pw.modes : [];
  const m = modes.find((x) => x?.mode === pw.fire_mode) || modes[0] || {};
  const burst = m.type === 'burst';
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  // Damage per projectile: the shot total divided by the projectile count when the record has one, otherwise the
  // ammunition's own impact damage (beam and charge weapons have no per-shot figure).
  const alpha = (it.damage || pw.damage)?.alpha || {};
  const ammo = it.ammunition || pw.ammunition || {};
  const listed = {};
  for (const d of Array.isArray(pw.damages) ? pw.damages : []) listed[String(d?.name ?? '').toLowerCase()] = num(d?.damage);
  const hit = (k) => (num(alpha[k]) ? r3(num(alpha[k]) / pellets) : num(listed[k]) || num(ammo.impact_damage_map?.[k]) || 0);
  // Rate of fire: the mode's, the weapon's, or the "Rate Of Fire 550 rpm" line of its description data.
  const line = (Array.isArray(it.description_data) ? it.description_data : []).find((d) => /rate of fire/i.test(String(d?.name ?? '')));
  let rpm = num(m.rpm) || num(pw.rpm) || num(String(line?.value ?? '').replace(/[^\d.]/g, ''));
  let rpmFrom = '';
  if (!rpm) { const alt = modes.find((x) => num(x?.rpm)); if (alt) { rpm = num(alt.rpm); rpmFrom = String(alt.mode || '').slice(0, 20); } }
  const out = {
    phys: hit('physical'), energy: hit('energy'), pellets,
    rpm: rpm ? r3(rpm) : null, mag: r3(num(pw.capacity) || num(pw.magazine_size) || num(it.magazine?.max_ammo_count)) || null,
    mode: burst ? 'BURST' : 'AUTO', burst: burst ? r3(m.shot_count) : null, cooldown: burst ? r3(m.cooldown_time) : null,
  };
  if (rpmFrom) out.rpmFrom = rpmFrom;
  return out.phys || out.energy ? out : null;
}
export function slimItem(it) {
  if (!it || typeof it !== 'object' || !it.name) return null;
  const s = (v, n) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n));
  return { id: s(it.uuid, 40), name: s(it.name, 80), type: s(it.type, 40), kind: s(it.classification_label || it.type_label, 30), sub: s(it.sub_type ?? it.subtype, 40), cls: s(it.class, 20), mfr: s(it.manufacturer?.name, 40), size: Number.isFinite(Number(it.size)) ? Number(it.size) : null, img: imgPath(it), info: itemInfo(it), wpn: weaponStats(it) };
}

export async function handleItem(url, env, ctx) {
  const q = (url.searchParams.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (q.length < 2) return { status: 400, body: { error: 'type at least two letters' } };
  const base = String(env.SC_WIKI_API || WIKI_API).replace(/\/+$/, '');
  const weapon = url.searchParams.get('type') === 'weapon';
  const target = `${base}/items?filter%5Bname%5D=${encodeURIComponent(q)}${weapon ? '&filter%5Btype%5D=WeaponPersonal' : ''}&page%5Bsize%5D=12`;
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(`https://item.cache.invalid/${weapon ? 'w/' : ''}${encodeURIComponent(q.toLowerCase())}`);
  const hit = cache ? await cache.match(key) : null;
  let json;
  if (hit) json = await hit.json();
  else {
    let res;
    try { res = await fetch(target, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }); } catch { return { status: 502, body: { error: 'item database unreachable' } }; }
    if (!res.ok) return { status: 502, body: { error: `item database answered ${res.status}` } };
    json = await res.json();
    if (cache && ctx?.waitUntil) ctx.waitUntil(cache.put(key, new Response(JSON.stringify(json), { headers: { 'Cache-Control': 'public, max-age=86400' } })));
  }
  const rows = Array.isArray(json?.data) ? json.data : [];
  if (url.searchParams.get('raw') === '1') return { status: 200, body: { raw: rows[0] ?? null, count: rows.length } };
  return { status: 200, body: { items: rows.map(slimItem).filter(Boolean).slice(0, 12) } };
}

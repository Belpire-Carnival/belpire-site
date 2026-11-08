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
  let res;
  try {
    res = await fetch(`https://${MEDIA_HOST}/${p}`, { headers: { 'User-Agent': UA, Accept: 'image/*' }, signal: AbortSignal.timeout(15000), redirect: 'error' });
  } catch {
    return new Response('image host unreachable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!res.ok || !TYPES.has(type)) return new Response('no image', { status: res.status === 404 ? 404 : 502, headers: { 'Cache-Control': 'public, max-age=300' } });
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return new Response('image too large', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  const out = new Response(buf, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=2592000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
  if (cache && ctx?.waitUntil) ctx.waitUntil(cache.put(key, out.clone()));
  return out;
}

// One wiki item record → what the page shows.
export function slimItem(it) {
  if (!it || typeof it !== 'object' || !it.name) return null;
  const s = (v, n) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n));
  return { id: s(it.uuid, 40), name: s(it.name, 80), type: s(it.type, 40), sub: s(it.sub_type ?? it.subtype, 40), cls: s(it.class, 20), mfr: s(it.manufacturer?.name, 40), size: Number.isFinite(Number(it.size)) ? Number(it.size) : null, img: imgPath(it) };
}

export async function handleItem(url, env, ctx) {
  const q = (url.searchParams.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (q.length < 2) return { status: 400, body: { error: 'type at least two letters' } };
  const base = String(env.SC_WIKI_API || WIKI_API).replace(/\/+$/, '');
  const target = `${base}/items?filter%5Bname%5D=${encodeURIComponent(q)}&page%5Bsize%5D=12`;
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(`https://item.cache.invalid/${encodeURIComponent(q.toLowerCase())}`);
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

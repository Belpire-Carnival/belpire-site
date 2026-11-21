// Crafting blueprints from the Star Citizen Wiki API (api.star-citizen.wiki, community data from the game files).
// GET /api/sc-blueprints          → { ready, version, blueprints: [{ id, key, name, cls, type, sub, grade, sec, def, miss, ing }] }
// GET /api/sc-blueprint?id=<uuid> → { ready, blueprint: { ...list fields, groups, missions, dismantle } }
// The list pages are read once a day into the edge cache; the detail (unlock missions and the quality ranges the
// Fabricator calculator needs) is fetched only when a player opens a blueprint, and cached the same way.
// Credit: api.star-citizen.wiki. Same-host paging only.
import { WIKI_API } from './sc-builder.js';

const UA = 'BelpireCarnival/1.0 (+https://bureau.belpire.com/rsi1/companion/)';
const MAX_PAGES = 45; // stays under the 50 subrequests a free-plan Worker may make; with page[size]=100 about 17 are used
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const txt = (v, n = 80) => (v == null ? '' : String(v).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n));
const num = (v) => { const n = typeof v === 'number' ? v : Number(v); return v != null && v !== '' && Number.isFinite(n) && Math.abs(n) < 1e9 ? n : null; };

const slimIngredient = (g) => (g && typeof g === 'object' && g.name ? { n: txt(g.name, 60), k: g.kind === 'item' ? 'item' : 'resource', scu: num(g.quantity_scu), q: num(g.quantity) } : null);

export function slimBlueprint(b) {
  if (!b || typeof b !== 'object' || !UUID.test(String(b.uuid || '')) || !b.output_name) return null;
  const o = b.output && typeof b.output === 'object' ? b.output : {};
  return {
    id: String(b.uuid).toLowerCase(), key: txt(b.key, 80), name: txt(b.output_name, 80), cls: txt(b.output_class, 80),
    type: txt(o.type_label || o.type, 40), sub: txt(o.sub_type || o.subtype, 40), grade: txt(o.grade, 10),
    sec: num(b.craft_time_seconds), def: b.is_available_by_default === true, miss: num(b.unlocking_missions_count) || 0,
    ing: (Array.isArray(b.ingredients) ? b.ingredients : []).slice(0, 20).map(slimIngredient).filter(Boolean)
  };
}

export function slimList(rows) {
  const seen = new Set(), out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const s = slimBlueprint(r);
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id); out.push(s);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const slimMod = (m) => {
  if (!m || typeof m !== 'object' || !m.label) return null;
  const qr = m.quality_range || {}, mr = m.modifier_range || {};
  return {
    key: txt(m.property_key, 60), label: txt(m.label, 60), better: m.better_when === 'lower' ? 'lower' : 'higher',
    qmin: num(qr.min), qmax: num(qr.max), lo: num(mr.at_min_quality), hi: num(mr.at_max_quality),
    curve: txt(m.value_range_type, 20) || 'linear', segs: Array.isArray(m.value_segments) ? m.value_segments.slice(0, 12).map((s) => (s && typeof s === 'object' ? { q: num(s.quality ?? s.q ?? s.x), v: num(s.value ?? s.v ?? s.y) } : null)).filter(Boolean) : null
  };
};
const slimKid = (c) => (c && typeof c === 'object' && c.name ? { kind: c.kind === 'item' ? 'item' : 'resource', name: txt(c.name, 60), scu: num(c.quantity_scu), qty: num(c.quantity), minq: num(c.min_quality) } : null);

export function slimDetail(b) {
  const base = slimBlueprint(b);
  if (!base) return null;
  const groups = (Array.isArray(b.requirement_groups) ? b.requirement_groups : []).slice(0, 20).map((g) => (g && typeof g === 'object' && g.name ? {
    key: txt(g.key, 40), name: txt(g.name, 60), need: num(g.required_count) || 1,
    mods: (Array.isArray(g.modifiers) ? g.modifiers : []).slice(0, 12).map(slimMod).filter(Boolean),
    kids: (Array.isArray(g.children) ? g.children : []).slice(0, 12).map(slimKid).filter(Boolean)
  } : null)).filter(Boolean);
  const missions = (Array.isArray(b.unlocking_missions_grouped) ? b.unlocking_missions_grouped : []).slice(0, 8).map((g) => (g && typeof g === 'object' ? {
    label: txt(g.label, 40), chance: num(g.chance),
    list: (Array.isArray(g.missions) ? g.missions : []).slice(0, 25).map((m) => (m && m.title ? { title: txt(m.title, 100), scope: txt(m.reward_scope, 40), count: num(m.count) || 1 } : null)).filter(Boolean)
  } : null)).filter((g) => g && g.list.length);
  const d = b.dismantle && typeof b.dismantle === 'object' ? b.dismantle : null;
  return { ...base, groups, missions, dismantle: d ? { sec: num(d.time_seconds), eff: num(d.efficiency) } : null };
}

async function getJson(url, host) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== host) throw new Error('bad host');
  const res = await fetch(u.toString(), { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`wiki answered ${res.status}`);
  return res.json();
}
const base = (env) => String(env?.SC_WIKI_API || WIKI_API).replace(/\/+$/, '');

async function cached(keyUrl, ctx, build) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(keyUrl);
  const hit = cache ? await cache.match(key) : null;
  if (hit) return { status: 200, body: await hit.json() };
  const out = await build();
  if (out.status === 200 && cache && ctx?.waitUntil) ctx.waitUntil(cache.put(key, new Response(JSON.stringify(out.body), { headers: { 'Cache-Control': 'public, max-age=86400' } })));
  return out;
}

export function handleBlueprints(env, ctx) {
  return cached('https://blueprints.cache.invalid/v1', ctx, async () => {
    const root = base(env), host = new URL(root).hostname;
    let next = `${root}/blueprints?page%5Bsize%5D=100`;
    const rows = []; let version = '', pages = 0, complete = false;
    try {
      for (; pages < MAX_PAGES && next; pages++) {
        const j = await getJson(next, host);
        rows.push(...(Array.isArray(j?.data) ? j.data : []));
        if (!version && rows[0]?.game_version) version = txt(rows[0].game_version, 40);
        const n = typeof j?.links?.next === 'string' ? new URL(j.links.next, next).toString() : '';
        next = n;
      }
      complete = !next;
    } catch (err) {
      if (!rows.length) return { status: 502, body: { ready: false, error: String(err?.message || err).slice(0, 80) } };
    }
    const blueprints = slimList(rows);
    // A partial list is served but not cached, so the next visitor gets another try at the whole thing.
    return { status: blueprints.length && complete ? 200 : blueprints.length ? 206 : 502, body: { ready: blueprints.length > 0, complete, version, blueprints } };
  });
}

export function handleBlueprint(url, env, ctx) {
  const id = String(url.searchParams.get('id') || '').toLowerCase();
  if (!UUID.test(id)) return Promise.resolve({ status: 400, body: { ready: false, error: 'bad_id' } });
  return cached(`https://blueprint.cache.invalid/v1/${id}`, ctx, async () => {
    const root = base(env), host = new URL(root).hostname;
    try {
      const j = await getJson(`${root}/blueprints/${id}`, host);
      const bp = slimDetail(j?.data || j);
      return bp ? { status: 200, body: { ready: true, blueprint: bp } } : { status: 502, body: { ready: false, error: 'unreadable' } };
    } catch (err) {
      return { status: 502, body: { ready: false, error: String(err?.message || err).slice(0, 80) } };
    }
  });
}

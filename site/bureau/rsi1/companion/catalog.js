// The lists the strict pickers draw from, each loaded once from this site's own API and kept for the visit.
const memo = new Map();
const once = (key, fn) => { if (!memo.has(key)) memo.set(key, fn().catch((e) => { memo.delete(key); throw e; })); return memo.get(key); };
const getJson = async (url) => { const r = await fetch(url, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error(String(r.status)); return r.json(); };
const uniq = (a) => [...new Set(a.filter(Boolean))];

const builder = () => once('builder', async () => { const j = await getJson('/api/sc-builder'); if (!j || !j.ready || !Array.isArray(j.ships)) throw new Error('not ready'); return j; });
export const shipNames = async () => uniq((await builder()).ships.map((s) => s.name));
export const gunNames = async () => uniq(((await builder()).parts || []).filter((p) => p.type === 'WeaponGun').map((p) => p.name));
export const componentNames = async () => uniq(((await builder()).parts || []).filter((p) => p.type !== 'WeaponGun').map((p) => p.name));
export const blueprintNames = () => once('blueprints', async () => { const j = await getJson('/api/sc-blueprints'); if (!j || !j.ready || !Array.isArray(j.blueprints)) throw new Error('not ready'); return uniq(j.blueprints.map((b) => b.name)); });

// Wiki item search by slot (see TYPE_MAP in the worker): the server does the matching, so these need two letters.
export async function itemNames(keys, q) {
  const parts = await Promise.allSettled(keys.map((k) => once(`item:${k}:${q.toLowerCase()}`, async () => ((await getJson(`/api/sc-item?q=${encodeURIComponent(q)}&type=${k}`)).items || []).map((i) => i.name))));
  if (parts.every((p) => p.status === 'rejected')) throw new Error('items unavailable');
  return uniq(parts.flatMap((p) => (p.status === 'fulfilled' ? p.value : [])));
}
export const ARMOR_KEYS = ['helmet', 'core', 'arms', 'legs', 'undersuit', 'backpack'];

// Inventory: what an item may be, by the category chosen. ctx.commodities() is read from the live price feed.
export function invItemSource(cat, ctx = {}) {
  const wiki = (keys, min = 2) => ({ min, delay: 300, get: (q) => itemNames(keys, q) });
  switch (cat) {
    case 'Weapon': return { get: async (q) => uniq([...(await gunNames().catch(() => [])), ...(q.length >= 2 ? await itemNames(['weapon'], q).catch(() => []) : [])]) };
    case 'Armor': return wiki(ARMOR_KEYS);
    case 'Attachment': return wiki(['attach']);
    case 'Gadget / medical': return wiki(['gadget']);
    case 'Ship component': return { get: async () => uniq([...(await componentNames()), ...(await gunNames())]) };
    case 'Commodity':
    case 'Material': return { get: async () => { const l = uniq((ctx.commodities ? ctx.commodities() : []) || []); if (!l.length) throw new Error('no commodity list'); return l; } };
    default: return wiki(['']);
  }
}

// Inventory places: game places, the player's ships (as "My <ship>") and places the inventory already holds.
export function placeSource(ctx = {}) {
  return { get: async () => {
    const l = uniq([...(ctx.places ? ctx.places() : []), ...(ctx.ships ? ctx.ships().map((n) => `My ${n}`) : []), ...(ctx.used ? ctx.used() : [])]);
    if (!l.length) throw new Error('no places');
    return l;
  } };
}

// What each wishlist kind may be: null means free text, since there is no list for it.
export function wishSource(kind) {
  switch (kind) {
    case 'Ship': return { get: shipNames };
    case 'Component': return { get: componentNames };
    case 'Weapon': return { get: async (q) => uniq([...(await gunNames().catch(() => [])), ...(q.length >= 2 ? await itemNames(['weapon'], q).catch(() => []) : [])]) };
    case 'Armor': return { min: 2, delay: 300, get: (q) => itemNames(ARMOR_KEYS, q) };
    case 'Blueprint': return { get: blueprintNames };
    default: return null;
  }
}

// Plan hub maths and bookkeeping (pure, no DOM): the blueprints a player owns, their wishlist, and how stale an import is.
// Everything here is what the player scanned or typed; nothing is assumed about the game's blueprint list.

export const WISH_KINDS = ['Ship', 'Component', 'Weapon', 'Armor', 'Blueprint', 'Other'];
export const MAX_BP = 1500;
export const MAX_WISH = 300;

export const keyOf = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// Tier labels are copied as written ("Q3", "Grade B", "4"). To keep the better of two scans we compare the number in them.
export const tierRank = (t) => { const m = String(t ?? '').match(/\d+/); return m ? Number(m[0]) : null; };
export const betterTier = (a, b) => {
  if (!a) return b || null; if (!b) return a;
  const x = tierRank(a), y = tierRank(b);
  return x != null && y != null ? (y > x ? b : a) : a;
};

// state = { owned: { key: {name, category, tier, at} }, scannedAt: ms|null }
export const emptyBp = () => ({ owned: {}, scannedAt: null });
export function cleanBp(raw) {
  const out = emptyBp();
  if (!raw || typeof raw !== 'object') return out;
  out.scannedAt = Number.isFinite(raw.scannedAt) ? raw.scannedAt : null;
  for (const [k, v] of Object.entries(raw.owned && typeof raw.owned === 'object' ? raw.owned : {}).slice(0, MAX_BP)) {
    const name = clip(v && v.name, 80); if (!name) continue;
    out.owned[keyOf(name) || k] = { name, category: clip(v.category, 60) || null, tier: clip(v.tier, 30) || null, at: Number.isFinite(v.at) ? v.at : null };
  }
  return out;
}

// A fabricator scan lists what the character can craft right now, so by default it REPLACES the owned list for the
// categories it covers (a blueprint that is gone from a category you re-scanned is no longer owned). Rows the scan marked
// as locked (owned === false) are never stored as owned.
export function applyScan(state, rows, { replace = true, now = Date.now() } = {}) {
  const next = cleanBp(state);
  const seen = (Array.isArray(rows) ? rows : []).filter((r) => r && r.name && r.owned !== false);
  const cats = new Set(seen.map((r) => keyOf(r.category)).filter(Boolean));
  const prev = { ...next.owned };
  if (replace) {
    for (const [k, v] of Object.entries(next.owned)) if (cats.has(keyOf(v.category))) delete next.owned[k];
  }
  let added = 0, kept = 0;
  for (const r of seen) {
    const name = clip(r.name, 80), k = keyOf(name); if (!k) continue;
    const old = next.owned[k] || prev[k];
    if (old) kept++; else added++;
    next.owned[k] = { name, category: clip(r.category, 60) || (old && old.category) || null, tier: betterTier(old && old.tier, clip(r.tier, 30) || null), at: now };
  }
  next.scannedAt = now;
  const keys = Object.keys(next.owned);
  if (keys.length > MAX_BP) for (const k of keys.slice(MAX_BP)) delete next.owned[k];
  return { state: next, added, kept, categories: [...cats].length };
}

export function addOwned(state, name, category, now = Date.now()) {
  const nm = clip(name, 80), k = keyOf(nm); if (!k) return cleanBp(state);
  const next = cleanBp(state);
  next.owned[k] = { name: nm, category: clip(category, 60) || null, tier: (next.owned[k] && next.owned[k].tier) || null, at: now };
  return next;
}
export function removeOwned(state, key) { const next = cleanBp(state); delete next.owned[key]; return next; }
export function listOwned(state, { q = '', category = '' } = {}) {
  const needle = keyOf(q);
  return Object.entries(cleanBp(state).owned)
    .map(([key, v]) => ({ key, ...v }))
    .filter((v) => (!category || keyOf(v.category) === keyOf(category)) && (!needle || keyOf(v.name).includes(needle)))
    .sort((a, b) => (a.category || '~').localeCompare(b.category || '~') || a.name.localeCompare(b.name));
}
export const categoriesOf = (state) => [...new Set(Object.values(cleanBp(state).owned).map((v) => v.category).filter(Boolean))].sort();

// Days since the last fabricator import (null when never), and the label the pre-launch checklist shows.
export const staleDays = (scannedAt, now = Date.now()) => (Number.isFinite(scannedAt) ? Math.max(0, Math.floor((now - scannedAt) / 86400000)) : null);
export function staleLabel(scannedAt, now = Date.now()) {
  const d = staleDays(scannedAt, now);
  if (d == null) return 'never imported';
  return d === 0 ? 'imported today' : d === 1 ? 'imported yesterday' : `imported ${d} days ago`;
}

// ------------------------------------------------------------ wishlist
// item = { id, kind, name, prio 1|2|3, note, got, at }
export function cleanWish(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = clip(raw.name, 80); if (!name) return null;
  const kind = WISH_KINDS.includes(raw.kind) ? raw.kind : 'Other';
  const prio = [1, 2, 3].includes(Number(raw.prio)) ? Number(raw.prio) : 2;
  return { id: clip(raw.id, 40) || `w-${Date.now().toString(36)}`, kind, name, prio, note: clip(raw.note, 200), got: !!raw.got, at: Number.isFinite(raw.at) ? raw.at : null };
}
export const cleanWishlist = (list) => (Array.isArray(list) ? list.map(cleanWish).filter(Boolean).slice(0, MAX_WISH) : []);
export function addWish(list, item, now = Date.now()) {
  const w = cleanWish({ ...item, id: item.id || `w-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: now });
  const cur = cleanWishlist(list); if (!w) return cur;
  if (cur.some((x) => x.kind === w.kind && keyOf(x.name) === keyOf(w.name))) return cur;
  return [...cur, w].slice(0, MAX_WISH);
}
export const patchWish = (list, id, patch) => cleanWishlist(list).map((w) => (w.id === id ? cleanWish({ ...w, ...patch, id: w.id }) : w));
export const removeWish = (list, id) => cleanWishlist(list).filter((w) => w.id !== id);
// Open items first, highest priority (1) first, then newest.
export const sortWish = (list) => cleanWishlist(list).sort((a, b) => a.got - b.got || a.prio - b.prio || (b.at || 0) - (a.at || 0));

// ------------------------------------------------------------ catalog (the wiki's list of every blueprint)
// A catalog row is owned when the player's fabricator scan (or hand list) has its output name, or when the game gives it to
// every player at the start (is_available_by_default). Names are matched the way the fabricator prints them, so a name the
// wiki words differently will show as not owned until it is added by hand.
export const ownedState = (bp, row) => (bp.owned[keyOf(row.name)] ? 'owned' : row.def ? 'start' : 'missing');
export const catalogTypes = (list) => [...new Set((Array.isArray(list) ? list : []).map((r) => r.type).filter(Boolean))].sort();
export function catalogView(list, bp, { q = '', type = '', status = 'all' } = {}) {
  const state = cleanBp(bp), needle = keyOf(q);
  return (Array.isArray(list) ? list : []).filter((r) => {
    if (type && r.type !== type) return false;
    if (needle && !(keyOf(r.name).includes(needle) || (r.ing || []).some((i) => keyOf(i.n).includes(needle)))) return false;
    const s = ownedState(state, r);
    return status === 'all' || (status === 'have' ? s !== 'missing' : s === status);
  });
}
export const craftTime = (sec) => (!Number.isFinite(sec) ? '—' : sec < 60 ? `${Math.round(sec)} s` : sec < 3600 ? `${Math.round(sec / 60)} min` : `${Math.round(sec / 360) / 10} h`);
export const recipeText = (ing) => (Array.isArray(ing) ? ing : []).map((i) => (i.scu != null ? `${i.n} ${i.scu} SCU` : i.q != null ? `${i.n} ×${i.q}` : i.n)).join(' · ');

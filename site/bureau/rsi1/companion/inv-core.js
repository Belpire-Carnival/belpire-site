// Inventory across systems: what you have stored and where. A scan (or typing) fills a place; each place remembers when it was
// last updated, since the game has no way to read your inventory live. Pure functions, stored under arsenal.inventory by inv-ui.js.
export const MAX_ITEMS = 1500;
export const CATEGORIES = ['Weapon', 'Armor', 'Attachment', 'Gadget / medical', 'Ship component', 'Commodity', 'Material', 'Other'];
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
export const keyOf = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const qtyOf = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? Math.max(0, Math.min(1e7, Math.round(n * 1000) / 1000)) : null; };

export function cleanItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = clip(raw.name, 80), place = clip(raw.place, 80); if (!name || !place) return null;
  const qty = qtyOf(raw.qty ?? 1);
  return { name, place, system: clip(raw.system, 40), cat: CATEGORIES.includes(raw.cat) ? raw.cat : 'Other', qty: qty == null ? 1 : qty, at: Number.isFinite(raw.at) ? raw.at : null };
}
export const cleanInv = (list) => (Array.isArray(list) ? list.map(cleanItem).filter(Boolean).slice(0, MAX_ITEMS) : []);
const same = (a, b) => keyOf(a.name) === keyOf(b.name) && keyOf(a.place) === keyOf(b.place);

// Add one item (or raise its count if that place already holds it).
export function addItem(inv, item, now = Date.now()) {
  const cur = cleanInv(inv), it = cleanItem({ ...item, at: now }); if (!it) return cur;
  const i = cur.findIndex((x) => same(x, it));
  if (i < 0) return [...cur, it].slice(0, MAX_ITEMS);
  cur[i] = { ...cur[i], qty: cur[i].qty + it.qty, cat: it.cat !== 'Other' ? it.cat : cur[i].cat, at: now };
  return cur;
}
export const setQty = (inv, name, place, qty, now = Date.now()) =>
  cleanInv(inv).map((x) => (same(x, { name, place }) ? { ...x, qty: qtyOf(qty) ?? x.qty, at: now } : x)).filter((x) => x.qty > 0);
export const removeItem = (inv, name, place) => cleanInv(inv).filter((x) => !same(x, { name, place }));

// A scan of one storage screen: replace=true makes the place match the scan exactly; otherwise rows are added or raised.
export function importRows(inv, place, rows, { replace = false, system = '' } = {}, now = Date.now()) {
  const p = clip(place, 80); if (!p) return cleanInv(inv);
  let cur = cleanInv(inv);
  if (replace) cur = cur.filter((x) => keyOf(x.place) !== keyOf(p));
  for (const r of Array.isArray(rows) ? rows : []) {
    const it = cleanItem({ ...r, place: p, system: r?.system || system, at: now }); if (!it) continue;
    const i = cur.findIndex((x) => same(x, it));
    if (i < 0) cur.push(it); else cur[i] = { ...cur[i], qty: replace ? it.qty : Math.max(cur[i].qty, it.qty), cat: it.cat !== 'Other' ? it.cat : cur[i].cat, at: now };
  }
  return cur.slice(0, MAX_ITEMS);
}

export function search(inv, q = '', place = '') {
  const k = keyOf(q);
  return cleanInv(inv).filter((x) => (!place || keyOf(x.place) === keyOf(place)) && (!k || keyOf(x.name).includes(k) || keyOf(x.cat).includes(k)))
    .sort((a, b) => a.place.localeCompare(b.place) || a.name.localeCompare(b.name));
}
// Places with how many items they hold and when they were last updated.
export function places(inv) {
  const m = new Map();
  for (const x of cleanInv(inv)) {
    const k = keyOf(x.place); const p = m.get(k) || { place: x.place, system: x.system, items: 0, units: 0, at: null };
    p.items++; p.units += x.qty; if (x.at && (!p.at || x.at > p.at)) p.at = x.at; if (!p.system && x.system) p.system = x.system; m.set(k, p);
  }
  return [...m.values()].sort((a, b) => a.place.localeCompare(b.place));
}
// Where is it, and how many in total.
export function whereIs(inv, name) {
  const hits = cleanInv(inv).filter((x) => keyOf(x.name).includes(keyOf(name)) && keyOf(name));
  return { total: hits.reduce((t, x) => t + x.qty, 0), at: hits.map((x) => ({ place: x.place, name: x.name, qty: x.qty })) };
}

// OmniDash bookkeeping (pure, no DOM): several named dashboards, each an ordered list of widgets with a size. Saved under
// "arsenal.dash" (so it goes to your profile like everything else). A widget id names a panel on another page: "<view>:<title>".

export const SIZES = ['s', 'm', 'l'];
export const MAX_BOARDS = 12, MAX_ITEMS = 40;
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const WID = /^[a-z]+:[a-z0-9-]{1,60}$/;
export const slug = (s) => clip(s, 80).toLowerCase().replace(/&amp;/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'panel';
export const widgetId = (view, title) => `${view}:${slug(title)}`;

// The first dashboard: what the player asked for (game activity, progress, money and the day, ships). Panels that do not exist
// on this page are simply skipped when it is drawn.
export const STARTER = [
  ['ops:from-your-game', 'm'], ['ops:contracts-from-the-game', 'l'], ['ops:omniglass-desktop', 'm'],
  ['ops:reputation-ranks', 'm'], ['blueprints:your-blueprints', 'm'], ['wishlist:what-you-want', 'm'],
  ['ops:today', 's'], ['ops:last-7-days', 's'], ['ops:best-rate', 's'], ['ops:next-objective', 'm'],
  ['ops:your-hangar', 'm'], ['ops:where-things-live', 'm']
];
export const defaultDash = () => ({ v: 1, active: 'main', boards: [{ id: 'main', name: 'Main', items: STARTER.map(([w, size]) => ({ w, size })) }] });

export function cleanDash(raw) {
  const boards = [], ids = new Set();
  for (const b of Array.isArray(raw && raw.boards) ? raw.boards.slice(0, MAX_BOARDS) : []) {
    const id = clip(b && b.id, 20);
    if (!/^[a-z0-9]{1,20}$/.test(id) || ids.has(id)) continue;
    ids.add(id);
    const items = [];
    for (const it of Array.isArray(b.items) ? b.items.slice(0, MAX_ITEMS) : []) {
      if (it && WID.test(String(it.w || ''))) items.push({ w: it.w, size: SIZES.includes(it.size) ? it.size : 'm' });
    }
    boards.push({ id, name: clip(b.name, 40) || 'Dashboard', items });
  }
  if (!boards.length) return defaultDash();
  const active = boards.some((b) => b.id === raw.active) ? raw.active : boards[0].id;
  return { v: 1, active, boards };
}

const copy = (d) => cleanDash(JSON.parse(JSON.stringify(d)));
const board = (d) => d.boards.find((b) => b.id === d.active);
export const activeBoard = (d) => board(cleanDash(d));

export function addBoard(d, name) {
  const n = copy(d);
  if (n.boards.length >= MAX_BOARDS) return n;
  let i = n.boards.length + 1; while (n.boards.some((b) => b.id === `b${i}`)) i++;
  n.boards.push({ id: `b${i}`, name: clip(name, 40) || `Dashboard ${i}`, items: [] });
  n.active = `b${i}`;
  return n;
}
export function renameBoard(d, name) { const n = copy(d); const b = board(n); if (b && clip(name, 40)) b.name = clip(name, 40); return n; }
export function removeBoard(d) {
  const n = copy(d);
  if (n.boards.length <= 1) return n; // keep at least one
  n.boards = n.boards.filter((b) => b.id !== n.active); n.active = n.boards[0].id;
  return n;
}
export function setActive(d, id) { const n = copy(d); if (n.boards.some((b) => b.id === id)) n.active = id; return n; }
export function addItem(d, w, size = 'm') {
  const n = copy(d); const b = board(n);
  if (b && WID.test(w) && b.items.length < MAX_ITEMS && !b.items.some((it) => it.w === w)) b.items.push({ w, size: SIZES.includes(size) ? size : 'm' });
  return n;
}
export function removeItem(d, i) { const n = copy(d); board(n).items.splice(i, 1); return n; }
export function moveItem(d, from, to) {
  const n = copy(d); const items = board(n).items;
  if (from < 0 || from >= items.length) return n;
  const [it] = items.splice(from, 1); items.splice(Math.max(0, Math.min(items.length, to)), 0, it);
  return n;
}
export function resizeItem(d, i, size) { const n = copy(d); const it = board(n).items[i]; if (it && SIZES.includes(size)) it.size = size; return n; }
export const same = (a, b) => JSON.stringify(cleanDash(a)) === JSON.stringify(cleanDash(b));

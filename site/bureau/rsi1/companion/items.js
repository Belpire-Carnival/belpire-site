// Item lookup for the loadout and wardrobe fields: type two letters of a weapon, armor piece, clothing item or
// ship component and pick it from the wiki's list, with its picture. Requests only go to this site's own /api.
import { photo } from './art.js';

// What a stored picture path may look like (the same rule the worker applies).
export const IMG_OK = /^(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/[A-Za-z0-9._%()~'+-]{1,160}(?:\/[0-9]{2,4}px-[A-Za-z0-9._%()~'+-]{1,160})?$/;
export const cleanImg = (p) => (typeof p === 'string' && IMG_OK.test(p) ? p : '');

const cache = new Map();
let ctl = null;

async function search(q, type = '') {
  const key = `${type}:${q.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key);
  ctl?.abort();
  ctl = new AbortController();
  const res = await fetch(`/api/sc-item?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}`, { signal: ctl.signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(String(res.status));
  const j = await res.json();
  const items = Array.isArray(j.items) ? j.items : [];
  cache.set(key, items);
  return items;
}

// Adds a suggestion list under a text input. onPick({ name, img }) runs when an entry is chosen.
export function attachPicker(input, onPick, { type = '' } = {}) {
  const box = document.createElement('div');
  box.className = 'picklist';
  box.hidden = true;
  box.setAttribute('role', 'listbox');
  input.parentNode.classList.add('hasPick');
  input.parentNode.append(box);
  let timer = 0;
  const close = () => { box.hidden = true; box.textContent = ''; };
  const note = (t) => { box.textContent = ''; const p = document.createElement('div'); p.className = 'sugg note'; p.textContent = t; box.append(p); box.hidden = false; };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = setTimeout(async () => {
      note('Searching…');
      try {
        const items = await search(q, type);
        if (input.value.trim() !== q) return;
        if (!items.length) return note('No match. Your own text is kept.');
        box.textContent = '';
        for (const it of items) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'sugg'; b.setAttribute('role', 'option');
          const meta = [it.mfr, it.kind || it.sub || it.type, it.size != null ? `S${it.size}` : '', (it.info || '').slice(0, 70)].filter(Boolean).join(' · ');
          const t = document.createElement('span');
          const n = document.createElement('b'); n.textContent = it.name;
          const m = document.createElement('small'); m.textContent = meta;
          t.append(n, m);
          b.append(photo(cleanImg(it.img), '', (() => { const s = document.createElement('span'); s.className = 'photo thumb none'; return s; })(), 'photo thumb'), t);
          b.addEventListener('mousedown', (e) => e.preventDefault());
          b.addEventListener('click', () => { input.value = it.name; onPick({ name: it.name, img: cleanImg(it.img), info: String(it.info || '').slice(0, 220), wpn: it.wpn || null }); close(); });
          box.append(b);
        }
        box.hidden = false;
      } catch (err) {
        if (err?.name !== 'AbortError') note('Item search is unavailable right now. You can still type the name.');
      }
    }, 350);
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

// A row of small pictures for the pieces that have one.
export function thumbStrip(entries) {
  const row = document.createElement('div');
  row.className = 'thumbstrip';
  for (const [label, name, img] of entries) {
    if (!img) continue;
    const fb = document.createElement('span'); fb.className = 'photo thumb none';
    const w = document.createElement('span'); w.className = 'tstrip'; w.title = `${label}: ${name}`;
    w.append(photo(img, `${label}: ${name}`, fb, 'photo thumb'));
    row.append(w);
  }
  return row.childNodes.length ? row : null;
}

// ---------------------------------------------------------------- browsable catalog (the dressing room)
const pageCache = new Map();
async function browse(type, page) {
  const key = `${type}:${page}`;
  if (pageCache.has(key)) return pageCache.get(key);
  const res = await fetch(`/api/sc-item?type=${encodeURIComponent(type)}&page=${page}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(String(res.status));
  const j = await res.json();
  const out = { items: Array.isArray(j.items) ? j.items : [], more: !!j.more };
  pageCache.set(key, out);
  return out;
}

// A panel that lists every item the wiki knows for one slot, a page at a time, with a filter box.
// onPick({ name, img, info, wpn }) runs when a card is chosen; the panel stays open so several can be tried.
export function catalogPanel({ type, label, current = () => '', onPick, onClose }) {
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const root = mk('div', 'catalog');
  const head = mk('div', 'cat-head');
  const title = mk('b', '', `${label} catalog`);
  const q = mk('input'); q.type = 'search'; q.placeholder = `Filter ${label.toLowerCase()}…`; q.setAttribute('aria-label', `Filter ${label}`); q.maxLength = 40;
  const close = mk('button', 'ghost', 'Close'); close.type = 'button';
  head.append(title, q, close);
  const grid = mk('div', 'cat-grid');
  const note = mk('p', 'small muted m0', 'Loading…');
  const more = mk('button', '', 'Load more'); more.type = 'button'; more.hidden = true;
  root.append(head, grid, note, more);
  let items = [], page = 0, hasMore = true, busy = false, dead = false;
  const shown = () => { const f = q.value.trim().toLowerCase(); return f ? items.filter((it) => `${it.name} ${it.mfr} ${it.kind} ${it.sub}`.toLowerCase().includes(f)) : items; };
  const draw = () => {
    const rows = shown();
    grid.textContent = '';
    const now = current();
    for (const it of rows) {
      const b = mk('button', `cat-card${it.name === now ? ' sel' : ''}`); b.type = 'button'; b.title = it.info || it.name;
      b.append(photo(cleanImg(it.img), '', (() => mk('span', 'photo thumb none'))(), 'photo thumb'));
      const t = mk('span', 'cat-text'); t.append(mk('b', '', it.name), mk('small', '', [it.mfr, it.kind || it.sub].filter(Boolean).join(' · ')));
      b.append(t);
      b.addEventListener('click', () => { onPick({ name: it.name, img: cleanImg(it.img), info: String(it.info || '').slice(0, 220), wpn: it.wpn || null }); draw(); });
      grid.append(b);
    }
    note.textContent = busy ? 'Loading…' : rows.length ? `${rows.length} shown${q.value.trim() ? ` of ${items.length} loaded` : ''}${hasMore ? '' : ' · end of list'}` : (hasMore ? 'No match in the pages loaded so far.' : 'Nothing matches.');
    more.hidden = !hasMore || busy;
  };
  const load = async (auto = 0) => {
    if (busy || !hasMore || dead) return;
    busy = true; draw();
    try {
      const r = await browse(type, page + 1);
      page += 1; items = items.concat(r.items); hasMore = r.more;
    } catch { hasMore = false; note.textContent = 'The item list is unavailable right now. You can still type a name in the slot.'; busy = false; more.hidden = true; return; }
    busy = false; draw();
    // A filter with no hits keeps reading pages (a few at a time) so a name further down the list can still be found.
    if (q.value.trim() && !shown().length && hasMore && auto < 6) load(auto + 1);
  };
  let t = 0;
  q.addEventListener('input', () => { draw(); clearTimeout(t); t = setTimeout(() => { if (q.value.trim() && !shown().length && hasMore) load(); }, 300); });
  more.addEventListener('click', () => load());
  close.addEventListener('click', () => { dead = true; onClose?.(); });
  load();
  return root;
}

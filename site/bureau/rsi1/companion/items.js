// Item lookup for the loadout and wardrobe fields: type two letters of a weapon, armor piece, clothing item or
// ship component and pick it from the wiki's list, with its picture. Requests only go to this site's own /api.
import { photo } from './art.js';

// What a stored picture path may look like (the same rule the worker applies).
export const IMG_OK = /^(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/[A-Za-z0-9._%()~'+-]{1,160}(?:\/[0-9]{2,4}px-[A-Za-z0-9._%()~'+-]{1,160})?$/;
export const cleanImg = (p) => (typeof p === 'string' && IMG_OK.test(p) ? p : '');

const cache = new Map();
let ctl = null;

async function search(q) {
  const key = q.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  ctl?.abort();
  ctl = new AbortController();
  const res = await fetch(`/api/sc-item?q=${encodeURIComponent(q)}`, { signal: ctl.signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(String(res.status));
  const j = await res.json();
  const items = Array.isArray(j.items) ? j.items : [];
  cache.set(key, items);
  return items;
}

// Adds a suggestion list under a text input. onPick({ name, img }) runs when an entry is chosen.
export function attachPicker(input, onPick) {
  const box = document.createElement('div');
  box.className = 'picklist';
  box.hidden = true;
  box.setAttribute('role', 'listbox');
  input.parentNode.classList.add('hasPick');
  input.parentNode.append(box);
  let timer = 0;
  const close = () => { box.hidden = true; box.textContent = ''; };
  const note = (t) => { box.textContent = ''; const p = document.createElement('div'); p.className = 'pick note'; p.textContent = t; box.append(p); box.hidden = false; };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = setTimeout(async () => {
      note('Searching…');
      try {
        const items = await search(q);
        if (input.value.trim() !== q) return;
        if (!items.length) return note('No match. Your own text is kept.');
        box.textContent = '';
        for (const it of items) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'pick'; b.setAttribute('role', 'option');
          const meta = [it.mfr, it.sub || it.type, it.size != null ? `S${it.size}` : ''].filter(Boolean).join(' · ');
          const t = document.createElement('span');
          const n = document.createElement('b'); n.textContent = it.name;
          const m = document.createElement('small'); m.textContent = meta;
          t.append(n, m);
          b.append(photo(cleanImg(it.img), '', (() => { const s = document.createElement('span'); s.className = 'photo thumb none'; return s; })(), 'photo thumb'), t);
          b.addEventListener('mousedown', (e) => e.preventDefault());
          b.addEventListener('click', () => { input.value = it.name; onPick({ name: it.name, img: cleanImg(it.img) }); close(); });
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

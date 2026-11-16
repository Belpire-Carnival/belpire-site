// Pictures for parts the item database has none for. A part with its own picture shows it at once; one without shows the drawn
// placeholder and asks /api/sc-partimg (batched, once per name) for the picture on its wiki page, swapping it in if one exists.
import { photo } from './art.js';

const found = new Map(); // name -> media path or ''
const waiting = new Map(); // name -> [callbacks]
let timer = null;

async function flush() {
  timer = null;
  const names = [...waiting.keys()];
  for (let i = 0; i < names.length; i += 12) {
    const chunk = names.slice(i, i + 12);
    let images = {};
    try {
      const res = await fetch(`/api/sc-partimg?${chunk.map((n) => `n=${encodeURIComponent(n)}`).join('&')}`, { headers: { Accept: 'application/json' } });
      if (res.ok) images = (await res.json())?.images || {};
    } catch { /* leave the placeholders */ }
    for (const n of chunk) {
      const path = typeof images[n] === 'string' ? images[n] : '';
      found.set(n, path);
      for (const cb of waiting.get(n) || []) cb(path);
      waiting.delete(n);
    }
  }
}

export function lazyPhoto(part, cls = 'photo thumb', blank = () => { const s = document.createElement('span'); s.className = `${cls} none`; return s; }) {
  const alt = part?.name || '';
  const fallback = blank();
  if (part?.img) return photo(part.img, alt, fallback, cls);
  const name = String(alt).trim();
  if (name.length < 2) return fallback;
  const swap = (path) => { if (path && fallback.parentNode) fallback.replaceWith(photo(path, alt, blank(), cls)); };
  if (found.has(name)) { const path = found.get(name); if (path) queueMicrotask(() => swap(path)); return fallback; }
  if (!waiting.has(name)) waiting.set(name, []);
  waiting.get(name).push(swap);
  if (!timer) timer = setTimeout(flush, 120);
  return fallback;
}

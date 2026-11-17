// Strict autocomplete for a text field: suggestions as you type, and the field only counts as filled once its text is
// an entry of the list it was given. Source: { get(q) -> Promise<string[]>, min } or null for a free-text field.
// Text nodes only. Reuses the suggestion list styling of the item picker.
import { rank, exact, norm } from './pick-core.js';

export function strictPick(input, { onChange = () => {}, limit = 8 } = {}) {
  const box = document.createElement('div');
  box.className = 'picklist';
  box.hidden = true;
  box.setAttribute('role', 'listbox');
  input.parentNode.classList.add('hasPick');
  input.parentNode.append(box);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  let source = null, chosen = '', shown = [], active = -1, timer = 0, token = 0, last = false;

  const free = () => source === null;
  const valid = () => (free() ? !!input.value.trim() : !!chosen && norm(chosen) === norm(input.value));
  const tell = () => { const v = valid(); if (v !== last) { last = v; } onChange(v); };
  const mark = (bad) => input.setAttribute('aria-invalid', bad ? 'true' : 'false');
  const close = () => { box.hidden = true; box.textContent = ''; shown = []; active = -1; };
  const note = (t) => { box.textContent = ''; const p = document.createElement('div'); p.className = 'sugg note'; p.textContent = t; box.append(p); box.hidden = false; shown = []; active = -1; };
  const light = () => { [...box.children].forEach((c, i) => { c.classList.toggle('on', i === active); c.setAttribute('aria-selected', String(i === active)); }); };

  function choose(name) {
    input.value = name; chosen = name; close(); mark(false); tell();
  }
  function paint(names) {
    box.textContent = '';
    shown = names;
    active = -1;
    for (const n of names) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sugg'; b.setAttribute('role', 'option');
      const t = document.createElement('span'); const bold = document.createElement('b'); bold.textContent = n; t.append(bold); b.append(t);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => choose(n));
      box.append(b);
    }
    box.hidden = !names.length;
  }
  async function run() {
    const q = input.value.trim(), my = ++token;
    if (free()) { close(); return; }
    if (q.length < (source.min ?? 1)) { close(); return; }
    let list;
    try { list = await source.get(q); } catch { if (my === token) note('That list is not available right now. Try again in a moment.'); return; }
    if (my !== token) return;
    const hit = exact(list, q);
    if (hit) { chosen = hit; tell(); }
    const names = rank(list, q, limit);
    if (!names.length) { note('No match in the list.'); return; }
    paint(names);
  }

  input.addEventListener('input', () => {
    chosen = ''; mark(false); tell();
    clearTimeout(timer);
    timer = setTimeout(run, source?.delay ?? 120);
  });
  input.addEventListener('focus', () => { if (!free() && input.value.trim()) run(); });
  input.addEventListener('blur', () => { setTimeout(close, 150); mark(!free() && !!input.value.trim() && !valid()); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!shown.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; light();
      return;
    }
    if (e.key === 'Enter' && !free() && !valid() && shown.length) {
      e.preventDefault(); e.stopImmediatePropagation();
      choose(shown[active >= 0 ? active : 0]);
    }
  });

  return {
    valid,
    value: () => (free() ? input.value.trim() : valid() ? chosen : ''),
    setSource(s) { source = s || null; chosen = ''; token++; close(); mark(false); tell(); if (!free() && input.value.trim()) run(); },
    reset() { input.value = ''; chosen = ''; token++; close(); mark(false); tell(); }
  };
}

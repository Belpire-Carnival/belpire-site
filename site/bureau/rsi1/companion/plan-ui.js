// Plan hub panes: the Wishlist and the Blueprints list. Text nodes only; choices live in this browser's localStorage
// (arsenal.plan.*, which the companion profile sync carries between devices). The maths is in plan-core.js.
import { WISH_KINDS, keyOf, cleanBp, applyScan, addOwned, removeOwned, listOwned, categoriesOf, staleLabel, cleanWishlist, addWish, patchWish, removeWish, sortWish } from './plan-core.js';

const K_BP = 'arsenal.plan.bp';
const K_WISH = 'arsenal.plan.wish';
const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };
const changed = () => window.dispatchEvent(new CustomEvent('arsenal:plan'));

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const field = (label, input) => el('label', { class: 'pf' }, el('span', { class: 'small muted', text: label }), input);
const PRIO = [[1, 'High'], [2, 'Normal'], [3, 'Someday']];

export const planState = () => ({ bp: cleanBp(read(K_BP, null)), wish: cleanWishlist(read(K_WISH, [])) });

// ---------------------------------------------------------------- wishlist
export function initWishlist(host) {
  if (!host) return null;
  const kind = el('select', { 'aria-label': 'What kind of thing' }, ...WISH_KINDS.map((k) => el('option', { value: k, text: k })));
  const name = el('input', { type: 'text', maxlength: '80', placeholder: 'e.g. Carrack, Railgun, a helmet', 'aria-label': 'Name' });
  const prio = el('select', { 'aria-label': 'Priority' }, ...PRIO.map(([v, t]) => el('option', { value: String(v), text: t })));
  prio.value = '2';
  const note = el('input', { type: 'text', maxlength: '200', placeholder: 'Where to get it, what it costs, why', 'aria-label': 'Note' });
  const add = el('button', { type: 'button', class: 'primary', text: 'Add to wishlist' });
  const show = el('select', { 'aria-label': 'Show' }, el('option', { value: 'open', text: 'Still wanted' }), el('option', { value: 'all', text: 'Everything' }), el('option', { value: 'got', text: 'Got it' }));
  const sum = el('div', { class: 'small muted mt8' }), list = el('div', { class: 'mt8' });
  host.append(
    el('div', { class: 'row pfrow' }, field('Kind', kind), field('Name', name), field('Priority', prio)),
    el('div', { class: 'row pfrow mt6' }, field('Note', note), add),
    el('div', { class: 'row mt12' }, field('Show', show)), sum, list);

  const wish = () => cleanWishlist(read(K_WISH, []));
  const save = (w) => { write(K_WISH, w); draw(); changed(); };
  function draw() {
    const bp = cleanBp(read(K_BP, null)), all = wish();
    const owned = (w) => w.kind === 'Blueprint' && !!bp.owned[keyOf(w.name)];
    const done = (w) => w.got || owned(w);
    const open = all.filter((w) => !done(w)).length;
    sum.textContent = all.length ? `${open} still wanted · ${all.length - open} got · ${all.length} total` : 'Nothing on the wishlist yet.';
    list.replaceChildren();
    const rows = sortWish(all).filter((w) => (show.value === 'open' ? !done(w) : show.value === 'got' ? done(w) : true));
    if (!rows.length) { if (all.length) list.append(el('p', { class: 'small muted', text: 'Nothing in this view.' })); return; }
    const tb = el('tbody');
    for (const w of rows) {
      const got = el('input', { type: 'checkbox', 'aria-label': `Got ${w.name}` }); got.checked = done(w); got.disabled = owned(w);
      got.addEventListener('change', () => save(patchWish(wish(), w.id, { got: got.checked })));
      const p = el('select', { 'aria-label': `Priority for ${w.name}` }, ...PRIO.map(([v, t]) => el('option', { value: String(v), text: t })));
      p.value = String(w.prio);
      p.addEventListener('change', () => save(patchWish(wish(), w.id, { prio: Number(p.value) })));
      const rm = el('button', { type: 'button', class: 'ghost', text: '✕', 'aria-label': `Remove ${w.name}` });
      rm.addEventListener('click', () => save(removeWish(wish(), w.id)));
      tb.append(el('tr', { class: done(w) ? 'gotrow' : '' }, el('td', {}, got), el('td', {}, el('b', { text: w.name }), owned(w) ? el('span', { class: 'chip ok', text: 'owned' }) : null, w.note ? el('div', { class: 'small muted', text: w.note }) : null), el('td', { text: w.kind }), el('td', {}, p), el('td', {}, rm)));
    }
    list.append(el('div', { class: 'scrollx' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Got' }), el('th', { text: 'Item' }), el('th', { text: 'Kind' }), el('th', { text: 'Priority' }), el('th', { text: '' }))), tb)));
  }
  add.addEventListener('click', () => {
    if (!name.value.trim()) { name.focus(); return; }
    save(addWish(wish(), { kind: kind.value, name: name.value, prio: Number(prio.value), note: note.value }));
    name.value = ''; note.value = ''; name.focus();
  });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') add.click(); });
  show.addEventListener('change', draw);
  window.addEventListener('arsenal:plan', draw);
  draw();
  return { redraw: draw };
}

// ---------------------------------------------------------------- blueprints
export function initBlueprints(host, { toast = () => {} } = {}) {
  if (!host) return null;
  const q = el('input', { type: 'search', placeholder: 'Search your blueprints', 'aria-label': 'Search blueprints' });
  const cat = el('select', { 'aria-label': 'Category' });
  const sum = el('div', { class: 'small muted mt8' }), list = el('div', { class: 'mt8' });
  const ownName = el('input', { type: 'text', maxlength: '80', placeholder: 'Blueprint you own', 'aria-label': 'Blueprint you own' });
  const ownCat = el('input', { type: 'text', maxlength: '60', placeholder: 'Category (optional)', 'aria-label': 'Category' });
  const ownAdd = el('button', { type: 'button', class: 'ghost', text: 'Add as owned' });
  const wantName = el('input', { type: 'text', maxlength: '80', placeholder: 'Blueprint you want to unlock', 'aria-label': 'Blueprint you want' });
  const wantNote = el('input', { type: 'text', maxlength: '200', placeholder: 'How you think you get it (your own note)', 'aria-label': 'How to unlock' });
  const wantAdd = el('button', { type: 'button', class: 'ghost', text: 'Add to wishlist' });
  host.append(
    el('div', { class: 'row pfrow' }, field('Search', q), field('Category', cat)), sum, list,
    el('details', { class: 'mt12' }, el('summary', { text: 'Add by hand' }),
      el('div', { class: 'row pfrow mt6' }, ownName, ownCat, ownAdd),
      el('div', { class: 'row pfrow mt6' }, wantName, wantNote, wantAdd)));

  const bp = () => cleanBp(read(K_BP, null));
  const save = (s) => { write(K_BP, s); draw(); changed(); };
  function draw() {
    const s = bp(), cats = categoriesOf(s), keep = cat.value;
    cat.replaceChildren(el('option', { value: '', text: 'All categories' }), ...cats.map((c) => el('option', { value: c, text: c })));
    cat.value = cats.includes(keep) ? keep : '';
    const rows = listOwned(s, { q: q.value, category: cat.value });
    const n = Object.keys(s.owned).length;
    sum.textContent = n ? `${n} blueprints owned · ${staleLabel(s.scannedAt)}${rows.length !== n ? ` · showing ${rows.length}` : ''}` : 'No blueprints yet. Scan the Item Fabricator above, or add them by hand.';
    list.replaceChildren();
    if (!rows.length) return;
    const tb = el('tbody');
    for (const r of rows) {
      const rm = el('button', { type: 'button', class: 'ghost', text: '✕', 'aria-label': `Remove ${r.name}` });
      rm.addEventListener('click', () => save(removeOwned(bp(), r.key)));
      tb.append(el('tr', {}, el('td', {}, el('b', { text: r.name })), el('td', { text: r.category || '—' }), el('td', { text: r.tier || '—' }), el('td', {}, rm)));
    }
    list.append(el('div', { class: 'scrollx' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Blueprint' }), el('th', { text: 'Category' }), el('th', { text: 'Tier' }), el('th', { text: '' }))), tb)));
  }
  q.addEventListener('input', draw); cat.addEventListener('change', draw);
  ownAdd.addEventListener('click', () => { if (!ownName.value.trim()) { ownName.focus(); return; } save(addOwned(bp(), ownName.value, ownCat.value)); ownName.value = ''; });
  wantAdd.addEventListener('click', () => {
    if (!wantName.value.trim()) { wantName.focus(); return; }
    write(K_WISH, addWish(read(K_WISH, []), { kind: 'Blueprint', name: wantName.value, note: wantNote.value }));
    wantName.value = ''; wantNote.value = ''; changed(); toast('Added to your wishlist');
  });
  window.addEventListener('arsenal:plan', draw);
  draw();
  return {
    // rows come from a fabricator scan after the player has reviewed them.
    importRows(rows, replace) {
      const res = applyScan(bp(), rows, { replace });
      save(res.state);
      return res;
    }
  };
}

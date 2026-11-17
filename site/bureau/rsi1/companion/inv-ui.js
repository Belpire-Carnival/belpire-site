// Inventory pane (Hangar hub): what you have stored and where, filled by a screenshot scan or by hand.
// Text nodes only. Stored under arsenal.inventory, which the companion profile sync carries between devices. The maths is in inv-core.js.
import { strictPick } from './pick-ui.js';
import { invItemSource, placeSource } from './catalog.js';
import { CATEGORIES, cleanInv, addItem, setQty, removeItem, importRows, search, places, whereIs } from './inv-core.js';

const K = 'arsenal.inventory';
const read = () => { try { return cleanInv(JSON.parse(localStorage.getItem(K))); } catch { return []; } };
const write = (v) => { try { localStorage.setItem(K, JSON.stringify(v)); } catch { /* storage full or blocked */ } };
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const ago = (t) => { if (!t) return 'never'; const d = Math.floor((Date.now() - t) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };

export function initInventory(host, { toast = () => {}, getCommodities = () => [], getPlaces = () => [] } = {}) {
  if (!host) return null;
  const save = (v) => { write(v); draw(); };
  const f = el('input', { type: 'text', maxlength: '60', placeholder: 'Search items, categories', 'aria-label': 'Search your inventory' });
  const pf = el('select', { 'aria-label': 'Filter by place' });
  const where = el('div', { class: 'small muted' }), body = el('div', { class: 'mt12' });
  const nName = el('input', { type: 'text', maxlength: '80', placeholder: 'Start typing an item', 'aria-label': 'Item name' });
  const nQty = el('input', { type: 'number', min: '1', step: '1', value: '1', 'aria-label': 'Quantity' });
  const nPlace = el('input', { type: 'text', maxlength: '80', placeholder: 'Where (start typing a station, city or your ship)', 'aria-label': 'Where it is stored' });
  const dl = el('datalist', { id: 'invPlaces' });
  const nCat = el('select', { 'aria-label': 'Category' }, ...CATEGORIES.map((c) => el('option', { value: c, text: c })));
  const hint = el('div', { class: 'small muted pickhint' });
  const add = el('button', { type: 'button', class: 'primary', text: 'Add item', onclick: () => {
    const item = pItem.value(), where = pPlace.value();
    if (!item || !where) { toast('Pick the item and where it is from the lists'); return; }
    save(addItem(read(), { name: item, qty: nQty.value, place: where, cat: nCat.value })); pItem.reset(); nQty.value = '1'; nName.focus();
  } });
  const fleetShips = () => { try { const v = JSON.parse(localStorage.getItem('arsenal.fleet')); return (Array.isArray(v) ? v : []).map((s) => s && s.name).filter((n) => typeof n === 'string' && n); } catch { return []; } };
  const ctx = { commodities: getCommodities, places: getPlaces, ships: fleetShips, used: () => places(read()).map((p) => p.place) };
  const pItem = strictPick(nName, { onChange: () => sync() });
  const pPlace = strictPick(nPlace, { onChange: () => sync() });
  function sync() {
    add.disabled = !(pItem.valid() && pPlace.valid());
    hint.textContent = !nName.value.trim() || pItem.valid() ? (nPlace.value.trim() && !pPlace.valid() ? 'Choose where it is from the list.' : '') : 'Choose the item from the list.';
  }
  nCat.addEventListener('change', () => { pItem.setSource(invItemSource(nCat.value, ctx)); pItem.reset(); });
  host.append(el('div', { class: 'card' }, el('h3', { text: 'Add an item by hand' }), el('div', { class: 'row fm-form' }, nName, nQty, nCat), el('div', { class: 'row mt8 fm-form' }, nPlace, add), hint, dl),
    el('div', { class: 'card mt12' }, el('div', { class: 'row fm-form' }, f, pf), where, body));
  f.addEventListener('input', draw); pf.addEventListener('change', draw);
  pItem.setSource(invItemSource(nCat.value, ctx)); pPlace.setSource(placeSource(ctx));

  function draw() {
    const inv = read(), pl = places(inv), cur = pf.value;
    pf.replaceChildren(el('option', { value: '', text: 'All places' }), ...pl.map((p) => el('option', { value: p.place, text: `${p.place} (${p.items})` }))); pf.value = pl.some((p) => p.place === cur) ? cur : '';
    dl.replaceChildren(...pl.map((p) => el('option', { value: p.place })));
    const rows = search(inv, f.value, pf.value);
    const w = f.value.trim() ? whereIs(inv, f.value) : null;
    where.textContent = w && w.at.length ? `${w.total} total across ${new Set(w.at.map((x) => x.place)).size} place(s).` : '';
    body.replaceChildren();
    if (!inv.length) { body.append(el('p', { class: 'small muted', text: 'Nothing stored yet. Scan a storage screen below, or add an item above. The game has no live inventory feed, so each place shows when it was last updated.' })); return; }
    if (!rows.length) { body.append(el('p', { class: 'small muted', text: 'No match.' })); return; }
    for (const p of pl.filter((x) => rows.some((r) => r.place === x.place))) {
      const tb = el('tbody');
      for (const r of rows.filter((x) => x.place === p.place)) {
        const q = el('input', { type: 'number', min: '0', step: '1', 'aria-label': `${r.name} quantity` }); q.value = r.qty;
        q.addEventListener('change', () => save(setQty(read(), r.name, r.place, q.value)));
        tb.append(el('tr', {}, el('td', {}, el('b', { text: r.name })), el('td', { class: 'small muted', text: r.cat }), el('td', {}, q),
          el('td', {}, el('button', { type: 'button', class: 'ghost', text: '✕', 'aria-label': `Remove ${r.name}`, onclick: () => save(removeItem(read(), r.name, r.place)) }))));
      }
      body.append(el('h4', { class: 'fm-h', text: `${p.place}${p.system ? ' · ' + p.system : ''}` }), el('p', { class: 'small muted', text: `${p.items} item${p.items === 1 ? '' : 's'} · updated ${ago(p.at)}` }),
        el('div', { class: 'scrollx' }, el('table', {}, tb)));
    }
  }
  draw();
  return {
    draw,
    // Called by the scanner's review table.
    importRows: (place, rows, replace) => { const before = read().length; save(importRows(read(), place, rows, { replace })); return read().length - before; },
    places: () => places(read()).map((p) => p.place)
  };
}

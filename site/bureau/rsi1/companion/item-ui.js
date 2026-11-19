// Item search (Armory hub). Type a name, optionally pick a category, and see the item's numbers, whether the wiki's UEX data lists
// a shop price for it, and where. Text nodes only; requests go to this site's own /api/sc-item (full=1 adds prices and the stat list).
import { photo } from './art.js';
import { cleanImg } from './items.js';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
};
export const CATS = [['', 'Everything'], ['weapon', 'FPS weapons'], ['attach', 'Attachments'], ['gadget', 'Gadgets'], ['helmet', 'Helmets'], ['core', 'Torso'], ['arms', 'Arms'], ['legs', 'Legs'],
  ['undersuit', 'Undersuits'], ['boots', 'Boots'], ['backpack', 'Backpacks']];
const money = (n) => `${Math.round(n).toLocaleString('en-US')} aUEC`;
// "vehicle_weapon.damage_per_second" -> "Damage per second"
export const fieldLabel = (path) => { const t = String(path).split('.').slice(1).join(' · ').replace(/_/g, ' '); return t ? t[0].toUpperCase() + t.slice(1) : String(path); };

export function initItemSearch(host) {
  if (!host) return null;
  let token = 0;
  const q = el('input', { type: 'search', placeholder: 'Item name, e.g. P4-AR, Pyro, Venture', 'aria-label': 'Item name', maxlength: '60', autocomplete: 'off' });
  const cat = el('select', { 'aria-label': 'Category' }, CATS.map(([v, t]) => el('option', { value: v, text: t })));
  const go = el('button', { type: 'button', class: 'btn', text: 'Search' });
  const out = el('div', { class: 'mt12' });
  host.append(el('div', { class: 'row' }, q, cat, go), out);

  const say = (t) => { out.replaceChildren(el('p', { class: 'small muted', text: t })); };
  const card = (it) => {
    const buys = Array.isArray(it.buy) ? it.buy : [];
    const head = el('div', { class: 'row' });
    const img = cleanImg(it.img);
    if (img) head.append(photo(img, it.name, null, 'photo thumb'));
    const facts = [it.mfr, it.kind || it.type, it.size != null ? `Size ${it.size}` : '', it.cls].filter(Boolean).join(' · ');
    head.append(el('div', {}, el('h3', { text: it.name }), el('div', { class: 'small muted', text: facts })));
    const parts = [head];
    if (it.info) parts.push(el('p', { class: 'small', text: it.info }));
    parts.push(el('p', { class: 'small', text: buys.length ? `Sold in shops: from ${money(buys[0].p)}` : 'No shop price on file. It may be loot, mission or reward only, or the price feed has not seen it.' }));
    if (buys.length) {
      parts.push(el('div', { class: 'table-wrap' }, el('table', {},
        el('thead', {}, el('tr', {}, ['Price', 'Terminal', 'Place', 'System', 'Seen'].map((h) => el('th', { text: h })))),
        el('tbody', {}, buys.map((b) => el('tr', {}, el('td', { class: 'num', text: money(b.p) }), el('td', { text: b.at }), el('td', { text: [b.where, b.near].filter(Boolean).join(', ') }), el('td', { text: b.sys }), el('td', { text: b.d })))))));
    }
    const det = Object.entries(it.detail || {});
    if (det.length) {
      parts.push(el('details', {}, el('summary', { text: `All recorded stats (${det.length})` }),
        el('div', { class: 'table-wrap' }, el('table', {}, el('tbody', {}, det.map(([k, v]) => el('tr', {}, el('td', { text: fieldLabel(k) }), el('td', { class: 'num', text: String(v) }))))))));
    }
    return el('div', { class: 'card' }, parts);
  };
  async function run() {
    const text = q.value.replace(/\s+/g, ' ').trim();
    if (text.length < 2) { say('Type at least two letters.'); return; }
    const mine = ++token;
    say('Searching…');
    try {
      const res = await fetch(`/api/sc-item?full=1&q=${encodeURIComponent(text)}${cat.value ? `&type=${cat.value}` : ''}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      if (mine !== token) return;
      const items = Array.isArray(j.items) ? j.items : [];
      if (!items.length) { say('Nothing matched. Try fewer letters or another category.'); return; }
      out.replaceChildren(el('p', { class: 'small muted', text: 'Prices come from the wiki’s UEX feed and may lag the game. Check in game before you fly out.' }), ...items.map(card));
    } catch { if (mine === token) say('The item database did not answer. Try again in a minute.'); }
  }
  go.addEventListener('click', run);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  return { run };
}

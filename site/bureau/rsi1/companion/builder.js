// Ship builder for the Fleet tab. Data comes from our own /api/sc-builder (hardpoints, parts and shop prices
// from the Star Citizen Wiki API); the maths is in builder-core.js. The page is built with text nodes only.
import {
  indexParts, partsFor, resolve, totals, diff, slotLabel, partLabel, TYPE_ORDER, TYPE_LABEL, TOTAL_ROWS, deltaClass, signed
} from './builder-core.js';

const API = '/api/sc-builder';
const KEY = 'arsenal.builder';
const MAX_SAVED = 40;

const store = {
  read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } },
  write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage full or blocked */ } }
};

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};

export function initBuilder(host) {
  let data = null;
  let partsById = new Map();
  let started = false;
  let saved = store.read(); // { ship: id, builds: { shipId: { slotId: partId } } }
  let filter = '';

  const persist = () => store.write(saved);
  const ship = () => data?.ships.find((s) => s.id === saved.ship) || null;
  const overrides = (s) => (saved.builds && saved.builds[s.id]) || {};

  function setOverride(s, slotId, partId) {
    saved.builds = saved.builds || {};
    const cur = { ...(saved.builds[s.id] || {}) };
    const slot = s.slots.find((x) => x.id === slotId);
    if (!partId || partId === slot?.stock) delete cur[slotId]; else cur[slotId] = partId;
    delete saved.builds[s.id];
    if (Object.keys(cur).length) saved.builds[s.id] = cur; // re-added last, so the oldest builds fall off first
    const ids = Object.keys(saved.builds);
    for (const id of ids.slice(0, Math.max(0, ids.length - MAX_SAVED))) delete saved.builds[id];
    persist();
  }

  function message(text, retry) {
    host.textContent = '';
    host.append(el('h3', { text: 'Ship builder' }), el('p', { class: 'small muted', text }));
    if (retry) host.append(el('button', { type: 'button', class: 'ghost', text: 'Try again', onclick: () => { started = false; show(); } }));
  }

  function slotRow(s, slot, ov) {
    const current = ov[slot.id] ?? slot.stock;
    const options = partsFor(slot, data.parts).sort((a, b) => (b.shield?.hp ?? b.wpn?.burst ?? b.gen ?? b.cool ?? 0) - (a.shield?.hp ?? a.wpn?.burst ?? a.gen ?? a.cool ?? 0) || a.name.localeCompare(b.name));
    const stock = partsById.get(slot.stock);
    if (stock && !options.some((p) => p.id === stock.id)) options.unshift(stock);
    const sel = el('select', { 'aria-label': `${slotLabel(slot)} part` });
    for (const p of options) sel.append(el('option', { value: p.id, text: `${partLabel(p)}${p.id === slot.stock ? ' · stock' : ''}` }));
    sel.value = current || '';
    sel.addEventListener('change', () => { setOverride(s, slot.id, sel.value); paint(); });
    const size = slot.min === slot.max ? `S${slot.max}` : `S${slot.min}–${slot.max}`;
    return el('tr', { class: current !== slot.stock ? 'changed' : '' }, el('td', { class: 'small', text: slotLabel(slot) }), el('td', { class: 'num small muted', text: size }), el('td', {}, sel));
  }

  function slotsTable(s) {
    const ov = overrides(s);
    const body = el('tbody');
    for (const type of TYPE_ORDER) {
      const slots = s.slots.filter((x) => x.type === type);
      if (!slots.length) continue;
      body.append(el('tr', { class: 'grp' }, el('th', { colspan: '3', text: `${TYPE_LABEL[type]} (${slots.length})` })));
      for (const slot of slots) body.append(slotRow(s, slot, ov));
    }
    return el('div', { class: 'scrollx' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Hardpoint' }), el('th', { class: 'num', text: 'Size' }), el('th', { text: 'Part' }))), body));
  }

  function totalsTable(s) {
    const ov = overrides(s);
    const base = totals(s, partsById);
    const mine = totals(s, partsById, ov);
    const d = diff(base, mine);
    const body = el('tbody');
    for (const [k, label, better] of TOTAL_ROWS) {
      if (!base[k] && !mine[k]) continue;
      body.append(el('tr', {}, el('td', { text: label }), el('td', { class: 'num', text: Number(base[k]).toLocaleString('en-US') }),
        el('td', { class: 'num', text: Number(mine[k]).toLocaleString('en-US') }),
        el('td', { class: `num ${deltaClass(d[k], better)}`, text: d[k] ? signed(d[k]) : '—' })));
    }
    const wrap = el('div', {}, el('div', { class: 'scrollx' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Totals' }), el('th', { class: 'num', text: 'Stock' }), el('th', { class: 'num', text: 'Your build' }), el('th', { class: 'num', text: 'Change' }))), body)));
    if (mine.missing) wrap.append(el('p', { class: 'small muted', text: `${mine.missing} part${mine.missing === 1 ? '' : 's'} not in the catalogue were left out.` }));
    wrap.append(el('p', { class: 'small muted', text: 'Power and cooling count only the parts you can swap; fixed systems (flight controller, life support) are not included. Damage is the game data\'s burst and 60-second figures, per gun, summed.' }));
    return wrap;
  }

  function paint() {
    const s = ship();
    host.textContent = '';
    host.append(el('h3', { text: 'Ship builder' }));
    const search = el('input', { type: 'search', placeholder: 'Find a ship or maker', 'aria-label': 'Find a ship', value: filter });
    const pick = el('select', { 'aria-label': 'Ship' });
    const fillPick = () => {
      const q = filter.trim().toLowerCase();
      pick.textContent = '';
      for (const x of data.ships.filter((y) => !q || `${y.name} ${y.mfr} ${y.role}`.toLowerCase().includes(q) || y.id === saved.ship)) {
        pick.append(el('option', { value: x.id, text: `${x.name} — ${x.mfr}` }));
      }
      pick.value = saved.ship || '';
    };
    fillPick();
    // Typing only narrows the list; the page is not rebuilt, so the cursor stays where it is.
    search.addEventListener('input', () => { filter = search.value; fillPick(); });
    pick.addEventListener('change', () => { saved.ship = pick.value; persist(); paint(); });
    const reset = el('button', { type: 'button', class: 'ghost', text: 'Reset to stock', onclick: () => { if (s && saved.builds) { delete saved.builds[s.id]; persist(); paint(); } } });
    host.append(el('div', { class: 'row bldctl' }, search, pick, reset));
    if (!s) {
      host.append(el('p', { class: 'small muted mt8', text: 'Pick a ship to see its hardpoints and swap parts.' }));
    } else {
      const bits = [s.role, s.size != null ? `size ${s.size}` : '', s.crew?.max ? `crew ${s.crew.min ?? 1}–${s.crew.max}` : '', s.cargo ? `${s.cargo} SCU` : '', s.scm ? `SCM ${s.scm} m/s` : ''].filter(Boolean);
      host.append(el('p', { class: 'small muted mt8', text: bits.join(' · ') }));
      host.append(el('div', { class: 'grid g2 bld' }, slotsTable(s), totalsTable(s)));
    }
    host.append(el('p', { class: 'small muted mt8', text: `Data: Star Citizen Wiki API (api.star-citizen.wiki), game version ${data.version}, updated ${String(data.updatedAt || '').slice(0, 10)}. Unofficial fan tool; figures follow the game data and can change each patch.` }));
  }

  async function show() {
    if (started) return;
    started = true;
    message('Loading ship data…');
    try {
      const res = await fetch(API, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('bad status');
      const json = await res.json();
      if (!json.ready) { started = false; return message('Ship data is still being collected. Check back in a little while.', true); }
      data = json;
      partsById = indexParts(data.parts);
      if (!data.ships.some((x) => x.id === saved.ship)) saved.ship = (data.ships.find((x) => x.name === 'Gladius') || data.ships[0]).id;
      paint();
    } catch {
      started = false;
      message('The ship data could not be loaded.', true);
    }
  }

  return { show };
}

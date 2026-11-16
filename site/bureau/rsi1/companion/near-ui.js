// Waypoint pane (OmniOps): pick where you are, then find the nearest place that sells, buys or has what you need.
// Built from the live UEX terminal rows the page already loads. Text nodes and SVG attributes only. The maths is in near-core.js.
import { buildPlaces, systemsOf, bodiesOf, findHere, rank, tierCounts, TIERS } from './near-core.js';
import { svgEl } from './viz.js';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const K_HERE = 'arsenal.near.here';
const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };
const money = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));

export function initWaypoint(host, { getRows = () => [] } = {}) {
  if (!host) return null;
  let places = [], hereKey = read(K_HERE, ''), mode = 'any';
  const sys = el('select', { 'aria-label': 'Star system' }), body = el('select', { 'aria-label': 'Moon or planet' }), plc = el('select', { 'aria-label': 'Where you are' });
  const paste = el('input', { type: 'text', maxlength: '300', placeholder: 'Paste a /showlocation line, or a place name', 'aria-label': 'Paste your location' });
  const pasteBtn = el('button', { type: 'button', class: 'ghost', text: 'Find me' });
  const q = el('input', { type: 'text', maxlength: '60', placeholder: 'A commodity, terminal or place (Laranite, Admin, Lorville...)', 'aria-label': 'What are you looking for' });
  const chips = el('div', { class: 'row fm-chips' });
  const status = el('p', { class: 'small muted', role: 'status' });
  const radar = el('div', { class: 'svgwrap' }), list = el('div', { class: 'mt12' }), dir = el('div', { class: 'mt12' });
  host.append(el('div', { class: 'card' }, el('h3', { text: 'Where are you?' }),
    el('div', { class: 'row fm-form' }, sys, body, plc), el('div', { class: 'row mt8 fm-form' }, paste, pasteBtn), status),
    el('div', { class: 'card mt12' }, el('h3', { text: 'What do you need?' }), q, chips, radar, list),
    el('div', { class: 'card mt12' }, el('h3', { text: 'Terminal directory' }), dir));

  const here = () => places.find((p) => p.key === hereKey) || null;
  const modes = [['any', 'Anything'], ['buy', 'Buy it here'], ['sell', 'Sell it here']];
  for (const [m, label] of modes) {
    const b = el('button', { type: 'button', class: 'chip fm-chip', text: label, 'aria-pressed': String(m === mode) });
    b.addEventListener('click', () => { mode = m; for (const c of chips.children) c.setAttribute('aria-pressed', String(c === b)); drawResults(); });
    chips.append(b);
  }
  const fill = (select, items, cur, blank) => { select.replaceChildren(el('option', { value: '', text: blank }), ...items.map((i) => el('option', { value: i, text: i }))); select.value = items.includes(cur) ? cur : ''; };
  function drawPicker() {
    const h = here();
    fill(sys, systemsOf(places), h?.system || sys.value, 'Any system');
    fill(body, bodiesOf(places, sys.value), h?.body || body.value, 'Any moon or planet');
    const inBody = places.filter((p) => (!sys.value || p.system === sys.value) && (!body.value || p.body === body.value));
    plc.replaceChildren(el('option', { value: '', text: 'Pick a place' }), ...inBody.map((p) => el('option', { value: p.key, text: p.name })));
    plc.value = inBody.some((p) => p.key === hereKey) ? hereKey : '';
  }
  sys.addEventListener('change', () => { body.value = ''; hereKey = ''; write(K_HERE, ''); drawPicker(); drawResults(); });
  body.addEventListener('change', () => { hereKey = ''; write(K_HERE, ''); drawPicker(); drawResults(); });
  plc.addEventListener('change', () => { hereKey = plc.value; write(K_HERE, hereKey); drawResults(); });
  pasteBtn.addEventListener('click', () => {
    const p = findHere(paste.value, places);
    if (!p) { status.textContent = 'No known place in that text. Pick it from the lists, or type a name that appears in the terminal directory below. A pasted line is matched by name; coordinates are not read yet.'; return; }
    hereKey = p.key; write(K_HERE, hereKey); status.textContent = `Found ${p.name} (${p.system}).`; drawPicker(); drawResults();
  });
  paste.addEventListener('keydown', (e) => { if (e.key === 'Enter') pasteBtn.click(); });
  q.addEventListener('input', drawResults);

  function drawRadar(ranked) {
    const counts = tierCounts(ranked), W = 300, C = 150, svg = svgEl('svg', { viewBox: `0 0 ${W} ${W}`, class: 'radar svgmax', role: 'img', 'aria-label': 'Places by distance tier' });
    [120, 88, 56, 24].forEach((r, i) => {
      svg.append(svgEl('circle', { cx: C, cy: C, r, class: i === 3 ? 'fm-ring here' : 'fm-ring' }));
      const n = counts[3 - i];
      svg.append(svgEl('text', { x: C, y: C - r + 12, 'text-anchor': 'middle', class: 'fm-rl' }, `${TIERS[3 - i]}: ${n}`));
    });
    radar.replaceChildren(svg);
  }
  function drawResults() {
    const h = here(), ranked = rank(places, h, { mode, q: q.value, system: '' });
    drawRadar(ranked);
    list.replaceChildren();
    if (!places.length) { list.append(el('p', { class: 'small muted', text: 'Live price data has not arrived yet, so there are no places to search. Try again in a few minutes.' })); return; }
    if (!h) list.append(el('p', { class: 'small muted', text: 'Pick where you are to order results by how close they are. Until then they are grouped by system.' }));
    if (!ranked.length) { list.append(el('p', { class: 'small muted', text: 'Nothing matches. Try a shorter name, or switch to Anything.' })); return; }
    let tier = -1;
    for (const r of ranked.slice(0, 60)) {
      if (r.tier !== tier) { tier = r.tier; list.append(el('h4', { class: 'fm-h', text: h ? TIERS[tier] : 'All places' })); }
      const lines = r.hits.slice(0, 4).map((x) => `${x.commodity} ${x.kind === 'buy' ? 'buy' : 'sell'} ${money(x.price)}`).join(' · ');
      list.append(el('div', { class: 'row between fm-hit' }, el('div', {}, el('b', { text: r.place.name }), el('span', { class: 'small muted', text: ` · ${[r.place.body, r.place.system].filter(Boolean).join(' · ')}` }), lines ? el('div', { class: 'small', text: lines }) : null)));
    }
    if (ranked.length > 60) list.append(el('p', { class: 'small muted', text: `${ranked.length - 60} more. Narrow the search.` }));
  }
  function drawDir() {
    dir.replaceChildren();
    if (!places.length) return;
    const tb = el('tbody');
    for (const p of places.slice(0, 400)) tb.append(el('tr', {}, el('td', {}, el('b', { text: p.name })), el('td', { text: p.system || '—' }), el('td', { text: p.body || '—' }), el('td', { class: 'small', text: p.terminals.map((t) => t.name).join(', ') })));
    dir.append(el('p', { class: 'small muted', text: `${places.length} places with a terminal in the live price data. Services that are not commodity terminals (refineries, repair, ASOP) are not in this data yet.` }),
      el('div', { class: 'scrollx fm-dir' }, el('table', {}, el('thead', {}, el('tr', {}, ...['Place', 'System', 'Moon or planet', 'Terminals'].map((h) => el('th', { text: h })))), tb)));
  }
  function draw() { places = buildPlaces(getRows()); drawPicker(); drawResults(); drawDir(); }
  window.addEventListener('arsenal:market', draw);
  draw();
  return { draw };
}

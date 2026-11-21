// Waypoint pane (OmniOps): a location search. A filters panel of category toggles, four fields (planet, faction, location type,
// keyword) and a list of matching places, with an optional "sort by distance from" step. Built from the live UEX terminal data the page
// already loads; categories that need game-file data are shown switched off. Text nodes and SVG attributes only. Maths in near-core.js.
// The choices are kept in the address (#waypoint?cat=refinery,dock&planet=Hurston&kind=City&q=...) so a search can be shared.
import { buildPlaces, authoritiesOf, bodiesOf, findHere, rank, tierCounts, TIERS, CATEGORIES, LOCATION_KINDS, SERVICE_LABEL } from './near-core.js';
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
const IDS = new Set(CATEGORIES.map((c) => c.id));

// Choices out of the address, ignoring anything that is not one of ours.
export function readHash(hash) {
  const qs = String(hash || '').split('?')[1] || '';
  const p = new URLSearchParams(qs);
  return { cats: (p.get('cat') || '').split(',').filter((x) => IDS.has(x)), planet: (p.get('planet') || '').slice(0, 60), kind: LOCATION_KINDS.includes(p.get('kind')) ? p.get('kind') : '', q: (p.get('q') || '').slice(0, 60), auth: (p.get('auth') || '').slice(0, 40), mode: ['buy', 'sell'].includes(p.get('mode')) ? p.get('mode') : 'any' };
}
export function writeHash(st) {
  const p = new URLSearchParams();
  if (st.cats.length) p.set('cat', st.cats.join(','));
  if (st.planet) p.set('planet', st.planet);
  if (st.kind) p.set('kind', st.kind);
  if (st.auth) p.set('auth', st.auth);
  if (st.q) p.set('q', st.q);
  if (st.mode !== 'any') p.set('mode', st.mode);
  const s = p.toString();
  return `#waypoint${s ? '?' + s : ''}`;
}

export function initWaypoint(host, { getRows = () => [], getServices = () => [] } = {}) {
  if (!host) return null;
  let places = [], game = [], hereKey = read(K_HERE, '');
  const st = { ...readHash(location.hash) };
  const remember = () => { if (document.body.dataset.v === 'waypoint' || /^#waypoint/.test(location.hash)) { try { history.replaceState(null, '', writeHash(st)); } catch { /* ignore */ } } };

  const count = el('p', { class: 'small muted', role: 'status' });
  const catBar = el('div', { class: 'row fm-chips', role: 'group', 'aria-label': 'Categories' });
  const planet = el('select', { 'aria-label': 'Planet or moon' }), kind = el('select', { 'aria-label': 'Location type' });
  const faction = el('select', { 'aria-label': 'Jurisdiction or faction', title: 'Who holds legal authority over the place, or which faction runs it' });
  const q = el('input', { type: 'text', maxlength: '60', placeholder: 'Keyword: a place, terminal or commodity', 'aria-label': 'Keyword' });
  const modeBar = el('div', { class: 'row fm-chips', role: 'group', 'aria-label': 'Prices' });
  const list = el('div', { class: 'mt12' });
  // distance step
  const sys = el('select', { 'aria-label': 'Star system' }), body = el('select', { 'aria-label': 'Moon or planet you are at' }), plc = el('select', { 'aria-label': 'Where you are' });
  const paste = el('input', { type: 'text', maxlength: '300', placeholder: 'Paste a /showlocation line, or a place name', 'aria-label': 'Paste your location' });
  const pasteBtn = el('button', { type: 'button', class: 'ghost', text: 'Find me' });
  const status = el('p', { class: 'small muted', role: 'status' });
  const radar = el('div', { class: 'svgwrap' });

  host.append(
    el('div', { class: 'card' }, el('h3', { text: 'Location search' }),
      el('div', { class: 'row fm-form' }, planet, faction, kind, q), el('p', { class: 'small muted mt8', text: 'Prices' }), modeBar,
      el('details', { class: 'fold mt12', open: '' }, el('summary', { text: 'Filters' }), catBar,
        el('p', { class: 'small muted mt8', text: 'Hangars, landing pads, garages and vehicle services come from the game files (patch 4.10) and are matched to places by name. Switched-off filters need data this site does not have yet.' }))),
    el('details', { class: 'fold card mt12' }, el('summary', { text: 'Sort by distance from where you are' }),
      el('div', { class: 'row fm-form mt8' }, sys, body, plc), el('div', { class: 'row mt8 fm-form' }, paste, pasteBtn), status, radar),
    el('div', { class: 'mt12' }, count, list));

  const here = () => places.find((p) => p.key === hereKey) || null;
  const redraw = () => { remember(); drawResults(); };

  for (const c of CATEGORIES) {
    const on = !!c.has;
    const b = el('button', { type: 'button', class: 'chip fm-chip', text: c.label, 'aria-pressed': String(st.cats.includes(c.id)), disabled: on ? null : '', title: on ? null : 'Needs game-file data this site does not have yet' });
    if (on) b.addEventListener('click', () => { st.cats = st.cats.includes(c.id) ? st.cats.filter((x) => x !== c.id) : [...st.cats, c.id]; b.setAttribute('aria-pressed', String(st.cats.includes(c.id))); redraw(); });
    catBar.append(b);
  }
  for (const [m, label] of [['any', 'Anything'], ['buy', 'Buy it here'], ['sell', 'Sell it here']]) {
    const b = el('button', { type: 'button', class: 'chip fm-chip', text: label, 'aria-pressed': String(m === st.mode) });
    b.addEventListener('click', () => { st.mode = m; for (const c of modeBar.children) c.setAttribute('aria-pressed', String(c === b)); redraw(); });
    modeBar.append(b);
  }
  const fill = (select, items, cur, blank) => { select.replaceChildren(el('option', { value: '', text: blank }), ...items.map((i) => el('option', { value: i, text: i }))); select.value = items.includes(cur) ? cur : ''; };
  faction.addEventListener('change', () => { st.auth = faction.value; redraw(); });
  planet.addEventListener('change', () => { st.planet = planet.value; redraw(); });
  kind.addEventListener('change', () => { st.kind = kind.value; redraw(); });
  q.value = st.q; q.addEventListener('input', () => { st.q = q.value.trim(); redraw(); });

  function drawPicker() {
    const h = here();
    fill(planet, bodiesOf(places, ''), st.planet, 'Planet or moon'); st.planet = planet.value;
    fill(faction, authoritiesOf(places), st.auth, 'Jurisdiction or faction'); st.auth = faction.value;
    fill(kind, LOCATION_KINDS.filter((k) => places.some((p) => p.kind === k)), st.kind, 'Location type'); st.kind = kind.value;
    const systems = [...new Set(places.map((p) => p.system).filter(Boolean))].sort();
    fill(sys, systems, h?.system || sys.value, 'Any system');
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
    if (!p) { status.textContent = 'No known place in that text. Pick it from the lists. A pasted line is matched by place name; coordinates are not read yet.'; return; }
    hereKey = p.key; write(K_HERE, hereKey); status.textContent = `Found ${p.name} (${p.system}).`; drawPicker(); drawResults();
  });
  paste.addEventListener('keydown', (e) => { if (e.key === 'Enter') pasteBtn.click(); });

  function drawRadar(ranked) {
    const counts = tierCounts(ranked), W = 300, C = 150, svg = svgEl('svg', { viewBox: `0 0 ${W} ${W}`, class: 'radar svgmax', role: 'img', 'aria-label': 'Places by distance tier' });
    [120, 88, 56, 24].forEach((r, i) => {
      svg.append(svgEl('circle', { cx: C, cy: C, r, class: i === 3 ? 'fm-ring here' : 'fm-ring' }));
      svg.append(svgEl('text', { x: C, y: C - r + 12, 'text-anchor': 'middle', class: 'fm-rl' }, `${TIERS[3 - i]}: ${counts[3 - i]}`));
    });
    radar.replaceChildren(svg);
  }

  function card(r) {
    const p = r.place, sv = p.svc || [];
    const shown = sv.filter((k) => !((k === 'hangar' || k === 'pad') && sv.some((x) => x.startsWith(k + '-'))));
    const chips = shown.map((k) => el('span', { class: 'chip', text: SERVICE_LABEL[k] || k }));
    const priced = p.terminals.filter((t) => t.buys.length || t.sells.length);
    if (priced.length) chips.unshift(el('span', { class: 'chip', text: 'Trade terminals' }));
    const sub = [p.kind, p.body, p.system, p.jur, p.fac].filter(Boolean).join(' · ');
    const lines = r.hits.slice(0, 4).map((x) => `${x.commodity} ${x.kind === 'buy' ? 'buy' : 'sell'} ${money(x.price)}`).join(' · ');
    const more = el('details', { class: 'fold' }, el('summary', { text: `${p.terminals.length} terminal${p.terminals.length === 1 ? '' : 's'}` }));
    for (const t of p.terminals) {
      const goods = [...t.buys.map((x) => `${x.commodity} buy ${money(x.price)}`), ...t.sells.map((x) => `${x.commodity} sell ${money(x.price)}`)].slice(0, 12).join(' · ');
      more.append(el('div', { class: 'small' }, el('b', { text: t.name }), goods ? el('div', { class: 'muted', text: goods }) : null));
    }
    return el('div', { class: 'card fm-hit' }, el('div', { class: 'row between' }, el('b', { text: p.name }), el('span', { class: 'small muted', text: sub })),
      chips.length ? el('div', { class: 'row fm-chips' }, ...chips) : null, lines ? el('div', { class: 'small', text: lines }) : null, p.terminals.length ? more : null);
  }

  function drawResults() {
    const h = here(), ranked = rank(places, h, { mode: st.mode, q: st.q, cats: st.cats, planet: st.planet, kind: st.kind, auth: st.auth });
    drawRadar(ranked);
    list.replaceChildren();
    if (!places.length) { count.textContent = ''; list.append(el('p', { class: 'small muted', text: 'Live price and terminal data has not arrived yet, so there are no places to search. Try again in a few minutes.' })); return; }
    count.textContent = `${ranked.length} location${ranked.length === 1 ? '' : 's'}${h ? ` · nearest to ${h.name}` : ''}`;
    if (!ranked.length) { list.append(el('p', { class: 'small muted', text: 'Nothing matches. Remove a filter or shorten the keyword.' })); return; }
    let tier = -1;
    for (const r of ranked.slice(0, 60)) {
      if (h && r.tier !== tier) { tier = r.tier; list.append(el('h4', { class: 'fm-h', text: TIERS[tier] })); }
      list.append(card(r));
    }
    if (ranked.length > 60) list.append(el('p', { class: 'small muted', text: `${ranked.length - 60} more. Narrow the search.` }));
  }

  function draw() { places = buildPlaces(getRows(), getServices(), game); drawPicker(); drawResults(); }
  window.addEventListener('arsenal:market', draw);
  window.addEventListener('hashchange', () => { if (/^#waypoint/.test(location.hash) && location.hash !== writeHash(st)) { Object.assign(st, readHash(location.hash)); q.value = st.q; faction.value = st.auth; for (const [i, c] of CATEGORIES.entries()) if (c.has) catBar.children[i].setAttribute('aria-pressed', String(st.cats.includes(c.id))); drawPicker(); drawResults(); } });
  draw();
  // Places and services from the game files; one small request, and the page works without it.
  fetch('/api/sc-locations', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { if (j && Array.isArray(j.places) && j.places.length) { game = j.places; draw(); } })
    .catch(() => { /* offline or blocked: Waypoint keeps working on live trade data */ });
  return { draw };
}

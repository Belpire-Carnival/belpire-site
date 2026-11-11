// Fabricator pane: pick a blueprint, set the quality of the material in each slot, see what that does to the crafted
// item's stats, and get the material list for the number of crafts you want. Text nodes only; the maths is in fab-core.js.
// Data comes from our own /api/sc-blueprints and /api/sc-blueprint.
import { multiplier, qualityFor, pct, verdict, clampQuality, materialList, statRows, isLinear, START_QUALITY } from './fab-core.js';
import { keyOf } from './plan-core.js';

const API_LIST = '/api/sc-blueprints';
const API_ONE = '/api/sc-blueprint';

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
const qtyText = (m) => (m.scu != null ? `${m.scu} SCU` : m.qty != null ? `×${m.qty}` : '');

export function initFabricator(host, { toast = () => {}, onGoal = null } = {}) {
  if (!host) return null;
  const q = el('input', { type: 'search', placeholder: 'Search blueprints by item name', 'aria-label': 'Search blueprints' });
  const pick = el('select', { 'aria-label': 'Blueprint' });
  const note = el('div', { class: 'small muted mt8', role: 'status', text: 'Loading the blueprint list…' });
  const body = el('div', { class: 'mt12' });
  host.append(el('div', { class: 'row pfrow' }, field('Find a blueprint', q), field('Pick one', pick)), note, body);

  let all = [], bp = null, quality = {}, picks = {}, crafts = 1, loadedId = '';

  function choices() {
    const needle = keyOf(q.value);
    const rows = all.filter((r) => !needle || keyOf(r.name).includes(needle)).slice(0, 60);
    pick.replaceChildren(el('option', { value: '', text: rows.length ? `${rows.length}${rows.length === 60 ? '+' : ''} matches` : 'No match' }), ...rows.map((r) => el('option', { value: r.id, text: `${r.name} (${r.type || 'item'})` })));
    if (bp && rows.some((r) => r.id === bp.id)) pick.value = bp.id;
  }

  function draw() {
    body.replaceChildren();
    if (!bp) { body.append(el('p', { class: 'small muted', text: 'Pick a blueprint to set material quality and see the result.' })); return; }
    const head = el('div', { class: 'card' }, el('h3', { text: bp.name }),
      el('p', { class: 'small muted', text: `${bp.type || 'Item'}${bp.sec != null ? ` · craft time ${Math.round(bp.sec / 6) / 10} min` : ''}${bp.def ? ' · every player starts with this blueprint' : ''}` }));
    const slots = el('div', { class: 'card mt12' }, el('h3', { text: 'Materials' }), el('p', { class: 'small muted', text: 'Set the quality of the material you will put in each slot (1 to 1000). Higher quality moves the stats listed under it toward their best value.' }));
    for (const g of bp.groups) {
      const qv = quality[g.key] ?? START_QUALITY;
      const kids = g.kids || [];
      const range = el('input', { type: 'range', min: '1', max: '1000', step: '1', 'aria-label': `${g.name} quality` }); range.value = String(qv);
      const num = el('input', { type: 'number', min: '1', max: '1000', step: '1', 'aria-label': `${g.name} quality number` }); num.value = String(qv);
      const set = (v) => { quality[g.key] = clampQuality(Number(v)); drawStats(); range.value = num.value = String(quality[g.key]); };
      range.addEventListener('input', () => set(range.value)); num.addEventListener('change', () => set(num.value));
      let mat;
      if (kids.length > 1) {
        mat = el('select', { 'aria-label': `${g.name} material` }, ...kids.map((k, i) => el('option', { value: String(i), text: `${k.name} ${qtyText(k)}` })));
        mat.value = String(picks[g.key] || 0);
        mat.addEventListener('change', () => { picks[g.key] = Number(mat.value); drawMaterials(); });
      } else mat = el('b', { text: kids[0] ? `${kids[0].name} ${qtyText(kids[0])}` : '—' });
      slots.append(el('div', { class: 'slot' }, el('div', { class: 'row pfrow' }, el('div', {}, el('div', { class: 'small muted', text: g.name }), mat), field('Quality', range), num)));
    }
    const stats = el('div', { class: 'card mt12' }, el('h3', { text: 'What it does to the item' })), mats = el('div', { class: 'card mt12' });
    function drawStats() {
      stats.replaceChildren(el('h3', { text: 'What it does to the item' }));
      const rows = statRows(bp.groups, quality);
      if (!rows.length) { stats.append(el('p', { class: 'small muted', text: 'This blueprint has no quality-dependent stats in the wiki data.' })); return; }
      const tb = el('tbody');
      for (const r of rows) {
        const m = r.mod, v = verdict(m, r.mult);
        const target = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'e.g. 1.05', 'aria-label': `Target multiplier for ${m.label}` });
        const need = el('span', { class: 'small muted' });
        target.addEventListener('input', () => {
          if (!isLinear(m)) { need.textContent = ''; return; }
          const n = qualityFor(m, Number(target.value));
          need.textContent = target.value === '' ? '' : n == null ? `outside ×${m.lo} to ×${m.hi}` : `needs quality ${n}`;
        });
        tb.append(el('tr', {}, el('td', { text: r.group }), el('td', {}, el('b', { text: m.label }), el('div', { class: 'small muted', text: `×${m.lo} to ×${m.hi}${m.better === 'lower' ? ', lower is better' : ''}` })),
          el('td', {}, r.modelled ? el('span', { class: `chip ${v === 'good' ? 'ok' : v === 'bad' ? 'bad' : ''}`, text: `${pct(r.mult)} (×${r.mult.toFixed(3)})` }) : el('span', { class: 'small muted', text: 'curve not modelled' })),
          el('td', {}, target, need)));
      }
      stats.append(el('div', { class: 'scrollx' }, el('table', {}, el('thead', {}, el('tr', {}, ...['Slot', 'Stat', 'At this quality', 'Quality for a target'].map((t) => el('th', { text: t })))), tb)),
        el('p', { class: 'small muted mt8', text: 'The multiplier applies to the item’s base stat. These ranges come from the game files via the wiki; confirm one craft in game before you spend rare material.' }));
    }
    function drawMaterials() {
      mats.replaceChildren(el('h3', { text: 'Shopping list' }));
      const n = el('input', { type: 'number', min: '1', max: '999', step: '1', 'aria-label': 'Number of crafts' }); n.value = String(crafts);
      n.addEventListener('change', () => { crafts = Math.max(1, Math.min(999, Math.floor(Number(n.value)) || 1)); drawMaterials(); });
      const list = materialList(bp.groups, picks, crafts);
      const tb = el('tbody');
      for (const m of list) tb.append(el('tr', {}, el('td', { text: m.name }), el('td', { text: m.group }), el('td', { text: qtyText(m) || '—' }), el('td', { text: m.minq != null ? `quality ${m.minq}+` : '—' })));
      mats.append(el('div', { class: 'row pfrow' }, field('Crafts', n)), el('div', { class: 'scrollx mt8' }, el('table', {}, el('thead', {}, el('tr', {}, ...['Material', 'Slot', 'Needed', 'Minimum'].map((t) => el('th', { text: t })))), tb)));
      if (onGoal) {
        const goal = el('button', { type: 'button', class: 'primary mt8', text: 'Make this an objective' });
        goal.addEventListener('click', () => { onGoal({ bp: { id: bp.id, name: bp.name }, crafts, materials: list }); toast('Added to your objectives'); });
        mats.append(goal);
      }
    }
    body.append(head, slots, stats, mats);
    drawStats(); drawMaterials();
    if (bp.missions && bp.missions.length) body.append(el('div', { class: 'card mt12' }, el('h3', { text: 'How you unlock it' }),
      ...bp.missions.map((g) => el('p', { class: 'small' }, el('b', { text: `${g.label}${g.chance != null && g.chance < 1 ? ` (${Math.round(g.chance * 100)}%)` : ''}: ` }), g.list.map((m) => m.title).join(' · ')))));
  }

  async function load(id) {
    if (!id || id === loadedId) return;
    note.textContent = 'Loading the recipe…';
    try {
      const r = await fetch(`${API_ONE}?id=${encodeURIComponent(id)}`); const j = await r.json();
      if (!r.ok || !j || !j.ready) throw new Error('not ready');
      bp = j.blueprint; loadedId = id; quality = {}; picks = {}; crafts = 1;
      note.textContent = `${all.length} blueprints in the list.`; choices(); pick.value = id; draw();
    } catch { note.textContent = 'That recipe could not be loaded right now. Try again in a minute.'; }
  }

  q.addEventListener('input', choices);
  pick.addEventListener('change', () => { if (pick.value) { load(pick.value); history.replaceState(null, '', `#fabricator?b=${encodeURIComponent(pick.value)}`); } });
  draw();
  (async () => {
    try {
      const r = await fetch(API_LIST); const j = await r.json();
      if (!r.ok || !j || !j.ready) throw new Error('not ready');
      all = j.blueprints; note.textContent = `${all.length} blueprints in the list.`; choices();
      if (wanted) load(wanted);
    } catch { note.textContent = 'The blueprint list could not be loaded right now.'; }
  })();
  let wanted = '';
  return { show(id) { wanted = id || ''; if (id && all.length) load(id); } };
}

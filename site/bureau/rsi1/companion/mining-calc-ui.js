// Rock breaker card for the Extraction tab. Pick a ship (or a free head setup), type the scan numbers, and see whether the kit breaks the rock,
// the throttle it needs and the rock's adjusted resistance and instability. Text nodes only; the one request is our own /api/sc-mining-gear.
import { evaluate, shipHeads } from './mining-calc.js';
import { fxLine } from './mining-gear.js';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
};
const n0 = (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
const KEY = 'arsenal.rockcalc';
const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

export function initRockCalc(host) {
  if (!host) return null;
  const saved = read();
  host.append(el('p', { class: 'small muted', text: 'Loading mining gear…' }));
  fetch('/api/sc-mining-gear', { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then(build).catch(() => {
    host.replaceChildren(el('p', { class: 'small muted', text: 'The mining gear data could not be loaded.' }));
  });

  function build(gear) {
    const lasers = gear.lasers.filter((l) => l.size >= 1 && l.power);
    const laserByKey = new Map(gear.lasers.map((l) => [l.key, l]));
    const modules = gear.modules.filter((m) => !m.vehicle);
    const ships = [];
    for (const s of gear.ships) if (s.size >= 1 && !ships.some((x) => x.name === s.name)) ships.push(s);
    const num = (id, label, val, ph) => el('label', { class: 'field' }, el('span', { text: label }), el('input', { id, type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: val ?? '', placeholder: ph || '' }));
    const mass = num('rcMass', 'Rock mass (kg)', saved.mass, 'e.g. 12000'), res = num('rcRes', 'Resistance (%)', saved.res, 'e.g. 30'), ins = num('rcIns', 'Instability (%)', saved.ins, 'e.g. 40');
    const shipSel = el('select', { 'aria-label': 'Ship' }, ships.map((s) => el('option', { value: s.name, text: s.name })));
    const gadgetSel = el('select', { 'aria-label': 'Gadget on the rock' }, el('option', { value: '', text: 'No gadget' }), gear.gadgets.map((g) => el('option', { value: g.key, text: `${g.name} · ${fxLine(g.fx)}` })));
    if (saved.ship && ships.some((s) => s.name === saved.ship)) shipSel.value = saved.ship;
    if (saved.gadget) gadgetSel.value = saved.gadget;
    const kit = el('div', { class: 'mt8' });
    const out = el('div', { class: 'out mt12' });
    host.replaceChildren(
      el('p', { class: 'small muted', text: 'Type the numbers from your scan, choose your ship and fit each head. The modifiers come from the game files; the break rule is the community formula used by the public mining calculators, so treat the answer as a planning aid and check it against the in-game bar.' }),
      el('div', { class: 'fields' }, mass, res, ins), el('div', { class: 'row mt8' }, shipSel, gadgetSel), kit, out);

    let heads = [];
    const val = (label) => { const i = label.querySelector('input'); return i && i.value !== '' ? Number(i.value) : 0; };

    function layout() {
      const ship = ships.find((s) => s.name === shipSel.value);
      heads = shipHeads(ship, laserByKey).map((h, i) => {
        const keep = saved.heads?.[shipSel.value]?.[i] || {};
        const opts = lasers.filter((l) => l.size === h.size);
        const lk = opts.some((l) => l.key === keep.laser) ? keep.laser : h.laser?.key;
        return { size: h.size, laser: lk, mods: Array.isArray(keep.mods) ? keep.mods.slice(0, 4) : [] };
      });
      kit.replaceChildren(...heads.map((h, i) => {
        const opts = lasers.filter((l) => l.size === h.size);
        const ls = el('select', { 'aria-label': `Head ${i + 1} laser`, onchange: () => { h.laser = ls.value; h.mods = []; layout2(); } }, opts.map((l) => el('option', { value: l.key, text: `${l.name.replace(/ Mining Laser$/, '')} · ${n0(l.power)} MW` })));
        ls.value = h.laser;
        const slotsN = laserByKey.get(h.laser)?.slots || 0;
        const ms = Array.from({ length: slotsN }, (_, j) => {
          const s = el('select', { 'aria-label': `Head ${i + 1} module ${j + 1}`, onchange: () => { h.mods[j] = s.value; compute(); } },
            el('option', { value: '', text: 'No module' }), modules.map((m) => el('option', { value: m.key, text: `${m.name} (${m.kind}) · ${fxLine({ ...m.fx })}${m.power && m.power !== 1 ? ` · ${Math.round((m.power - 1) * 100)}% power` : ''}` })));
          s.value = h.mods[j] || '';
          return s;
        });
        return el('div', { class: 'card' }, el('div', { class: 'small', text: `Head ${i + 1} (size ${h.size})` }), el('div', { class: 'row mt8' }, ls), el('div', { class: 'row mt8' }, ms));
      }));
      compute();
    }
    const layout2 = () => layout();

    function compute() {
      const scan = { mass: val(mass), resist: val(res), instab: val(ins) };
      const gadget = gear.gadgets.find((g) => g.key === gadgetSel.value) || null;
      const kitHeads = heads.map((h) => ({ laser: laserByKey.get(h.laser), modules: h.mods.map((k) => gear.modules.find((m) => m.key === k)).filter(Boolean) }));
      const r = evaluate(scan, kitHeads, gadget);
      const sh = saved.heads || {};
      sh[shipSel.value] = heads.map((h) => ({ laser: h.laser, mods: h.mods }));
      write({ ...saved, mass: scan.mass || '', res: scan.resist || '', ins: scan.instab || '', ship: shipSel.value, gadget: gadgetSel.value, heads: sh });
      Object.assign(saved, { heads: sh });
      const say = {
        empty: ['', 'Enter the rock mass and resistance.'],
        never: ['bad', 'This kit cannot break the rock: its adjusted resistance reaches 100% or you have no laser power.'],
        short: ['bad', `Not enough power. You deliver ${n0(r.available)} MW and the rock needs ${n0(r.required)} MW, so it is out of reach even at full throttle. Add power modules, a resistance-cutting laser or gadget, or more heads.`],
        breaks: ['good', `Breaks. Needs about ${r.throttle}% of your ${n0(r.available)} MW at full throttle (${n0(r.required)} MW), so hold roughly ${Math.ceil(r.throttle)}% or more.`]
      }[r.verdict];
      out.replaceChildren(el('p', { class: `big ${say[0]}`.trim(), text: say[1] }),
        scan.mass > 0 ? el('table', {}, el('tbody', {},
          el('tr', {}, el('td', { text: 'Adjusted resistance' }), el('td', { class: 'num', text: `${r.effRes}%` }), el('td', { class: 'small muted', text: `scanned ${scan.resist}%` })),
          el('tr', {}, el('td', { text: 'Adjusted instability' }), el('td', { class: 'num', text: `${r.effInst}%` }), el('td', { class: 'small muted', text: `scanned ${scan.instab}%` })),
          el('tr', {}, el('td', { text: 'Power delivered' }), el('td', { class: 'num', text: `${n0(r.available)} MW` }), el('td', { class: 'small muted', text: r.perHead.map(n0).join(' + ') })),
          el('tr', {}, el('td', { text: 'Power needed' }), el('td', { class: 'num', text: Number.isFinite(r.required) ? `${n0(r.required)} MW` : 'never' }), el('td', { class: 'small muted', text: 'mass ÷ (1 − resistance) ÷ 5' })))) : null,
        el('p', { class: 'small muted', text: 'Modifiers from every head, module and the gadget are multiplied together. Active modules (Surge, Brandt and others) only apply while their charge lasts. Hand and ground-vehicle mining use different scales and are not covered.' }));
    }

    for (const lbl of [mass, res, ins]) lbl.querySelector('input').addEventListener('input', compute);
    gadgetSel.addEventListener('change', compute);
    shipSel.addEventListener('change', layout);
    layout();
  }
  return {};
}

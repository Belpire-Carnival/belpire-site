// Simulations card for the Calculator: Penetration, Deflection and Travel time for the ship being looked at, using the
// guns and quantum drive currently fitted. The maths and its limits are in sim-core.js. Built with text nodes only.
import { resolve, num } from './builder-core.js';
import { icon } from './viz.js';
import { deflectionCheck, penetrationFacts, driveOf, travelTime, fmtTime, NO_LIMIT } from './sim-core.js';

const state = { tab: 'deflect', weapon: '', gm: 10 };
const TABS = [['pen', 'Penetration'], ['deflect', 'Deflection'], ['travel', 'Travel time']];

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const note = (text) => el('p', { class: 'small muted mt8', text });
const bigstat = (n, label, d) => el('div', { class: 'bigstat' }, el('div', { class: 'n', text: n }), el('div', { class: 'lbl', text: label }), el('div', { class: 'd', text: d || ' ' }));
const kv = (rows) => {
  const g = el('div', { class: 'kv' });
  for (const [k, v, d] of rows) g.append(el('span', { class: 'k', text: k }), el('span', { class: 'v', text: v }), el('span', { class: 'dv', text: d || '' }));
  return g;
};
const dash = (v, d = 2, unit = '') => (v == null ? '—' : `${num(v, d)}${unit}`);

// The distinct guns fitted right now, with how many of each.
function fittedGuns(ship, partsById, ov) {
  const fitted = resolve(ship, ov);
  const seen = new Map();
  for (const slot of ship.slots) {
    if (slot.type !== 'WeaponGun') continue;
    const p = partsById.get(fitted[slot.id]);
    if (!p) continue;
    const e = seen.get(p.id) || { part: p, count: 0 };
    e.count++;
    seen.set(p.id, e);
  }
  return [...seen.values()];
}

function weaponPicker(guns, draw) {
  if (!state.weapon || !guns.some((g) => g.part.id === state.weapon)) state.weapon = guns[0].part.id;
  const sel = el('select', { 'aria-label': 'Weapon', onchange: () => { state.weapon = sel.value; draw(); } });
  for (const g of guns) {
    const o = el('option', { value: g.part.id, text: `${g.part.name} (S${g.part.size ?? '?'}) ×${g.count}` });
    if (g.part.id === state.weapon) o.selected = true;
    sel.append(o);
  }
  return el('label', { class: 'simpick' }, el('span', { class: 'small muted', text: 'Weapon ' }), sel);
}

const VERDICT = { deflected: ['Deflected', 'bad'], passes: ['Gets through', 'good'], none: ['No limit in data', ''], nodamage: ['No damage of this type', ''] };

function deflectionView(s, part) {
  const rows = deflectionCheck(part, s.stats?.armor);
  const t = el('table', { class: 'simtable' }, el('thead', {}, el('tr', {}, ...['Damage', 'Per shot', 'Armor threshold', 'Result'].map((h) => el('th', { text: h })))));
  const body = el('tbody');
  for (const r of rows) {
    const [label, cls] = VERDICT[r.status];
    body.append(el('tr', {}, el('td', { text: r.label }), el('td', { text: dash(r.damage, 1) }), el('td', { text: r.limit == null ? '—' : num(r.limit, 1) }), el('td', { class: cls, text: label })));
  }
  t.append(body);
  const missing = s.stats?.armor?.defl == null;
  return el('div', {}, t,
    note(missing ? 'Armor thresholds arrive with the next data refresh (about a day after a deploy).' : `A threshold of ${num(NO_LIMIT)} or more is the game data's way of saying "no limit", so it is shown as a dash. The check compares one shot with the threshold; it does not model shields.`));
}

function penetrationView(s, part) {
  const f = penetrationFacts(part, s.stats);
  const res = f.resist;
  return el('div', {},
    el('div', { class: 'big3' }, bigstat(dash(f.depth, 2, ' m'), 'Penetration depth'), bigstat(dash(f.maxThickness, 2, ' m'), 'Max thickness'), bigstat(dash(f.speed, 0, ' m/s'), 'Projectile speed')),
    kv([
      ['Beam radius  near / far', `${dash(f.nearRadius, 3)} / ${dash(f.farRadius, 3)} m`, ''],
      ['Ship penetration resistance  phys / energy / dist', `${dash(res.phys, 2)} / ${dash(res.energy, 2)} / ${dash(res.dist, 2)}`, ''],
      ['Penetration multiplier  fuse / components', `${dash(f.mulFuse, 2)} / ${dash(f.mulComponents, 2)}`, '']
    ]),
    note('The wiki records how deep a shot reaches and how the ship scales it, but not the thickness of each hull panel, so there is no pass or fail here. These are the raw figures to compare by eye.'));
}

function travelView(s, ov, partsById, draw) {
  const slot = s.slots.find((x) => x.type === 'QuantumDrive');
  const part = slot ? partsById.get(resolve(s, ov)[slot.id]) : null;
  const drive = driveOf(part);
  if (!drive) return note('No quantum drive with full jump figures is fitted on this ship.');
  const input = el('input', { type: 'number', min: '0.1', step: 'any', value: String(state.gm), 'aria-label': 'Distance in gigametres', onchange: () => { const v = Number(input.value); if (v > 0) state.gm = v; draw(); } });
  const chips = el('div', { class: 'simchips', role: 'group', 'aria-label': 'Distance presets' }, ...[1, 10, 50, 100].map((g) => el('button', { type: 'button', class: 'ghost', text: `${g} Gm`, 'aria-pressed': String(state.gm === g), onclick: () => { state.gm = g; draw(); } })));
  const r = travelTime(drive, state.gm * 1e9);
  const ten = travelTime(drive, 1e10);
  return el('div', {},
    el('div', { class: 'simrow' }, el('label', { class: 'simpick' }, el('span', { class: 'small muted', text: 'Distance (Gm) ' }), input), chips),
    el('div', { class: 'big3' }, bigstat(fmtTime(r.travel), 'Travel', `${state.gm} Gm`), bigstat(fmtTime(r.total), 'With spool-up', `spool ${dash(r.spool, 1, 's')}`), bigstat(`${num(r.peak / 1e6, 0)} Mm/s`, r.reachedMax ? 'Top speed reached' : 'Peak speed', r.reachedMax ? '' : 'short of full speed')),
    kv([
      ['Quantum drive', part.name, `S${part.size ?? '?'}`],
      ['Drive speed', `${num(drive.speed / 1e6, 1)} Mm/s`, ''],
      ['Acceleration  stage one / two', `${num(drive.a1 / 1e6, 2)} / ${num(drive.a2 / 1e6, 2)} Mm/s²`, ''],
      ['Cooldown after a jump', dash(drive.cooldown, 1, ' s'), ''],
      ['Our 10 Gm estimate', fmtTime(ten.travel), drive.wiki10 != null ? `wiki ${fmtTime(drive.wiki10)}` : '']
    ]),
    note('An estimate from the drive\'s published speed and acceleration figures, shown beside the wiki\'s own 10 Gm time as a check. Calibration time and route length in game will add to it.'));
}

export function simPanel(s, partsById, ov) {
  const guns = fittedGuns(s, partsById, ov);
  const body = el('div', { class: 'simbody' });
  const tabs = el('div', { class: 'tabs simtabs', role: 'tablist', 'aria-label': 'Simulation type' });
  const card = el('div', { class: 'card' }, el('div', { class: 'sectitle' }, icon('combat'), el('h3', { text: 'Simulations' })), tabs, body);
  function draw() {
    tabs.textContent = '';
    for (const [id, label] of TABS) tabs.append(el('button', { type: 'button', role: 'tab', text: label, 'aria-selected': String(state.tab === id), tabindex: state.tab === id ? '0' : '-1', onclick: () => { state.tab = id; draw(); } }));
    body.textContent = '';
    if (state.tab === 'travel') { body.append(travelView(s, ov, partsById, draw)); return; }
    if (!guns.length) { body.append(note('This ship has no swappable guns to test. Pick a ship with weapon slots, or add guns in Armament.')); return; }
    body.append(weaponPicker(guns, draw));
    const shown = guns.find((g) => g.part.id === state.weapon)?.part || guns[0].part;
    body.append(state.tab === 'pen' ? penetrationView(s, shown) : deflectionView(s, shown));
  }
  draw();
  return card;
}

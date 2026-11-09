// Ship-builder maths for the companion (no DOM, so it can be tested in Node).
//
// A ship from /api/sc-builder has `slots` (editable hardpoints, each with the part fitted at the factory in
// `stock`). A loadout is just { slotId: partId } for the slots that differ from stock; everything else is stock.
// Parts come from the same snapshot as a Map-like lookup (id → part).

export const STALE_DAYS = 30;

// A part fits a slot when it is the same kind and its size is inside the slot's size range.
export function fits(slot, part) {
  return !!slot && !!part && part.type === slot.type && part.size >= slot.min && part.size <= slot.max;
}

export const indexParts = (parts) => new Map((parts || []).map((p) => [p.id, p]));

export function partsFor(slot, parts) {
  return (parts || []).filter((p) => fits(slot, p));
}

// The part id in each slot once overrides are applied.
export function resolve(ship, overrides = {}) {
  const out = {};
  for (const s of ship.slots) out[s.id] = overrides[s.id] ?? s.stock ?? null;
  return out;
}

const sum = (list, pick) => list.reduce((t, x) => t + (pick(x) || 0), 0);

// Totals for a loadout. Power and cooling only count the swappable parts, so read them as "what these parts
// give and take", not as the whole ship's budget (the flight controller, life support and so on are fixed).
export function totals(ship, partsById, overrides = {}) {
  const fitted = Object.entries(resolve(ship, overrides))
    .map(([slotId, partId]) => ({ slot: ship.slots.find((s) => s.id === slotId), part: partsById.get(partId) || null }))
    .filter((x) => x.slot);
  const missing = fitted.filter((x) => x.slot && !x.part).length;
  const parts = fitted.map((x) => x.part).filter(Boolean);
  const weapons = parts.filter((p) => p.wpn);
  return {
    shieldHp: sum(parts, (p) => p.shield?.hp),
    shieldRegen: sum(parts, (p) => p.shield?.regen),
    coolGen: sum(parts, (p) => p.cool),
    powerGen: sum(parts, (p) => p.gen),
    // A power plant's own `pw` figure is what it makes, not what it takes, so it is left out of the draw.
    powerDraw: Math.round(sum(parts.filter((p) => p.type !== 'PowerPlant'), (p) => p.pw) * 100) / 100,
    coolDraw: Math.round(sum(parts, (p) => p.cw) * 100) / 100,
    burstDps: Math.round(sum(weapons, (p) => p.wpn.burst) * 10) / 10,
    sustainedDps: Math.round(sum(weapons, (p) => p.wpn.sustained) * 10) / 10,
    alpha: Math.round(sum(weapons, (p) => p.wpn.alpha) * 10) / 10,
    mass: sum(parts, (p) => p.mass),
    guns: weapons.length,
    missing
  };
}

// b − a for each total, for comparing two builds (or a build against stock).
export function diff(a, b) {
  const out = {};
  for (const k of Object.keys(a)) out[k] = Math.round((b[k] - a[k]) * 100) / 100;
  return out;
}

const ageDays = (d, now) => (d ? (now - Date.parse(d)) / 86400000 : null);

// Cheapest known purchase for a part: { price, at, where, sys, date, stale } or null when no shop is known.
export function cheapest(part, now = Date.now()) {
  const row = part?.buy?.[0];
  if (!row) return null;
  const age = ageDays(row.d, now);
  return { price: row.p, at: row.at, where: row.where, near: row.near, sys: row.sys, date: row.d, stale: age != null && age > STALE_DAYS };
}

// What it costs to move from stock to this loadout: one line per changed slot, the known total, and how many
// parts have no known shop (those are left out of the total, never guessed).
export function upgradeCost(ship, partsById, overrides = {}, now = Date.now()) {
  const lines = [];
  let total = 0;
  let unknown = 0;
  for (const slot of ship.slots) {
    const id = overrides[slot.id];
    if (!id || id === slot.stock) continue;
    const part = partsById.get(id);
    const buy = cheapest(part, now);
    if (buy) total += buy.price;
    else unknown++;
    lines.push({ slot: slot.id, group: slot.group, part: part?.name || id, buy });
  }
  return { lines, total, unknown, stale: lines.some((l) => l.buy?.stale) };
}

// ---------------------------------------------------------------- labels for the page

export const TYPE_ORDER = ['WeaponGun', 'MissileLauncher', 'Shield', 'PowerPlant', 'Cooler', 'QuantumDrive', 'JumpDrive', 'Radar'];
export const TYPE_LABEL = { WeaponGun: 'Weapons', Shield: 'Shields', PowerPlant: 'Power plants', Cooler: 'Coolers', QuantumDrive: 'Quantum drives', JumpDrive: 'Jump drives', Radar: 'Radars', MissileLauncher: 'Missile racks' };

// 'hardpoint_shield_generator_l' → 'shield generator l'. A turret gun keeps the turret in its name, so eight
// guns read 'turret back rear · turret left', not eight identical 'class 2' rows.
export function slotLabel(slot) {
  const clean = (x) => String(x || '').replace(/^hardpoint[_-]?/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = slot.id.replace(/#\d+$/, '').split('/').map(clean).filter(Boolean);
  if (parts.length > 1 && /^class \d+$/i.test(parts[parts.length - 1])) parts.pop();
  const label = parts.join(' · ');
  return label || slot.type;
}

const fmtN = (v) => (v == null ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 }));

// The one number that tells parts of a kind apart, for the dropdown.
export function partStat(p) {
  if (p.shield?.hp != null) return `${fmtN(p.shield.hp)} HP`;
  if (p.wpn?.burst != null) return `${fmtN(p.wpn.burst)} dps`;
  if (p.gen != null) return `${fmtN(p.gen)} power`;
  if (p.cool != null) return `${fmtN(p.cool)} cooling`;
  return '';
}

export function partLabel(p) {
  return [p.name, p.grade, partStat(p)].filter(Boolean).join(' · ');
}

// Rows of the totals table: key in totals(), label, whether a bigger number is better.
export const TOTAL_ROWS = [
  ['burstDps', 'Burst DPS', true], ['sustainedDps', 'Sustained DPS (60 s)', true], ['alpha', 'Alpha damage', true],
  ['shieldHp', 'Shield HP', true], ['shieldRegen', 'Shield regen / s', true],
  ['powerGen', 'Power output (these parts)', true], ['powerDraw', 'Power draw (these parts)', false],
  ['coolGen', 'Cooling output (these parts)', true], ['coolDraw', 'Cooling draw (these parts)', false]
];

// 'ok' when a change helps, 'warn' when it hurts, '' for no change.
export function deltaClass(delta, higherBetter) {
  if (!delta) return '';
  return (delta > 0) === higherBetter ? 'ok' : 'warn';
}

export const signed = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmtN(Math.abs(v));

// ---------------------------------------------------------------- calculator additions

// Damage taken is stored as a multiplier (0.75 = takes 75%); the page shows the reduction.
export const reduction = (m) => (m == null ? null : Math.round((1 - m) * 100));

// Cooling load: how much of the cooling these parts produce the same parts ask for, as a percentage.
export function coolingLoad(t) {
  return t.coolGen > 0 ? Math.round((t.coolDraw / t.coolGen) * 100) : null;
}

// Damage split the way the page shows it: guns on the pilot's controls vs guns on turrets.
// A turret gun's slot group names its turret ('turret_left'); everything else is pilot-fixed.
export function damageSplit(ship, partsById, overrides = {}) {
  const out = { pilot: { alpha: 0, sustained: 0, burst: 0, guns: 0 }, turret: { alpha: 0, sustained: 0, burst: 0, guns: 0 } };
  const fitted = resolve(ship, overrides);
  for (const slot of ship.slots) {
    if (slot.type !== 'WeaponGun') continue;
    const w = partsById.get(fitted[slot.id])?.wpn;
    if (!w) continue;
    const bucket = /turret/i.test(slot.group || slot.id) ? out.turret : out.pilot;
    bucket.alpha += w.alpha || 0; bucket.sustained += w.sustained || 0; bucket.burst += w.burst || 0; bucket.guns++;
  }
  for (const b of Object.values(out)) for (const k of ['alpha', 'sustained', 'burst']) b[k] = Math.round(b[k] * 10) / 10;
  return out;
}

// Which slots differ from stock, as a short list for the page and for the share link.
export const changedSlots = (ship, overrides = {}) => ship.slots.filter((s) => overrides[s.id] && overrides[s.id] !== s.stock);

// ---------------------------------------------------------------- share links
// A build travels as base64url JSON: { s: shipId, o: { slotId: partId } }. Decoding checks the ship, the slots and
// that each part fits, so a mangled or hand-edited link can never put a part where it does not belong.
const b64 = {
  enc: (str) => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => decodeURIComponent(escape(atob(String(s).replace(/-/g, '+').replace(/_/g, '/'))))
};

export function encodeBuild(ship, overrides = {}) {
  const o = {};
  for (const s of changedSlots(ship, overrides)) o[s.id] = overrides[s.id];
  for (const [k, v] of Object.entries(overrides)) if (k.startsWith(MSL_KEY) && ship.slots.some((s) => MSL_KEY + s.id === k) && v) o[k] = v;
  return b64.enc(JSON.stringify({ s: ship.id, o }));
}

export function decodeBuild(code, ships, partsById) {
  try {
    const j = JSON.parse(b64.dec(code));
    const ship = (ships || []).find((x) => x.id === j.s);
    if (!ship || typeof j.o !== 'object' || !j.o) return null;
    const overrides = {};
    for (const [slotId, partId] of Object.entries(j.o)) {
      if (slotId.startsWith(MSL_KEY)) {
        const rackSlot = ship.slots.find((x) => x.type === 'MissileLauncher' && MSL_KEY + x.id === slotId);
        if (rackSlot && partsById.get(partId)?.type === 'Missile') overrides[slotId] = partId;
        continue;
      }
      const slot = ship.slots.find((x) => x.id === slotId);
      const part = partsById.get(partId);
      if (slot && part && fits(slot, part) && partId !== slot.stock) overrides[slotId] = partId;
    }
    return { ship, overrides };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- formatting for the stat panels
export const num = (v, d = 0) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }));
export const dims = (a) => (Array.isArray(a) && a.every((x) => x != null) ? a.map((x) => num(x, 1)).join(' × ') + ' m' : '—');
// Distances: the wiki gives metres; show Gm for jump distances and km/s for quantum speed.
export const gm = (m) => (m == null ? '—' : `${num(m / 1e9, 1)} Gm`);
export const kms = (ms) => (ms == null ? '—' : `${num(ms / 1000)} km/s`);

// ---------------------------------------------------------------- full stat sheet
// Every number worth comparing for one build, grouped for the page. [key, label, higherIsBetter, unit].
export const STAT_GROUPS = [
  ['Damage', [['burst', 'Burst DPS', true, ''], ['sustained', 'Sustained DPS', true, ''], ['alpha', 'Alpha damage', true, ''], ['missileDmg', 'Missile damage', true, '']]],
  ['Defense', [['shieldHp', 'Shield HP', true, ''], ['shieldRegen', 'Shield regen / s', true, ''], ['hull', 'Hull HP', true, ''], ['armorHp', 'Armor HP', true, ''], ['physRed', 'Physical reduction', true, '%'], ['enrgRed', 'Energy reduction', true, '%']]],
  ['Speed', [['scm', 'SCM speed', true, 'm/s'], ['max', 'Max speed', true, 'm/s'], ['boostF', 'Boost forward', true, 'm/s'], ['toScm', '0 to SCM time', false, 's']]],
  ['Maneuverability', [['pitch', 'Pitch', true, '°/s'], ['yaw', 'Yaw', true, '°/s'], ['roll', 'Roll', true, '°/s']]],
  ['Cargo and range', [['cargo', 'Cargo', true, 'SCU'], ['fuelH2', 'Hydrogen fuel', true, ''], ['fuelQt', 'Quantum fuel', true, ''], ['qtSpeed', 'Quantum speed', true, 'Gm/s'], ['qtRange', 'Quantum range', true, 'Gm']]],
  ['Systems', [['powerGen', 'Power output', true, ''], ['powerDraw', 'Power draw', false, ''], ['coolGen', 'Cooling output', true, ''], ['coolDraw', 'Cooling draw', false, ''], ['mass', 'Mass', false, 'kg'], ['crew', 'Crew (max)', true, '']]],
  ['Signature', [['sigIr', 'Infrared', false, ''], ['sigEm', 'Electromagnetic', false, '']]]
];
export const STAT_KEYS = STAT_GROUPS.flatMap(([, rows]) => rows.map((r) => r[0]));

const pos = (v) => (Number.isFinite(v) && v > 0 ? v : null);
// One flat map of numbers (or null when the data has none) for a ship with the given swaps applied.
export function statSheet(ship, partsById, overrides = {}) {
  const t = totals(ship, partsById, overrides);
  const st = ship.stats || {};
  const q = st.quantum || {};
  return {
    burst: pos(t.burstDps), sustained: pos(t.sustainedDps), alpha: pos(t.alpha), missileDmg: pos(st.missiles?.damage),
    shieldHp: pos(t.shieldHp), shieldRegen: pos(t.shieldRegen), hull: pos(st.hull), armorHp: pos(st.armor?.hp),
    physRed: st.armor?.phys != null ? reduction(st.armor.phys) : null, enrgRed: st.armor?.energy != null ? reduction(st.armor.energy) : null,
    scm: pos(ship.scm), max: pos(ship.max), boostF: pos(st.speed?.boostF), toScm: pos(st.speed?.toScm),
    pitch: pos(st.agility?.pitch), yaw: pos(st.agility?.yaw), roll: pos(st.agility?.roll),
    cargo: pos(ship.cargo), fuelH2: pos(st.fuel?.h2), fuelQt: pos(st.fuel?.qt),
    qtSpeed: q.speed ? Math.round(q.speed / 1e7) / 100 : null, qtRange: q.range ? Math.round(q.range / 1e7) / 100 : null,
    powerGen: pos(t.powerGen), powerDraw: pos(t.powerDraw), coolGen: pos(t.coolGen), coolDraw: pos(t.coolDraw),
    mass: pos(st.mass) , crew: pos(ship.crew?.max),
    sigIr: pos(st.sig?.ir), sigEm: pos(st.sig?.em)
  };
}

// ---------------------------------------------------------------- ships and vehicles
// The data tags each record 'ship', 'gravlev' (hover bike, grav vehicle) or 'ground'. The page shows two views.
export const viewOf = (ship) => (ship?.kind === 'gravlev' || ship?.kind === 'ground' ? 'vehicle' : 'ship');

// ---------------------------------------------------------------- ordnance (missiles on racks)
// A rack is a slot of type MissileLauncher (most are locked to the ship). The missile a player would load into a rack is
// kept in the same overrides map under 'm:<rack slot id>', so it saves, compares and travels in share links like any swap.
export const MSL_KEY = 'm:';

export function racksOf(ship, partsById, overrides = {}) {
  return (ship?.slots || []).filter((s) => s.type === 'MissileLauncher').map((slot) => {
    const rack = partsById.get(overrides[slot.id] ?? slot.stock) || null;
    const tubes = rack?.rack?.count ?? null;
    const size = rack?.rack?.size ?? null;
    const key = MSL_KEY + slot.id;
    const missile = partsById.get(overrides[key]) || null;
    // A stand-in slot, so the swap table can list the missiles that fit this rack with the same size rule as every other part.
    return { slot, key, rack, tubes, size, missile, pseudo: { id: key, type: 'Missile', min: size ?? 0, max: size ?? 99, stock: null } };
  });
}

// Missiles the player has chosen: how many tubes are set, and the damage of that load. Racks left on stock count for nothing.
export function ordnanceTotals(ship, partsById, overrides = {}) {
  let chosen = 0, damage = 0, tubes = 0;
  for (const r of racksOf(ship, partsById, overrides)) {
    if (r.tubes) tubes += r.tubes;
    if (r.missile && r.tubes && r.missile.msl?.dmg != null) { chosen += r.tubes; damage += r.tubes * r.missile.msl.dmg; }
  }
  return { tubes, chosen, damage: Math.round(damage) };
}

// ---------------------------------------------------------------- pop-up data: columns, sorting, data sheet
const col = (id, label, get, higher = true, bar = false) => ({ id, label, get, higher, bar });
const SPEC = {
  WeaponGun: [col('burst', 'Burst DPS', (p) => p.wpn?.burst, true, true), col('sust', 'Sustained', (p) => p.wpn?.sustained, true, true), col('alpha', 'Alpha', (p) => p.wpn?.alpha), col('range', 'Range (m)', (p) => p.wpn?.range)],
  Shield: [col('shp', 'Shield HP', (p) => p.shield?.hp, true, true), col('regen', 'Regen /s', (p) => p.shield?.regen, true, true)],
  PowerPlant: [col('gen', 'Power seg.', (p) => p.gen, true, true)],
  Cooler: [col('cool', 'Cooling', (p) => p.cool, true, true)],
  Missile: [col('dmg', 'Damage', (p) => p.msl?.dmg, true, true), col('lock', 'Lock (s)', (p) => p.msl?.lock, false), col('speed', 'Speed m/s', (p) => p.msl?.speed), col('rng', 'Lock range m', (p) => p.msl?.rmax), col('sig', 'Tracking', (p) => p.msl?.sig || null)],
  MissileLauncher: [col('tubes', 'Tubes', (p) => p.rack?.count), col('msize', 'Missile size', (p) => p.rack?.size)]
};
const COMMON = [col('size', 'Size', (p) => p.size), col('grade', 'Grade', (p) => p.grade || null), col('pw', 'Power', (p) => p.pw, false), col('cw', 'Heat', (p) => p.cw, false), col('mass', 'Mass', (p) => p.mass, false), col('price', 'aUEC', (p) => cheapest(p)?.price ?? null, false)];

export const columnsFor = (type) => [...(SPEC[type] || []), ...COMMON];

// Sort a copy of the list by a column; parts with no figure go last whichever way it runs. dir: 1 ascending, -1 descending.
export function sortParts(list, column, dir = -1) {
  const out = list.slice();
  if (!column) return out;
  return out.sort((a, b) => {
    const x = column.get(a), y = column.get(b);
    if (x == null && y == null) return a.name.localeCompare(b.name);
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : x - y;
    return c * dir || a.name.localeCompare(b.name);
  });
}

const GROUP_TITLE = { vehicle_weapon: 'Weapon', missile: 'Missile', shield: 'Shield', cooler: 'Cooler', power_plant: 'Power plant', quantum_drive: 'Quantum drive', jump_drive: 'Jump drive', radar: 'Radar', missile_rack: 'Missile rack', durability: 'Durability', distortion: 'Distortion', temperature: 'Temperature', emission: 'Emission', resource_network: 'Power and coolant' };
export const humanKey = (k) => String(k).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
export function fmtVal(v) {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v !== 'number') return String(v);
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && a < 0.001) return v.toExponential(2);
  return v.toLocaleString('en-US', { maximumFractionDigits: a >= 10000 ? 0 : a >= 100 ? 1 : 3 });
}

// Every figure the data holds for a part (`part.x`, flattened as 'vehicle_weapon.damage.dps.physical'), grouped by the
// part of the game data it came from, with readable labels: [{ title, rows: [[label, value]] }].
export function detailGroups(part) {
  const groups = new Map();
  for (const [key, value] of Object.entries(part?.x || {})) {
    const [root, ...rest] = key.split('.');
    const title = GROUP_TITLE[root] || humanKey(root);
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title).push([rest.map(humanKey).join(' › ') || humanKey(root), fmtVal(value)]);
  }
  return [...groups].map(([title, rows]) => ({ title, rows }));
}

// ---------------------------------------------------------------- swap pop-up: compare with the fitted part, and what is for sale
// Columns with no better direction (a size is not "better" than another) show the difference but never turn green or red.
const NEUTRAL_COLS = new Set(['size', 'grade', 'tubes', 'msize', 'sig']);
export const signedVal = (d) => (d > 0 ? '+' : '−') + fmtVal(Math.abs(d));

// True when the data holds at least one shop that sells the part. A part with no shop may still be loot, a reward or stock-only.
export const isBuyable = (p) => Array.isArray(p?.buy) && p.buy.length > 0;

// How one column's figure for `part` compares with the same figure on `ref` (the part now fitted):
// null when there is nothing to compare, else { delta, cls, text } with cls 'better', 'worse' or '' (no direction or no change).
export function compareCol(c, part, ref) {
  if (!c || !part || !ref || part.id === ref.id) return null;
  const a = c.get(part), b = c.get(ref);
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const delta = a - b;
  if (Math.abs(delta) < 1e-9) return { delta: 0, cls: '', text: '' };
  const cls = NEUTRAL_COLS.has(c.id) ? '' : (delta > 0) === c.higher ? 'better' : 'worse';
  return { delta, cls, text: signedVal(delta) };
}

// detailGroups with a third item per row: the difference from `ref`'s figure for the same key, when both are numbers.
export function detailGroupsVs(part, ref) {
  const groups = new Map();
  for (const [key, value] of Object.entries(part?.x || {})) {
    const [root, ...rest] = key.split('.');
    const title = GROUP_TITLE[root] || humanKey(root);
    if (!groups.has(title)) groups.set(title, []);
    const was = ref && ref.id !== part.id ? ref.x?.[key] : undefined;
    const d = typeof value === 'number' && typeof was === 'number' && Number.isFinite(value - was) ? value - was : 0;
    groups.get(title).push([rest.map(humanKey).join(' › ') || humanKey(root), fmtVal(value), Math.abs(d) < 1e-9 ? '' : signedVal(d)]);
  }
  return [...groups].map(([title, rows]) => ({ title, rows }));
}

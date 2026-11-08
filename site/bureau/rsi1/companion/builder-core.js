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

export const TYPE_ORDER = ['WeaponGun', 'Shield', 'PowerPlant', 'Cooler', 'QuantumDrive', 'JumpDrive', 'Radar'];
export const TYPE_LABEL = { WeaponGun: 'Weapons', Shield: 'Shields', PowerPlant: 'Power plants', Cooler: 'Coolers', QuantumDrive: 'Quantum drives', JumpDrive: 'Jump drives', Radar: 'Radars' };

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

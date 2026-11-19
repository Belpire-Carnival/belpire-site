// Mining lasers and modules as ship-builder parts and slots. Pure maths here; the one fetch is at the bottom and only reads our own /api.
// A mining ship gets one laser slot per head (the stock laser is fitted) and, under each, as many module slots as that laser has.
// Parts and slots are added in the same shape the wiki-based builder uses, so swapping, comparing and share links work unchanged.

export const FX_LABEL = { resistance: 'Resistance', instability: 'Instability', window: 'Charge window', rate: 'Charge rate', catastrophic: 'Overcharge speed', shatter: 'Shatter damage', cluster: 'Cluster', filter: 'Inert filter' };
const FX_ORDER = ['resistance', 'instability', 'window', 'rate', 'catastrophic', 'shatter', 'cluster', 'filter'];
const r1 = (v) => Math.round(v * 10) / 10;
export const fxLine = (fx) => FX_ORDER.filter((k) => fx?.[k]).map((k) => `${fx[k] > 0 ? '+' : '−'}${Math.abs(r1(fx[k]))}% ${FX_LABEL[k].toLowerCase()}`).join(' · ');

import { addSalvageGear } from './salvage-gear.js';

export const MG = 'mg:';
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const MAKERS = new Set(['argo', 'drake', 'gatac', 'greycat', 'misc', 'aegis', 'anvil', 'origin', 'crusader', 'rsi']);
// The ways one ship's name may be written: with or without its maker in front.
export const nameKeys = (name) => {
  const words = String(name || '').trim().split(/\s+/);
  const keys = [norm(name)];
  if (words.length > 1 && MAKERS.has(words[0].toLowerCase())) keys.push(norm(words.slice(1).join(' ')));
  return keys.filter(Boolean);
};

export function gearParts(gear) {
  const parts = [];
  for (const l of gear?.lasers || []) {
    parts.push({ id: MG + l.key, name: l.name.replace(/ Mining Laser$/, ''), type: 'MiningLaser', size: l.size, grade: '', cls: 'Mining', fx: l.fx, fxt: fxLine(l.fx), moduleSlots: l.slots,
      x: Object.fromEntries([...Object.entries(l.fx).map(([k, v]) => [`mining.${FX_LABEL[k].toLowerCase()} %`, v]), ['mining.module slots', l.slots]]) });
  }
  for (const m of gear?.modules || []) {
    parts.push({ id: MG + m.key, name: m.name, type: 'MiningModule', size: m.vehicle ? 0 : 1, grade: '', cls: m.kind === 'active' ? 'Active' : 'Passive', fx: m.fx, fxt: fxLine(m.fx), charges: m.charges,
      x: Object.fromEntries([...Object.entries(m.fx).map(([k, v]) => [`mining.${FX_LABEL[k].toLowerCase()} %`, v]), ...(m.charges ? [['mining.charges', m.charges]] : [])]) });
  }
  return parts;
}

// Slots for one gear ship: heads in order, each with its module slots.
export function gearSlots(gs, laserByKey) {
  const slots = [];
  let head = 0;
  for (const entry of gs.lasers) {
    for (let i = 0; i < entry.count; i++) {
      head++;
      const id = `mining laser ${head}`;
      slots.push({ id, type: 'MiningLaser', min: entry.size, max: entry.size, stock: MG + entry.key });
      const n = laserByKey.get(entry.key)?.slots || 0;
      for (let j = 1; j <= n; j++) slots.push({ id: `${id}/module ${j}`, type: 'MiningModule', min: gs.size === 0 ? 0 : 1, max: gs.size === 0 ? 0 : 1, stock: null, empty: true });
    }
  }
  return slots;
}

// Adds the gear parts to data.parts and the slots to every builder ship whose name matches a gear ship. Returns how many ships got them.
export function addMiningGear(data, gear) {
  addSalvageGear(data, gear?.salvage, nameKeys);
  if (!data || !Array.isArray(data.ships) || !gear?.ships?.length) return 0;
  const have = new Set((data.parts || []).map((p) => p.id));
  data.parts = [...(data.parts || []), ...gearParts(gear).filter((p) => !have.has(p.id))];
  const laserByKey = new Map((gear.lasers || []).map((l) => [l.key, l]));
  const byName = new Map();
  for (const gs of gear.ships) for (const k of nameKeys(gs.name)) if (!byName.has(k)) byName.set(k, gs);
  let n = 0;
  for (const ship of data.ships) {
    if (ship.slots?.some((s) => s.type === 'MiningLaser')) continue;
    const gs = nameKeys(ship.name).map((k) => byName.get(k)).find(Boolean);
    if (!gs) continue;
    ship.slots = [...(ship.slots || []), ...gearSlots(gs, laserByKey)];
    n++;
  }
  return n;
}

// Loads the gear from this site and merges it into the builder data. Never throws: without the gear the builder is just as before.
export async function withMiningGear(data) {
  try {
    const res = await fetch('/api/sc-mining-gear', { headers: { Accept: 'application/json' } });
    if (res.ok) addMiningGear(data, await res.json());
  } catch { /* the builder works without it */ }
  return data;
}

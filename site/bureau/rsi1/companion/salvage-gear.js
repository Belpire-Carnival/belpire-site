// Salvage heads and scraper modules as ship-builder parts and slots (v0.2.5). Pure maths; the data arrives with the mining gear file.
// A salvage ship gets one head slot per head (the stock head is fitted) and, under each, as many scraper-module slots as that head has.

export const SG = 'mg:';
const pct = (v) => `${Math.round(v * 100)}%`;
const x2 = (v) => `×${Math.round(v * 100) / 100}`;

export function salvageParts(salvage) {
  const parts = [];
  for (const h of salvage?.heads || []) {
    parts.push({ id: SG + h.key, name: h.name, type: 'SalvageHead', size: h.size, grade: '', cls: 'Salvage', fxt: `${h.slots} scraper slot${h.slots === 1 ? '' : 's'}`, moduleSlots: h.slots, x: { 'salvage.scraper slots': h.slots } });
  }
  for (const m of salvage?.modules || []) {
    parts.push({ id: SG + m.key, name: m.name, type: 'SalvageModifier', size: 1, grade: '', cls: /Salvation/.test(m.key) ? 'Salvation scraper' : 'Scraper', speed: m.speed, radius: m.radius, eff: m.eff,
      fxt: `speed ${x2(m.speed)} · radius ${x2(m.radius)} · recovery ${pct(m.eff)}`, x: { 'salvage.speed': m.speed, 'salvage.radius': m.radius, 'salvage.recovery %': Math.round(m.eff * 100) } });
  }
  return parts;
}

export function salvageSlots(ss, headByKey) {
  const slots = [];
  let n = 0;
  for (const entry of ss.heads) {
    for (let i = 0; i < entry.count; i++) {
      n++;
      const id = `salvage head ${n}`, h = headByKey.get(entry.key);
      slots.push({ id, type: 'SalvageHead', min: h?.size ?? 2, max: h?.size ?? 2, stock: SG + entry.key });
      for (let j = 1; j <= (h?.slots || 0); j++) slots.push({ id: `${id}/scraper ${j}`, type: 'SalvageModifier', min: 1, max: 1, stock: null, empty: true });
    }
  }
  return slots;
}

// `names` is the name matcher from mining-gear.js (nameKeys). Returns how many ships got slots.
export function addSalvageGear(data, salvage, nameKeys) {
  if (!data || !Array.isArray(data.ships) || !salvage?.ships?.length) return 0;
  const have = new Set((data.parts || []).map((p) => p.id));
  data.parts = [...(data.parts || []), ...salvageParts(salvage).filter((p) => !have.has(p.id))];
  const headByKey = new Map((salvage.heads || []).map((h) => [h.key, h]));
  const byName = new Map();
  for (const s of salvage.ships) for (const k of nameKeys(s.name)) if (!byName.has(k)) byName.set(k, s);
  let n = 0;
  for (const ship of data.ships) {
    if (ship.slots?.some((s) => s.type === 'SalvageHead')) continue;
    const s = nameKeys(ship.name).map((k) => byName.get(k)).find(Boolean);
    if (!s) continue;
    ship.slots = [...(ship.slots || []), ...salvageSlots(s, headByKey)];
    n++;
  }
  return n;
}

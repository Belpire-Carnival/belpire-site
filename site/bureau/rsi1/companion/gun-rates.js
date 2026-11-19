// Game-derived fire rates for the builder's guns. Pure matching here; the one fetch is at the bottom and only reads our own /api.
// A gun's wiki DPS stays as it is. When the game's own firing sequence gives a figure for the same gun (same name and size) it is
// attached as part.game and shown beside it, so a disagreement is visible instead of hidden. Names that two different guns share, with
// different figures, are left out rather than guessed.
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const keyOf = (name, size) => `${norm(name)}|${size ?? ''}`;

export function indexRates(rates) {
  const groups = new Map();
  for (const g of rates?.guns || []) {
    const k = keyOf(g.n, g.s);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(g);
  }
  const out = new Map();
  for (const [k, list] of groups) {
    const hi = Math.max(...list.map((g) => g.dps)), lo = Math.min(...list.map((g) => g.dps));
    if (hi - lo > hi * 0.01) continue; // two guns with one name and different numbers: ambiguous
    out.set(k, list[0]);
  }
  return out;
}

// Adds part.game to every gun part the game data covers. Returns how many matched.
export function addGunRates(data, rates) {
  const idx = indexRates(rates);
  let n = 0;
  for (const p of data?.parts || []) {
    if (p.type !== 'WeaponGun') continue;
    const g = idx.get(keyOf(p.name, p.size));
    if (!g) continue;
    p.game = { rpm: g.rpm, dps: g.dps, ...(g.barrels ? { barrels: g.barrels } : {}), ...(g.uneven ? { uneven: true, rpmAlt: g.rpmAlt, dpsAlt: g.dpsAlt } : {}) };
    p.x = { ...(p.x || {}), 'game data.fire rate rpm': g.rpm, 'game data.damage per shot': g.perShot, 'game data.dps': g.dps, ...(g.barrels ? { 'game data.barrels': g.barrels } : {}), ...(g.uneven ? { 'game data.dps (other reading)': g.dpsAlt } : {}) };
    n++;
  }
  return n;
}

// Never throws: without the rates the builder shows the wiki figures only.
export async function withGunRates(data) {
  try {
    const res = await fetch('/api/sc-gun-rates', { headers: { Accept: 'application/json' } });
    if (res.ok) addGunRates(data, await res.json());
  } catch { /* the builder works without it */ }
  return data;
}

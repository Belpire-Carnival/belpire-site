// Ship-gun fire rates from the game's own firing sequences, taken by the OmniGlass Desktop extractor
// (`node tools/extract/run.mjs weapons` writes out/gun-rates.json, copied to worker/sc-gun-rates.json). Derived numbers only.
// GET /api/sc-gun-rates → { v, build, guns: [{ n: name, s: size, rpm, dps, perShot, barrels?, uneven?, rpmAlt?, dpsAlt? }] }
import data from './sc-gun-rates.json' with { type: 'json' };

const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const n1 = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : 0);

export function cleanRates(d) {
  const guns = [];
  for (const g of Array.isArray(d?.guns) ? d.guns.slice(0, 600) : []) {
    const n = str(g?.n, 80);
    if (!n || !(n1(g?.dps) > 0)) continue;
    const row = { n, s: Math.max(0, Math.min(12, Math.round(Number(g.s)) || 0)), rpm: n1(g.rpm), dps: n1(g.dps), perShot: n1(g.perShot) };
    if (Number(g.barrels) > 1) row.barrels = Math.min(16, Math.round(Number(g.barrels)));
    if (g.uneven) { row.uneven = true; row.rpmAlt = n1(g.rpmAlt); row.dpsAlt = n1(g.dpsAlt); }
    guns.push(row);
  }
  return { v: 1, build: str(d?.build, 30), guns };
}

export const handleGunRates = () => ({ status: 200, body: cleanRates(data) });

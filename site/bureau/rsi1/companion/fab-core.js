// Fabricator maths (pure, no DOM). A blueprint's requirement groups each take one material, and the quality of that
// material (0 to 1000) moves the crafted item's stats between a low and a high multiplier. The ranges come from the Star
// Citizen Wiki API (data from the game files); only the straight-line ("linear") curve is modelled here.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ok = (v) => Number.isFinite(v);

export const isLinear = (m) => !!m && m.curve === 'linear' && ok(m.qmin) && ok(m.qmax) && m.qmax > m.qmin && ok(m.lo) && ok(m.hi);

// Stat multiplier a modifier gives at material quality q, or null when the curve is not a straight line.
export function multiplier(m, q) {
  if (!isLinear(m) || !ok(q)) return null;
  const t = clamp((q - m.qmin) / (m.qmax - m.qmin), 0, 1);
  return m.lo + (m.hi - m.lo) * t;
}

// Material quality needed for a wanted multiplier, or null when it is out of range (or the curve is not modelled).
export function qualityFor(m, target) {
  if (!isLinear(m) || !ok(target) || m.hi === m.lo) return null;
  const t = (target - m.lo) / (m.hi - m.lo);
  if (t < -1e-9 || t > 1 + 1e-9) return null;
  return Math.round(m.qmin + clamp(t, 0, 1) * (m.qmax - m.qmin));
}

// "+10.0%" / "-5.0%" / "+0.0%"
export const pct = (mult) => (ok(mult) ? `${mult >= 1 ? '+' : '-'}${Math.abs((mult - 1) * 100).toFixed(1)}%` : '—');
// 'good' | 'bad' | 'flat' for colouring: better_when says which direction helps.
export function verdict(m, mult) {
  if (!ok(mult) || Math.abs(mult - 1) < 0.0005) return 'flat';
  const up = mult > 1;
  return (m.better === 'lower' ? !up : up) ? 'good' : 'bad';
}

// The starting quality the game offers for each slot is the middle of the slider.
export const START_QUALITY = 500;
export const clampQuality = (q) => (ok(q) ? clamp(Math.round(q), 1, 1000) : START_QUALITY);

// Materials for `crafts` crafts, using the picked child of each group (index per group key; default the first).
export function materialList(groups, picks = {}, crafts = 1) {
  const n = Math.max(1, Math.min(999, Math.floor(crafts) || 1));
  const out = [];
  for (const g of Array.isArray(groups) ? groups : []) {
    const kids = g.kids || [];
    const k = kids[clamp(Number(picks[g.key]) || 0, 0, Math.max(0, kids.length - 1))];
    if (!k) continue;
    out.push({ group: g.name, name: k.name, kind: k.kind, scu: ok(k.scu) ? Math.round(k.scu * n * 1000) / 1000 : null, qty: ok(k.qty) ? k.qty * n : null, minq: k.minq });
  }
  return out;
}

// Every stat the blueprint can change, with the multiplier each slot's quality gives it.
export function statRows(groups, quality) {
  const rows = [];
  for (const g of Array.isArray(groups) ? groups : []) {
    for (const m of g.mods || []) {
      const q = ok(quality[g.key]) ? quality[g.key] : START_QUALITY;
      const mult = multiplier(m, q);
      rows.push({ group: g.name, gkey: g.key, mod: m, q, mult, modelled: isLinear(m) });
    }
  }
  return rows;
}

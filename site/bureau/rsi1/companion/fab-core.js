// Fabricator maths (pure, no DOM). A blueprint's requirement groups each take one material, and the quality of that
// material (0 to 1000) moves the crafted item's stats between a low and a high multiplier. The ranges come from the Star
// Citizen Wiki API (data from the game files); only the straight-line ("linear") curve is modelled here.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ok = (v) => Number.isFinite(v);

export const isLinear = (m) => !!m && m.curve === 'linear' && ok(m.qmin) && ok(m.qmax) && m.qmax > m.qmin && ok(m.lo) && ok(m.hi);
// Game-file blueprints can give a curve in segments: { curve: 'piecewise', ranges: [{ q0, q1, m0, m1 }] }, each a straight line.
const segs = (m) => (Array.isArray(m.ranges) ? m.ranges.filter((r) => r && ok(r.q0) && ok(r.q1) && ok(r.m0) && ok(r.m1) && r.q1 >= r.q0) : []);
export const isPiecewise = (m) => !!m && m.curve === 'piecewise' && segs(m).length > 0;
export const isModelled = (m) => isLinear(m) || isPiecewise(m);
const along = (r, q) => (r.q1 === r.q0 ? r.m1 : r.m0 + (r.m1 - r.m0) * clamp((q - r.q0) / (r.q1 - r.q0), 0, 1));

// Stat multiplier a modifier gives at material quality q, or null when the curve is not a straight line.
export function multiplier(m, q) {
  if (isPiecewise(m) && ok(q)) {
    const rs = segs(m), first = rs[0], last = rs[rs.length - 1];
    if (q <= first.q0) return first.m0;
    if (q >= last.q1) return last.m1;
    const r = rs.find((x) => q >= x.q0 && q <= x.q1);
    if (r) return along(r, q);
    const i = rs.findIndex((x) => x.q0 > q); // between two segments: hold the earlier segment's end value
    return i > 0 ? rs[i - 1].m1 : first.m0;
  }
  if (!isLinear(m) || !ok(q)) return null;
  const t = clamp((q - m.qmin) / (m.qmax - m.qmin), 0, 1);
  return m.lo + (m.hi - m.lo) * t;
}

// Material quality needed for a wanted multiplier, or null when it is out of range (or the curve is not modelled).
export function qualityFor(m, target) {
  if (isPiecewise(m) && ok(target)) {
    for (const r of segs(m)) {
      const lo = Math.min(r.m0, r.m1), hi = Math.max(r.m0, r.m1);
      if (r.m0 === r.m1 || target < lo - 1e-9 || target > hi + 1e-9) continue;
      return Math.round(r.q0 + clamp((target - r.m0) / (r.m1 - r.m0), 0, 1) * (r.q1 - r.q0));
    }
    return null;
  }
  if (!isLinear(m) || !ok(target) || m.hi === m.lo) return null;
  const t = (target - m.lo) / (m.hi - m.lo);
  if (t < -1e-9 || t > 1 + 1e-9) return null;
  return Math.round(m.qmin + clamp(t, 0, 1) * (m.qmax - m.qmin));
}

// "+10.0%" / "-5.0%" / "+0.0%"
export const pct = (mult) => (ok(mult) ? `${mult >= 1 ? '+' : '-'}${Math.abs((mult - 1) * 100).toFixed(1)}%` : '—');
// ▲ / ▼ so a change reads without colour; a flat result gets a dash.
export const arrow = (mult) => (!ok(mult) || Math.abs(mult - 1) < 0.0005 ? '–' : mult > 1 ? '▲' : '▼');
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
      rows.push({ group: g.name, gkey: g.key, mod: m, q, mult, modelled: isModelled(m) });
    }
  }
  return rows;
}

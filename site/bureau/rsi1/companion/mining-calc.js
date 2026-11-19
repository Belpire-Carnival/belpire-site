// Rock-breaker maths for the Extraction tab (no DOM, so it can be tested in Node).
// Formula: the community's breakability rule, the same in the public mining calculators we checked:
//   power needed = (rock mass / (1 − adjusted resistance / 100)) / 5
// where adjusted resistance is the rock's scanned resistance times every resistance modifier in play (laser heads, modules, gadget),
// multiplied together, and the power a head delivers is its full-throttle power times each of its modules' power multipliers.
// The modifier numbers come from the game's own files; the formula itself is a community model, not read from the game. Treat it as a planning aid.
export const DIVISOR = 5;

const mult = (pct) => 1 + (Number(pct) || 0) / 100;
export const adjust = (base, pcts) => (Number(base) || 0) * pcts.reduce((t, p) => t * mult(p), 1);
export const needed = (mass, resist) => (!(mass > 0) ? 0 : resist >= 100 ? Infinity : mass / (1 - resist / 100) / DIVISOR);
export const headPower = (laser, modules = []) => (laser?.power || 0) * modules.reduce((t, m) => t * (m?.power || 1), 1);

// heads: [{ laser, modules: [module] }]; gadget: { fx } | null. Returns what the rock looks like with that kit and whether it breaks.
export function evaluate({ mass, resist, instab }, heads, gadget = null) {
  const fxs = [...heads.flatMap((h) => [h.laser?.fx, ...(h.modules || []).map((m) => m?.fx)]), gadget?.fx].filter(Boolean);
  const effRes = adjust(resist, fxs.map((f) => f.resistance));
  const effInst = adjust(instab, fxs.map((f) => f.instability));
  const perHead = heads.map((h) => Math.round(headPower(h.laser, h.modules)));
  const available = perHead.reduce((t, p) => t + p, 0);
  const required = needed(mass, effRes);
  const minThrottle = heads.length && heads[0].laser?.tmin ? Math.max(...heads.map((h) => h.laser?.tmin || 0)) : 0;
  return {
    effRes: Math.round(effRes * 10) / 10, effInst: Math.round(effInst * 10) / 10, perHead, available, required: Number.isFinite(required) ? Math.round(required) : Infinity,
    throttle: available > 0 && Number.isFinite(required) ? Math.round((required / available) * 1000) / 10 : null,
    verdict: !(mass > 0) ? 'empty' : effRes >= 100 || !(available > 0) ? 'never' : required <= available ? 'breaks' : 'short',
    minThrottle: Math.round(minThrottle * 100)
  };
}

// Ships grouped by their head layout, de-duplicated by name, with the lasers they mount fitted as stock.
export function shipHeads(ship, laserByKey) {
  const heads = [];
  for (const e of ship?.lasers || []) for (let i = 0; i < e.count; i++) heads.push({ size: e.size, laser: laserByKey.get(e.key) || null });
  return heads;
}

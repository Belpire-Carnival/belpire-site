// Mining lasers, mining modules, gadgets and which ships mount them, taken from the game's own database by the OmniGlass Desktop
// extractor (copied to worker/sc-mining-gear.json). Derived numbers only.
// GET /api/sc-mining-gear → { v, build, lasers: [{ key, name, size, slots, fx, power?, ext?, tmin? }], modules: [{ key, name, kind, charges, vehicle, fx, power?, ext? }],
//   gadgets: [{ key, name, fx }], salvage: { heads: [{ key, name, size, slots }], modules: [{ key, name, speed, radius, eff }], ships: [{ key, name, heads: [{ key, count }] }] },
//   ships: [{ key, name, size, lasers: [{ size, key, count }] }] }. Effects are percent changes ({ resistance: -30 } is −30%);
//   `power` on a laser is its full-throttle power, on a module the multiplier it puts on that power; `tmin` is the laser's lowest throttle (0-1).
import data from './sc-mining-gear.json' with { type: 'json' };

const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const FX = new Set(['resistance', 'instability', 'window', 'rate', 'catastrophic', 'shatter', 'cluster', 'filter']);
const fxOf = (o) => {
  const out = {};
  for (const [k, v] of Object.entries(o && typeof o === 'object' ? o : {})) if (FX.has(k) && Number.isFinite(Number(v))) out[k] = Math.round(Number(v) * 100) / 100;
  return out;
};
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v)) || 0));
const pos = (v, hi) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.min(hi, Math.round(Number(v) * 1000) / 1000) : undefined);
const opt = (k, v) => (v === undefined ? {} : { [k]: v });

export function cleanGear(d) {
  const lasers = (Array.isArray(d?.lasers) ? d.lasers : []).slice(0, 80).map((l) => ({ key: str(l?.key, 80), name: str(l?.name, 60), size: int(l?.size, 0, 4), slots: int(l?.slots, 0, 6), fx: fxOf(l?.fx), ...opt('power', pos(l?.power, 100000)), ...opt('ext', pos(l?.ext, 100000)), ...opt('tmin', pos(l?.tmin, 1)) })).filter((l) => l.key && l.name);
  const modules = (Array.isArray(d?.modules) ? d.modules : []).slice(0, 120).map((m) => ({ key: str(m?.key, 80), name: str(m?.name, 60), kind: m?.kind === 'active' ? 'active' : 'passive', charges: int(m?.charges, 0, 99), vehicle: !!m?.vehicle, fx: fxOf(m?.fx), ...opt('power', pos(m?.power, 10)), ...opt('ext', pos(m?.ext, 10)) })).filter((m) => m.key && m.name);
  const gadgets = (Array.isArray(d?.gadgets) ? d.gadgets : []).slice(0, 30).map((g) => ({ key: str(g?.key, 80), name: str(g?.name, 40), fx: fxOf(g?.fx) })).filter((g) => g.key && g.name);
  const ships = (Array.isArray(d?.ships) ? d.ships : []).slice(0, 80).map((s) => ({
    key: str(s?.key, 80), name: str(s?.name, 80), size: int(s?.size, 0, 4),
    lasers: (Array.isArray(s?.lasers) ? s.lasers : []).slice(0, 8).map((x) => ({ size: int(x?.size, 0, 4), key: str(x?.key, 80), count: int(x?.count, 1, 8) })).filter((x) => x.key)
  })).filter((s) => s.key && s.name && s.lasers.length);
  const sv = d?.salvage || {};
  const heads = (Array.isArray(sv.heads) ? sv.heads : []).slice(0, 20).map((h) => ({ key: str(h?.key, 80), name: str(h?.name, 40), size: int(h?.size, 0, 4), slots: int(h?.slots, 0, 6) })).filter((h) => h.key && h.name);
  const smods = (Array.isArray(sv.modules) ? sv.modules : []).slice(0, 30).map((m) => ({ key: str(m?.key, 80), name: str(m?.name, 40), speed: pos(m?.speed, 10) || 0, radius: pos(m?.radius, 100) || 0, eff: pos(m?.eff, 1) || 0 })).filter((m) => m.key && m.name);
  const sships = (Array.isArray(sv.ships) ? sv.ships : []).slice(0, 40).map((s) => ({ key: str(s?.key, 80), name: str(s?.name, 80),
    heads: (Array.isArray(s?.heads) ? s.heads : []).slice(0, 6).map((x) => ({ key: str(x?.key, 80), count: int(x?.count, 1, 8) })).filter((x) => x.key) })).filter((s) => s.key && s.name && s.heads.length);
  return { v: 3, build: str(d?.build, 30), lasers, modules, gadgets, ships, salvage: { heads, modules: smods, ships: sships } };
}

export const handleMiningGear = () => ({ status: 200, body: cleanGear(data) });

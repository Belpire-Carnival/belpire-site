// Trade planning over the live UEX price rows: best runs, and the best areas inside each star system.
// Pure functions (no DOM) so they can be tested. A row is { commodity, terminal, system, place, buy, sell, scuBuy, scuSell, at }.
import { riskOf, worst, LEVELS } from './risk.js';

export const SYSTEM_ORDER = ['Stanton', 'Pyro', 'Nyx'];
const DAY = 864e5;
const tsMs = (t) => (t == null ? null : t < 1e12 ? t * 1000 : t);
export const areaOf = (r) => r.place || r.terminal;
export const riskOfRow = (r) => riskOf(r.system, r.terminal, r.place);

export function freshRows(prices, now = Date.now(), maxAge = 14 * DAY) {
  return (Array.isArray(prices) ? prices : []).filter((r) => { const t = tsMs(r.at); return t == null || now - t <= maxAge; });
}
export function systemsIn(rows) {
  const seen = [...new Set(rows.map((r) => r.system).filter(Boolean))];
  return [...SYSTEM_ORDER.filter((s) => seen.includes(s)), ...seen.filter((s) => !SYSTEM_ORDER.includes(s)).sort()];
}

function byCommodity(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = r.commodity.toLowerCase();
    let c = m.get(k);
    if (!c) m.set(k, (c = { name: r.commodity, buys: [], sells: [] }));
    if (r.buy) c.buys.push(r);
    if (r.sell) c.sells.push(r);
  }
  for (const c of m.values()) { c.buys.sort((a, b) => a.buy - b.buy); c.sells.sort((a, b) => b.sell - a.sell); }
  return m;
}
const scope = (rows, { system = '', q = '', avoidHigh = false } = {}) => rows.filter((r) =>
  (!system || r.system === system) && (!q || r.commodity.toLowerCase().includes(q)) && (!avoidHigh || riskOfRow(r).level !== 'high'));

// Best buy-to-sell pair for each commodity inside the chosen scope.
export function bestRuns(rows, opts = {}) {
  const out = [];
  for (const c of byCommodity(scope(rows, opts)).values()) {
    const b = c.buys[0], s = b && c.sells.find((x) => x.terminal !== b.terminal);
    if (b && s && s.sell > b.buy) out.push({ commodity: c.name, from: b, to: s, margin: s.sell - b.buy, cross: b.system !== s.system, risk: worst(riskOfRow(b), riskOfRow(s)) });
  }
  return out.sort((a, b) => b.margin - a.margin);
}

// Every area (a city, station, outpost or moon) in one system, ranked by the best run that starts or ends there.
// An area's "out" list is what to buy here and where it sells best in the system; its "in" list is what sells well here.
export function areaBoard(rows, system, opts = {}) {
  const sc = scope(rows, { ...opts, system });
  const comm = byCommodity(sc);
  const areas = new Map();
  const get = (r) => {
    const n = areaOf(r);
    let a = areas.get(n);
    if (!a) areas.set(n, (a = { name: n, system: r.system, terminals: new Set(), out: [], in: [], risks: [] }));
    a.terminals.add(r.terminal); a.risks.push(riskOfRow(r));
    return a;
  };
  for (const c of comm.values()) {
    for (const r of c.buys) {
      const a = get(r), s = c.sells.find((x) => areaOf(x) !== areaOf(r));
      if (s && s.sell > r.buy) a.out.push({ commodity: c.name, margin: s.sell - r.buy, price: r.buy, other: s.terminal, otherPrice: s.sell, otherRisk: riskOfRow(s) });
    }
    for (const r of c.sells) {
      const a = get(r), b = c.buys.find((x) => areaOf(x) !== areaOf(r));
      if (b && r.sell > b.buy) a.in.push({ commodity: c.name, margin: r.sell - b.buy, price: r.sell, other: b.terminal, otherPrice: b.buy, otherRisk: riskOfRow(b) });
    }
  }
  // Runs that leave the system (through a jump point): the best of them for each area, kept apart from the ranking.
  const far = new Map();
  for (const c of byCommodity(scope(rows, { ...opts, system: '' })).values()) {
    for (const r of c.buys.filter((x) => x.system === system)) {
      const s = c.sells.find((x) => x.system !== system);
      const cur = far.get(areaOf(r));
      if (s && s.sell > r.buy && (!cur || s.sell - r.buy > cur.margin)) far.set(areaOf(r), { commodity: c.name, margin: s.sell - r.buy, price: r.buy, other: s.terminal, otherSystem: s.system, otherPrice: s.sell, otherRisk: riskOfRow(s) });
    }
  }
  const list = [];
  for (const a of areas.values()) {
    a.out.sort((x, y) => y.margin - x.margin); a.in.sort((x, y) => y.margin - x.margin);
    const score = Math.max(a.out[0]?.margin || 0, a.in[0]?.margin || 0);
    list.push({ name: a.name, system: a.system, terminals: [...a.terminals], risk: worst(...a.risks), score, jump: far.get(a.name) || null, out: a.out.slice(0, 5), in: a.in.slice(0, 5) });
  }
  return list.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
}
export { riskOf, worst, LEVELS };

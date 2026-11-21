// Trade planning over the live UEX price rows: best runs, and the best areas inside each star system.
// Pure functions (no DOM) so they can be tested. A row is { commodity, terminal, system, place, body, buy, sell, scuBuy, scuSell, at }.
import { riskOf, worst, LEVELS, runRisk } from './risk.js';

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
const scope = (rows, { system = '', q = '', avoidHigh = false, onlySafe = false } = {}) => rows.filter((r) =>
  (!system || r.system === system) && (!q || r.commodity.toLowerCase().includes(q)) && (!avoidHigh || riskOfRow(r).level !== 'high') && (!onlySafe || riskOfRow(r).level === 'safe'));

// How many SCU one trip carries and what it earns. The limits are your hold, your capital, the stock the buy terminal reports and the
// amount the sell terminal reports wanting; the lowest wins and is named. A figure the terminal does not report is simply not a limit.
export function sizeRun(from, to, { hold = 0, capital = 0 } = {}) {
  const caps = [];
  if (hold > 0) caps.push([hold, 'hold']);
  if (capital > 0 && from.buy > 0) caps.push([Math.floor(capital / from.buy), 'capital']);
  if (from.scuSell > 0) caps.push([from.scuSell, 'stock']);
  if (to.scuBuy > 0) caps.push([to.scuBuy, 'demand']);
  if (!caps.length) return { scu: 0, limit: '', profit: 0 };
  const [scu, limit] = caps.reduce((a, b) => (b[0] < a[0] ? b : a));
  return { scu, limit, profit: Math.max(0, scu) * (to.sell - from.buy) };
}

// Best buy-to-sell pair for each commodity inside the chosen scope. With opts.size ({ hold, capital }) the pair is the one that earns
// most per trip (looking at the five cheapest buys and five best sells), and the list is ranked by that profit instead of margin per SCU.
export function bestRuns(rows, opts = {}) {
  const out = [];
  const sz = opts.size && (opts.size.hold > 0 || opts.size.capital > 0) ? opts.size : null;
  for (const c of byCommodity(scope(rows, opts)).values()) {
    if (sz) {
      let best = null;
      for (const b of c.buys.slice(0, 5)) for (const s of c.sells.slice(0, 5)) {
        if (s.terminal === b.terminal || !(s.sell > b.buy)) continue;
        const t = sizeRun(b, s, sz);
        if (!best || t.profit > best.t.profit || (t.profit === best.t.profit && s.sell - b.buy > best.s.sell - best.b.buy)) best = { b, s, t };
      }
      if (best) out.push({ commodity: c.name, from: best.b, to: best.s, margin: best.s.sell - best.b.buy, cross: best.b.system !== best.s.system, risk: runRisk(riskOfRow(best.b), riskOfRow(best.s)), buyRisk: riskOfRow(best.b), sellRisk: riskOfRow(best.s), scu: best.t.scu, limit: best.t.limit, profit: best.t.profit });
      continue;
    }
    const b = c.buys[0], s = b && c.sells.find((x) => x.terminal !== b.terminal);
    if (b && s && s.sell > b.buy) out.push({ commodity: c.name, from: b, to: s, margin: s.sell - b.buy, cross: b.system !== s.system, risk: runRisk(riskOfRow(b), riskOfRow(s)), buyRisk: riskOfRow(b), sellRisk: riskOfRow(s) });
  }
  return out.sort((a, b) => (sz ? b.profit - a.profit : 0) || b.margin - a.margin);
}

// Best runs where both ends are Safe (inside an armistice zone), so nobody can shoot you at the shop or the pad.
// The trip between them is not covered: quantum travel and the approach are still open.
export const safeRuns = (rows, opts = {}) => bestRuns(rows, { ...opts, onlySafe: true });

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
export { riskOf, worst, LEVELS, runRisk };

// ---- "Sell at": the places that pay for a commodity, and the one a player typed -------------------------------
const flat = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const placeLabel = (r) => [r?.terminal, r?.system].filter(Boolean).join(' · ');

/**
 * Finds the sell row for text a player typed. An exact terminal, place or "terminal · system" wins; otherwise every
 * word typed must appear in the terminal, place or system name (so "Lorville", "Port Tressler" and "Pyro" all work),
 * and the best-paying match is used. Returns { row, matches, exact } or null when nothing pays for it.
 */
export function findSellPlace(sells, text) {
  const q = flat(text);
  if (!q) return null;
  const list = (Array.isArray(sells) ? sells : []).filter((r) => r && r.sell > 0);
  const names = (r) => [placeLabel(r), r.terminal, r.place].map(flat).filter(Boolean);
  const exact = list.filter((r) => names(r).includes(q));
  const pool = exact.length ? exact : list.filter((r) => { const hay = names(r).join(' '); return q.split(' ').every((w) => hay.includes(w)); });
  if (!pool.length) return null;
  return { row: pool.reduce((a, r) => (r.sell > a.sell ? r : a), pool[0]), matches: pool.length, exact: exact.length > 0 };
}

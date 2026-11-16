// Waypoint ("nearest to me") for OmniOps: from the live UEX terminal rows, find where a service or a commodity is,
// ordered by how close it is in the verse's hierarchy: same place, same moon or planet, same system, other systems.
// There are no coordinates in this data, so "close" is a tier, not a distance. Pure functions, no page access.
export const TIERS = ['Here', 'Same moon or planet', 'Same system', 'Other systems'];
export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const money = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

// One entry per place: { key, name, system, body, terminals: [{ name, buys, sells }] }.
// buys = what you can buy there (price you pay); sells = what the terminal pays you for.
export function buildPlaces(rows) {
  const places = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.terminal) continue;
    const name = r.place || r.terminal, key = `${norm(r.system)}|${norm(name)}`;
    let p = places.get(key);
    if (!p) places.set(key, (p = { key, name, system: r.system || '', body: r.body || '', terminals: new Map() }));
    if (!p.body && r.body) p.body = r.body;
    let t = p.terminals.get(r.terminal);
    if (!t) p.terminals.set(r.terminal, (t = { name: r.terminal, buys: [], sells: [] }));
    if (r.buy > 0) t.buys.push({ commodity: r.commodity, price: money(r.buy), scu: r.scuBuy ?? null });
    if (r.sell > 0) t.sells.push({ commodity: r.commodity, price: money(r.sell), scu: r.scuSell ?? null });
  }
  return [...places.values()].map((p) => ({ ...p, terminals: [...p.terminals.values()].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.system.localeCompare(b.system) || a.name.localeCompare(b.name));
}

export const systemsOf = (places) => [...new Set(places.map((p) => p.system).filter(Boolean))].sort();
export const bodiesOf = (places, system) => [...new Set(places.filter((p) => !system || p.system === system).map((p) => p.body).filter(Boolean))].sort();

// A pasted line from the game (or any text): the place or terminal whose name appears in it, longest name first.
// It reads names, not coordinates, so a pasted /showlocation line only helps if it names a known place.
export function findHere(text, places) {
  const t = norm(text); if (t.length < 4) return null;
  let best = null, len = 0;
  for (const p of places) {
    const names = [p.name, ...p.terminals.map((x) => x.name)];
    for (const n of names) { const k = norm(n); if (k.length >= 4 && k.length > len && t.includes(k)) { best = p; len = k.length; } }
  }
  return best;
}

export const tierOf = (p, here) => {
  if (!here) return 2;
  if (p.key === here.key) return 0;
  if (p.system === here.system && p.body && p.body === here.body) return 1;
  return p.system === here.system ? 2 : 3;
};

// mode: 'any' | 'buy' (places where you can buy it) | 'sell' (places that pay you for it).
// q matches a commodity, terminal or place name. Without q, 'buy'/'sell' keep any place with something to buy/sell.
export function rank(places, here, { mode = 'any', q = '', system = '' } = {}) {
  const k = norm(q), out = [];
  for (const p of places) {
    if (system && p.system !== system) continue;
    const hits = [];
    for (const t of p.terminals) {
      const nameHit = k && (norm(t.name).includes(k) || norm(p.name).includes(k));
      if (mode !== 'sell') for (const b of t.buys) if (!k || nameHit || norm(b.commodity).includes(k)) hits.push({ terminal: t.name, commodity: b.commodity, price: b.price, kind: 'buy' });
      if (mode !== 'buy') for (const s of t.sells) if (!k || nameHit || norm(s.commodity).includes(k)) hits.push({ terminal: t.name, commodity: s.commodity, price: s.price, kind: 'sell' });
    }
    if (!hits.length && !(k && (norm(p.name).includes(k) || p.terminals.some((t) => norm(t.name).includes(k))) && mode === 'any')) continue;
    const best = mode === 'sell' ? Math.max(0, ...hits.map((h) => h.price || 0)) : Math.min(Infinity, ...hits.map((h) => h.price || Infinity));
    out.push({ place: p, tier: tierOf(p, here), hits: hits.slice(0, 40), best: Number.isFinite(best) && best > 0 ? best : null });
  }
  return out.sort((a, b) => a.tier - b.tier || (mode === 'sell' ? (b.best || 0) - (a.best || 0) : (a.best ?? Infinity) - (b.best ?? Infinity)) || a.place.name.localeCompare(b.place.name));
}

export const tierCounts = (ranked) => TIERS.map((_, i) => ranked.filter((r) => r.tier === i).length);

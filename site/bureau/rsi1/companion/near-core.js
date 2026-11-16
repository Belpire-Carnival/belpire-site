// Waypoint ("nearest to me") for OmniOps: from the live UEX terminal rows, find where a service or a commodity is,
// ordered by how close it is in the verse's hierarchy: same place, same moon or planet, same system, other systems.
// There are no coordinates in this data, so "close" is a tier, not a distance. Pure functions, no page access.
export const SERVICES = [['refinery', 'Refinery'], ['refuel', 'Refuel'], ['repair', 'Repair'], ['shipbuy', 'Buy ships'], ['shiprent', 'Rent ships'], ['cargo', 'Cargo center'], ['freight', 'Freight elevator'], ['dock', 'Loading dock'], ['medical', 'Medical'], ['food', 'Food and drink'], ['fpsshop', 'Armor and weapons shop'],
  // From the game's own database (worker/sc-locations.json), not from UEX:
  ['hangar', 'Hangars'], ['hangar-s', 'Hangar S'], ['hangar-m', 'Hangar M'], ['hangar-l', 'Hangar L'], ['hangar-xl', 'Hangar XL'],
  ['pad', 'Landing pads'], ['pad-s', 'Pad S'], ['pad-m', 'Pad M'], ['pad-l', 'Pad L'], ['pad-xl', 'Pad XL'],
  ['garage', 'Garage (ASOP)'], ['vehsvc', 'Vehicle services'], ['docking', 'Ship docking'], ['shipitems', 'Ship items and weapons']];
// The filter panel. `has` is how a place qualifies: a service key from the terminal data, or 'trade' (a place with priced goods).
// Entries with no `has` need game-file data this site does not have yet; they are shown, switched off.
export const CATEGORIES = [
  { id: 'trade', label: 'Trade terminals', has: 'trade' }, { id: 'refinery', label: 'Refinery', has: 'refinery' }, { id: 'cargo', label: 'Cargo deck', has: 'cargo' },
  { id: 'freight', label: 'Freight elevators', has: 'freight' }, { id: 'dock', label: 'Loading dock', has: 'dock' }, { id: 'refuel', label: 'Refuel', has: 'refuel' },
  { id: 'repair', label: 'Maintenance', has: 'repair' }, { id: 'medical', label: 'Medical services', has: 'medical' }, { id: 'shopping', label: 'Shopping', has: 'fpsshop' },
  { id: 'food', label: 'Food', has: 'food' }, { id: 'shipbuy', label: 'Ship purchase', has: 'shipbuy' }, { id: 'shiprent', label: 'Ship/vehicle rental', has: 'shiprent' },
  { id: 'vretrieve', label: 'Vehicle services', has: 'vehsvc' }, { id: 'sretrieve', label: 'Ship retrieval (garage)', has: 'garage' }, { id: 'storage', label: 'Storage kiosks' }, { id: 'pads', label: 'Landing pads', has: 'pad' },
  { id: 'hangars', label: 'Hangars', has: 'hangar' }, { id: 'docking', label: 'Ship docking', has: 'docking' },
  { id: 'fines', label: 'Fine and citation kiosk' }, { id: 'security', label: 'Security terminal' }, { id: 'defenses', label: 'Defenses' }, { id: 'habitation', label: 'Habitation' },
  { id: 'harvest', label: 'Harvestables' }, { id: 'loot', label: 'Loot' }, { id: 'minables', label: 'Hand minables' }
];
export const LOCATION_KINDS = ['City', 'Space station', 'Outpost', 'Point of interest', 'Moon or planet'];
export const SERVICE_LABEL = Object.fromEntries(SERVICES);
export const TIERS = ['Here', 'Same moon or planet', 'Same system', 'Other systems'];
export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const money = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

// One entry per place: { key, name, system, body, terminals: [{ name, buys, sells }] }.
// buys = what you can buy there (price you pay); sells = what the terminal pays you for.
export function buildPlaces(rows, services = [], game = []) {
  const places = new Map();
  const at = (system, name, body, kind) => {
    const key = `${norm(system)}|${norm(name)}`;
    let p = places.get(key);
    if (!p) places.set(key, (p = { key, name, system: system || '', body: body || '', kind: kind || '', jur: '', fac: '', terminals: new Map(), svc: new Set() }));
    if (!p.body && body) p.body = body;
    if (!p.kind && kind) p.kind = kind;
    return p;
  };
  for (const s of Array.isArray(services) ? services : []) {
    if (!s || !Array.isArray(s.svc)) continue;
    const name = s.place || s.name; if (!name) continue;
    const p = at(s.system, name, s.body, s.kind);
    for (const k of s.svc) if (SERVICE_LABEL[k]) p.svc.add(k);
    if (s.name && s.name !== name && !p.terminals.has(s.name)) p.terminals.set(s.name, { name: s.name, buys: [], sells: [] });
  }
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.terminal) continue;
    const p = at(r.system, r.place || r.terminal, r.body, r.kind);
    let t = p.terminals.get(r.terminal);
    if (!t) p.terminals.set(r.terminal, (t = { name: r.terminal, buys: [], sells: [] }));
    if (r.buy > 0) t.buys.push({ commodity: r.commodity, price: money(r.buy), scu: r.scuBuy ?? null });
    if (r.sell > 0) t.sells.push({ commodity: r.commodity, price: money(r.sell), scu: r.scuSell ?? null });
  }
  // Game-file places: join an existing place by name (same system), else add one that has no trade terminals.
  const inSystem = (system) => [...places.values()].filter((p) => norm(p.system) === norm(system));
  for (const g of Array.isArray(game) ? game : []) {
    if (!g || !g.n || !Array.isArray(g.svc)) continue;
    const k = norm(g.n); if (!k) continue;
    let p = places.get(norm(g.s) + '|' + k);
    if (!p && k.length >= 6) {
      const near = inSystem(g.s).filter((x) => { const o = norm(x.name); return o.length >= 6 && (o.includes(k) || k.includes(o)); });
      if (near.length === 1) p = near[0];
    }
    if (!p) p = at(g.s, g.n, g.b, g.k);
    if (!p.body && g.b) p.body = g.b;
    if (!p.kind && g.k) p.kind = g.k;
    if (g.j && !p.jur) p.jur = g.j;
    if (g.f && !p.fac) p.fac = g.f;
    for (const s of g.svc) if (SERVICE_LABEL[s]) p.svc.add(s);
  }
  return [...places.values()].map((p) => ({ ...p, terminals: [...p.terminals.values()].sort((a, b) => a.name.localeCompare(b.name)), svc: [...p.svc].sort() }))
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
export const authoritiesOf = (places) => [...new Set(places.flatMap((p) => [p.jur, p.fac]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
export function rank(places, here, { mode = 'any', q = '', system = '', service = '', cats = [], planet = '', kind = '', auth = '' } = {}) {
  const k = norm(q), out = [];
  const need = [...(service ? [service] : []), ...CATEGORIES.filter((c) => cats.includes(c.id) && c.has).map((c) => c.has)];
  for (const p of places) {
    if (system && p.system !== system) continue;
    if (planet && p.body !== planet) continue;
    if (kind && p.kind !== kind) continue;
    if (auth && p.jur !== auth && p.fac !== auth) continue;
    if (need.some((n) => (n === 'trade' ? !p.terminals.some((t) => t.buys.length || t.sells.length) : !(p.svc || []).includes(n)))) continue;
    const hits = [];
    const filtered = need.length > 0 || !!planet || !!kind || !!auth;
    const wantHits = !filtered || k || mode !== 'any';
    for (const t of wantHits ? p.terminals : []) {
      const nameHit = k && (norm(t.name).includes(k) || norm(p.name).includes(k));
      if (mode !== 'sell') for (const b of t.buys) if (!k || nameHit || norm(b.commodity).includes(k)) hits.push({ terminal: t.name, commodity: b.commodity, price: b.price, kind: 'buy' });
      if (mode !== 'buy') for (const s of t.sells) if (!k || nameHit || norm(s.commodity).includes(k)) hits.push({ terminal: t.name, commodity: s.commodity, price: s.price, kind: 'sell' });
    }
    if (!hits.length && !(filtered && !k && mode === 'any') && !(k && (norm(p.name).includes(k) || p.terminals.some((t) => norm(t.name).includes(k))) && mode === 'any')) continue;
    const best = mode === 'sell' ? Math.max(0, ...hits.map((h) => h.price || 0)) : Math.min(Infinity, ...hits.map((h) => h.price || Infinity));
    out.push({ place: p, tier: tierOf(p, here), hits: hits.slice(0, 40), best: Number.isFinite(best) && best > 0 ? best : null });
  }
  return out.sort((a, b) => a.tier - b.tier || (mode === 'sell' ? (b.best || 0) - (a.best || 0) : (a.best ?? Infinity) - (b.best ?? Infinity)) || a.place.name.localeCompare(b.place.name));
}

export const tierCounts = (ranked) => TIERS.map((_, i) => ranked.filter((r) => r.tier === i).length);

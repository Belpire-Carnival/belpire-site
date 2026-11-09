// Typical PvP risk for the places in the Verse, as a rule of thumb. This is NOT live data: nothing in the game or
// the price feeds says who is camping where. It reflects how the places are set up (armistice zones, contested zones,
// lawless systems) and where players commonly ambush haulers. Check the room before you commit a hold.
// On top of the rules, the wiki page for each place is read (/api/sc-zones): a page that says the site is an Armistice Zone
// makes it SAFE, and one that says it is NOT an Armistice Zone raises it to at least Medium.
export const LEVELS = { unknown: { label: 'Unknown', rank: 0 }, safe: { label: 'Safe', rank: 1 }, low: { label: 'Low', rank: 2 }, med: { label: 'Medium', rank: 3 }, high: { label: 'High', rank: 4 } };

// First match wins. The text tested is the terminal, place and system names joined and lower-cased.
const RULES = [
  [/ruin station|checkmate|orbituary|ghost arena/, 'high', 'Contested zone: free-fire PvPvE inside the station, and pirates watch the approach.'],
  [/grim ?hex|\byela\b/, 'high', 'Armistice inside the station, but the approach through Yela is a known pirate and ambush spot.'],
  [/levski|delamar/, 'med', 'Armistice inside Levski. Nyx is outside UEE law, and the approach and the jump gate can be camped.'],
  [/lorville|area ?18|new babbage|orison|everus|seraphim|baijini|tressler|port olisar|\b(?:arc|cru|hur|mic)-l\d/, 'low', 'Armistice zone at the landing zone or station. The risk is on the approach and in quantum travel.'],
  [/gateway|jump point/, 'med', 'Jump gateway: ships arrive and leave in a line here, so it can be camped.']
];
const SYSTEM = {
  stanton: ['med', 'No armistice zone at this kind of place. UEE law applies, but another player can still shoot you.'],
  pyro: ['high', 'Pyro has little UEE law outside a few stations. Pirates and gangs roam the outposts and the lanes between them.'],
  nyx: ['med', 'Nyx is outside UEE law. Outposts and approaches are unpoliced.']
};

const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const ZONES = new Map(); // norm name -> { z: 'armistice' | 'open' | 'unknown', ev }
const asked = new Set();
export const setZones = (obj) => { for (const [k, v] of Object.entries(obj || {})) if (v && typeof v.z === 'string') ZONES.set(k, v); };

// "Admin - Lorville" gives "Admin - Lorville", "Lorville", "Admin": the most specific page that the wiki knows decides.
export function nameCandidates(...names) {
  const out = [];
  for (const n of names) {
    const t = String(n || '').trim();
    if (!t) continue;
    out.push(t, ...t.split(/\s+[-–]\s+/).reverse());
  }
  return [...new Set(out.map((x) => x.trim()).filter((x) => x.length > 2))];
}

function wikiZone(names) {
  for (const c of nameCandidates(...names)) { const z = ZONES.get(norm(c)); if (z && z.z !== 'unknown') return { ...z, name: c }; }
  return null;
}

// Fetch the wiki's armistice status for the places in these market rows (terminal and place). True when something new arrived.
export async function learnZones(rows, { fetcher = fetch, cap = 90 } = {}) {
  const want = [];
  for (const r of rows || []) for (const c of nameCandidates(r.terminal, r.place)) if (!asked.has(norm(c)) && !want.includes(c)) want.push(c);
  const todo = want.slice(0, cap);
  let got = false;
  for (let i = 0; i < todo.length; i += 15) {
    const chunk = todo.slice(i, i + 15);
    for (const c of chunk) asked.add(norm(c));
    try {
      const r = await fetcher(`/api/sc-zones?${chunk.map((c) => `n=${encodeURIComponent(c)}`).join('&')}`, { headers: { Accept: 'application/json' } });
      if (!r.ok) continue;
      const j = await r.json();
      setZones(j.zones); got = got || Object.keys(j.zones || {}).length > 0;
    } catch { /* offline or blocked: the rule-of-thumb level stays */ }
  }
  return got;
}

function base(system, names) {
  const text = [...names, system].filter(Boolean).join(' ').toLowerCase();
  for (const [re, level, note] of RULES) if (re.test(text)) return { level, label: LEVELS[level].label, note };
  const s = SYSTEM[String(system || '').toLowerCase()];
  return s ? { level: s[0], label: LEVELS[s[0]].label, note: s[1] } : { level: 'unknown', label: 'Unknown', note: 'No risk rule for this place.' };
}

export function riskOf(system, ...names) {
  const r = base(system, names), z = wikiZone(names);
  if (!z) return r;
  if (z.z === 'armistice') return { level: 'safe', label: 'Safe', note: `Wiki: ${z.name} is an Armistice Zone, so combat is blocked inside it. The approach and quantum travel are not covered.`, wiki: 'armistice' };
  const level = LEVELS[r.level].rank >= LEVELS.med.rank ? r.level : 'med';
  return { level, label: LEVELS[level].label, note: `Wiki: ${z.name} is not an Armistice Zone, so anyone can shoot you here. ${level === r.level ? r.note : ''}`.trim(), wiki: 'open' };
}
export const worst = (...rs) => rs.reduce((a, b) => (LEVELS[b.level].rank > LEVELS[a.level].rank ? b : a), rs[0] || riskOf(''));

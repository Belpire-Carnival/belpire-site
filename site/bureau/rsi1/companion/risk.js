// Typical PvP risk for the places in the Verse, as a rule of thumb. This is NOT live data: nothing in the game or
// the price feeds says who is camping where. It reflects how the places are set up (armistice zones, contested zones,
// lawless systems) and where players commonly ambush haulers. Check the room before you commit a hold.
export const LEVELS = { unknown: { label: 'Unknown', rank: 0 }, low: { label: 'Low', rank: 1 }, med: { label: 'Medium', rank: 2 }, high: { label: 'High', rank: 3 } };

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

export function riskOf(system, ...names) {
  const text = [...names, system].filter(Boolean).join(' ').toLowerCase();
  for (const [re, level, note] of RULES) if (re.test(text)) return { level, label: LEVELS[level].label, note };
  const s = SYSTEM[String(system || '').toLowerCase()];
  return s ? { level: s[0], label: LEVELS[s[0]].label, note: s[1] } : { level: 'unknown', label: 'Unknown', note: 'No risk rule for this place.' };
}
export const worst = (...rs) => rs.reduce((a, b) => (LEVELS[b.level].rank > LEVELS[a.level].rank ? b : a), rs[0] || riskOf(''));

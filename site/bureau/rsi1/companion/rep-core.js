// Reputation ranks (pure, no DOM): the rank you have on each reputation ladder, kept as { ladderId: { rank, at } } under
// "arsenal.rep.ranks" (saved with your profile) and shared both ways with OmniGlass Desktop. Ladders come from the same game
// data the desktop app uses (/api/companion/data?name=factions). The newer choice always wins; an empty rank means "not set".

const ID = /^[A-Za-z0-9_.|-]{1,120}$/;
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
export const MAX_RANKS = 200;

export function cleanRanks(raw) {
  const out = {};
  for (const [id, v] of Object.entries(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}).slice(0, MAX_RANKS)) {
    if (!ID.test(id) || !v || typeof v !== 'object') continue;
    out[id] = { rank: typeof v.rank === 'string' ? clip(v.rank, 60) : '', at: Number.isFinite(v.at) ? v.at : 0 };
  }
  return out;
}

/** The newer of what is kept and (rank, at) for one ladder. Returns a new object. */
export function mergeRank(ranks, id, rank, at) {
  const out = cleanRanks(ranks);
  if (!ID.test(String(id || '')) || typeof rank !== 'string' || !Number.isFinite(at)) return out;
  const cur = out[id];
  if (!cur || at > cur.at) out[id] = { rank: clip(rank, 60), at };
  return out;
}
export const setRank = (ranks, id, rank, now = Date.now()) => mergeRank(ranks, id, rank, Math.max(now, (cleanRanks(ranks)[id]?.at || 0) + 1));

/** Ladders from the factions data file: id, faction, scope, standings (lowest first). Junk gives []. */
export function parseLadders(j) {
  const out = [];
  for (const l of Array.isArray(j && j.ladders) ? j.ladders : []) {
    if (!l || !ID.test(String(l.id || '')) || !Array.isArray(l.standings)) continue;
    const standings = l.standings.filter((s) => s && typeof s.name === 'string').map((s) => ({ name: clip(s.name, 60), min: Number.isFinite(s.min) ? s.min : 0 })).sort((a, b) => a.min - b.min);
    if (standings.length) out.push({ id: l.id, faction: clip(l.faction, 80) || l.id, scope: clip(l.scope, 80), standings });
  }
  return out.sort((a, b) => a.faction.localeCompare(b.faction) || a.scope.localeCompare(b.scope));
}

/** Ladders to show: matching the search words, the ones you have set first. Each with your rank and the next one up. */
export function ladderView(ladders, ranks, q = '') {
  const r = cleanRanks(ranks), words = clip(q, 60).toLowerCase().split(' ').filter(Boolean);
  return (Array.isArray(ladders) ? ladders : [])
    .filter((l) => words.every((w) => `${l.faction} ${l.scope}`.toLowerCase().includes(w)))
    .map((l) => {
      const rank = r[l.id] && l.standings.some((s) => s.name === r[l.id].rank) ? r[l.id].rank : '';
      const i = l.standings.findIndex((s) => s.name === rank);
      return { ...l, rank, next: i >= 0 ? l.standings[i + 1]?.name || '' : '' };
    })
    .sort((a, b) => Number(!a.rank) - Number(!b.rank));
}
export const countSet = (ladders, ranks) => ladderView(ladders, ranks).filter((l) => l.rank).length;

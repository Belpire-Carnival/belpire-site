// Game search for the Midway: one index over tracked games (patch notes) and upcoming games.
// Pure functions, tested in worker/test/search.test.mjs.

export const normalize = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// feed: { tracked: [{appid, name, tent}], favorites: [news...], upcoming: [games...] }
export function buildIndex(feed) {
  const byKey = new Map();
  const add = (item, source) => {
    const appid = Number(item.appid) || null;
    const name = String(item.name || '').trim();
    if (!name) return;
    const key = appid ? `app-${appid}` : `name-${normalize(name)}`;
    if (!byKey.has(key)) byKey.set(key, { key, appid, name, tent: item.tent || 'other', sources: new Set(), norm: normalize(name) });
    byKey.get(key).sources.add(source);
  };
  for (const t of feed?.tracked || []) add(t, 'tracked');
  for (const n of feed?.favorites || []) add(n, 'news');
  for (const u of feed?.upcoming || []) add(u, 'upcoming');
  return [...byKey.values()];
}

// Every typed word must start a word in the name ("div 2" finds "The Division 2").
// Names that start with the query rank first, then shorter names.
export function suggest(index, query, limit = 8) {
  const q = normalize(query);
  if (!q) return [];
  const tokens = q.split(' ');
  const scored = [];
  for (const entry of index) {
    const words = entry.norm.split(' ');
    const all = tokens.every((t) => words.some((w) => w.startsWith(t)));
    if (!all) continue;
    let score = 0;
    if (entry.norm.startsWith(q)) score += 100;
    if (entry.norm === q) score += 50;
    if (entry.sources.has('news')) score += 5; // has fresh patch notes
    score -= entry.norm.length / 100;
    scored.push({ entry, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map((s) => s.entry);
}

// Does a feed item belong to the current search? Selected game = exact app match; free text = suggest() hit.
export function matchesSearch(item, search) {
  if (!search) return true;
  if (search.appid) return Number(item.appid) === search.appid;
  const words = normalize(item.name).split(' ');
  return normalize(search.text)
    .split(' ')
    .filter(Boolean)
    .every((t) => words.some((w) => w.startsWith(t)));
}

export function sourceLabel(entry) {
  const parts = [];
  if (entry.sources.has('news')) parts.push('Patch notes');
  else if (entry.sources.has('tracked')) parts.push('Tracked');
  if (entry.sources.has('upcoming')) parts.push('Coming soon');
  return parts.join(' · ');
}

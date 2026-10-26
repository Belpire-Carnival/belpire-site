// Pure game-picker logic for the Jackbox page (also used by worker/test/jackbox.test.mjs).

// Every game in the collection, flattened, with the box it came from.
export function allGames(packs) {
  const out = [];
  for (const pack of packs || []) {
    for (const g of pack.games || []) out.push({ ...g, pack: pack.short || pack.name, packName: pack.name, appid: pack.appid, year: pack.year });
  }
  return out;
}

// Games that seat exactly this many players (audience doesn't count), filtered by style and box age.
export function fitting(games, { players, style = 'all', newerOnly = false }) {
  return games.filter((g) =>
    players >= g.min && players <= g.max &&
    (style === 'all' || g.style === style) &&
    (!newerOnly || g.year >= 2020)
  );
}

// Pick one at random; never repeat the previous pick when there's another option.
export function pickOne(list, previousName, random = Math.random) {
  if (!list.length) return null;
  const pool = list.length > 1 ? list.filter((g) => g.name !== previousName) : list;
  return pool[Math.floor(random() * pool.length)];
}

export const playerLabel = (g) => (g.min === g.max ? `${g.min}` : `${g.min}–${g.max}`) + (g.max === 1 ? ' player' : ' players');

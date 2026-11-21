// The Midway: 25 carnival booths, 4 to 6 open each week (site/midway/rotation.js), every outcome rolled here with
// crypto randomness. The page (and, later, its 3D stage) only plays out the result it is sent; nothing the browser
// reports about aim or physics ever decides a payout. Winnings go into the one Sliver bank (ticket-db.js) with a
// unique ledger ref, and each play is also a row in midway_plays (unique per member, booth, Eastern day and play).
//
//   GET  /api/midway/state           members: today's date, next reset, the week's rotation, balance, every booth
//   POST /api/midway/play/:gameId    members  { choice? } → 403 closed this week, 429 out of plays today

import { readSession } from './auth.js';
import { memberInfo, pollConfig } from './polls.js';
import { ticketStore } from './ticket-db.js';
import { ALL_GAME_IDS, getWeeklyLineup, getEasternDateKey, easternMidnightIso } from '../site/midway/rotation.js';

// Each booth: plays per day and its outcome tiers, lowest to highest, as [key, label, weight, Slivers].
// Weights are chances in 1000 (Find the Pea's are in thirds). The last tier is the top tier.
// `sweep`: on the day's 3rd play, if all 3 plays today hit the top tier, +SWEEP_BONUS.
// `choice`: what the member picks first. `options` are fixed answers; `range` is a whole number between two values.
//   `required` false = the pick only changes the show, never the odds.
export const SWEEP_BONUS = 50;
export const GAMES = {
  'find-the-pea': {
    name: 'Find the Pea', plays: 5, group: 'core',
    choice: { label: 'Pick a shell', options: ['1', '2', '3'], required: true },
    tiers: [['miss', 'Miss', 2, 0], ['found', 'Found the pea', 1, 12]],
    blurb: 'Three walnut-and-brass shells, one golden pea. Pick the shell you think hides it.',
    closed: 'The barker\'s out back polishing the shells. Check back another week.'
  },
  'ring-toss': {
    name: 'Ring Toss', plays: 5, group: 'core',
    choice: { label: 'Pick a row', options: ['front', 'middle', 'back'], required: true },
    rows: {
      front: [['miss', 'Bounced off', 400, 0], ['ringer', 'Ringer, front row', 600, 6]],
      middle: [['miss', 'Bounced off', 700, 0], ['ringer', 'Ringer, middle row', 300, 15]],
      back: [['miss', 'Bounced off', 900, 0], ['ringer', 'Ringer, back row', 100, 50]]
    },
    blurb: 'Emerald bottles up front, amber in the middle, ruby at the back. Nearer is easier; farther pays more.',
    closed: 'Restocking the back-row bottles. Booth\'s shuttered for now.'
  },
  'high-striker': {
    name: 'High Striker', plays: 3, group: 'core',
    tiers: [['wimp', 'Wimp (1–3)', 350, 0], ['not-bad', 'Not bad (4–6)', 350, 5], ['strongman', 'Strongman (7–9)', 250, 12], ['bell', 'DING! Rang the bell', 50, 40]],
    blurb: 'Swing the mallet and send the puck up the rail. Ring the bell at 10 for the jackpot.',
    closed: 'Bell\'s cracked—waiting on a new striker plate.'
  },
  'shooting-gallery': {
    name: 'Shooting Gallery', plays: 5, group: 'aim',
    tiers: [['miss', 'Ricochet', 500, 0], ['tin-duck', 'Tin duck', 300, 4], ['bullseye', 'Bullseye', 150, 8], ['golden-duck', 'Golden duck', 50, 40]],
    blurb: 'Tin ducks on a moving track and spinning brass bullseyes. One cork per shot.',
    closed: 'Rifles are being oiled and the tin ducks repainted.'
  },
  'milk-bottle-knockdown': {
    name: 'Milk Bottle Knockdown', plays: 4, group: 'aim',
    tiers: [['zero-one', '0–1 bottles down', 450, 0], ['two-three', '2–3 bottles down', 350, 4], ['four-five', '4–5 bottles down', 150, 10], ['all-six', 'All 6 down', 50, 50]],
    blurb: 'A pyramid of six weighted milk bottles and one stitched baseball.',
    closed: 'Still picking dented bottles out of the sawdust.'
  },
  'balloon-darts': {
    name: 'Balloon Darts', plays: 5, group: 'aim',
    tiers: [['dud', 'Dud', 550, 0], ['small', 'Small balloon', 250, 4], ['large', 'Large balloon', 150, 10], ['star', 'Gold star', 50, 40]],
    blurb: 'A swaying corkboard of balloons and gold stars. Brass-feathered darts.',
    closed: 'Out of helium and short on sharp darts.'
  },
  'skee-ball': {
    name: 'Skee-Ball', plays: 5, group: 'aim',
    tiers: [['ten', '10 points', 400, 2], ['thirty', '30 points', 350, 4], ['fifty', '50 points', 200, 8], ['corner', '100 corner', 50, 20]],
    blurb: 'Roll the wooden ball up the ramp and into the rings. Every roll pays something.',
    closed: 'Ball return\'s jammed. Mechanic\'s crawling under the lane.'
  },
  'dunk-tank': {
    name: 'Dunk Tank', plays: 3, group: 'aim', sweep: true,
    tiers: [['miss', 'Miss', 450, 0], ['clank', 'Clank', 300, 5], ['graze', 'Graze', 200, 14], ['dunk', 'Direct dunk', 50, 50]],
    blurb: 'A jester dummy over dark water and a hinged bullseye. He heckles. Dunk him three times in a day for a bonus.',
    closed: 'Tank\'s being drained. Heckler has the night off.'
  },
  'water-gun-race': {
    name: 'Water Gun Race', plays: 3, group: 'aim',
    tiers: [['fourth', '4th place', 250, 0], ['third', '3rd place', 250, 4], ['second', '2nd place', 250, 8], ['first', '1st place', 250, 16]],
    blurb: 'Four brass water pistols, four clown mouths, four balloons. First to pop wins.',
    closed: 'Hose line sprung a leak—counter\'s flooded.'
  },
  'goldfish-bowl-toss': {
    name: 'Goldfish Bowl Toss', plays: 5, group: 'aim',
    tiers: [['rim', 'Rim bounce', 750, 0], ['regular', 'Regular bowl', 200, 12], ['golden', 'Golden bowl', 50, 40]],
    blurb: 'A table crowded with glass bowls and one gilded one in the middle. Ping-pong ball in, prize out.',
    closed: 'Changing the water. Come back next rotation.'
  },
  'rigged-hoop': {
    name: 'Rigged Hoop', plays: 4, group: 'aim',
    tiers: [['brick', 'Brick', 500, 0], ['rim-out', 'Rim-out', 300, 4], ['swish', 'Swish', 150, 12], ['bank', 'Bank shot', 50, 50]],
    blurb: 'A slightly oval iron rim on a striped backboard. It\'s not your imagination.',
    closed: 'Barker\'s bending the rim back into an oval.'
  },
  'knife-thrower': {
    name: 'Knife Thrower', plays: 3, group: 'reflex', sweep: true,
    tiers: [['bust', 'Bust', 350, 0], ['edge', 'Edge', 400, 4], ['shave', 'Shave', 200, 14], ['apple', 'Split the apple', 50, 50]],
    blurb: 'The Wheel of Death turns slowly, a red apple at the crown. Split it three times in a day for a bonus.',
    closed: 'Sharpening the blades. Volunteer called in sick.'
  },
  'whac-a-mole': {
    name: 'Whac-A-Mole', plays: 3, group: 'reflex',
    tiers: [['slow', 'Slow', 300, 2], ['decent', 'Decent', 400, 6], ['fast', 'Fast', 250, 12], ['golden', 'Golden mole', 50, 24]],
    blurb: 'Nine clockwork moles, four seconds, one padded mallet. Every round pays something.',
    closed: 'Clockwork springs snapped. Cabinet\'s propped open.'
  },
  'claw-machine': {
    name: 'Claw Machine', plays: 3, group: 'reflex', sweep: true,
    tiers: [['slip', 'Slipped', 500, 0], ['small', 'Small plush', 250, 6], ['big', 'Big plush', 200, 14], ['relic', 'The gold relic', 50, 50]],
    blurb: 'A brass crane over a pile of plushies and one glowing relic. Grab it three times in a day for a bonus.',
    closed: 'Out of order. Claw\'s jammed halfway down the chute.'
  },
  'buzz-wire': {
    name: 'Buzz Wire', plays: 4, group: 'reflex',
    tiers: [['early', 'Early buzz', 400, 0], ['halfway', 'Halfway', 350, 5], ['almost', 'Almost', 150, 12], ['clean', 'Clean run', 100, 20]],
    blurb: 'Guide the brass wand along the twisted copper wire without touching it.',
    closed: 'Blew a fuse. Still smells like burnt copper.'
  },
  'frog-bog': {
    name: 'Frog Bog', plays: 5, group: 'reflex',
    tiers: [['splash', 'Splash', 450, 0], ['outer', 'Outer pad', 350, 5], ['inner', 'Inner pad', 150, 12], ['crown', 'Crown pad', 50, 25]],
    blurb: 'Strike the springboard and land a rubber frog on a turning lily pad.',
    closed: 'Frogs escaped into the midway. Rounding them up.'
  },
  'rope-ladder-climb': {
    name: 'Rope Ladder Climb', plays: 2, group: 'reflex',
    tiers: [['flipped', 'Flipped off', 450, 0], ['mid', 'Mid-rung', 300, 6], ['near-top', 'Near the top', 200, 18], ['top', 'Rang the top bell', 50, 100]],
    blurb: 'A swivel rope ladder over a padded pit. Climb as far as it lets you.',
    closed: 'Swivel hook\'s frayed. Too risky even for us.'
  },
  plinko: {
    name: 'Plinko', plays: 4, group: 'luck',
    choice: { label: 'Pick a drop lane', options: ['1', '2', '3', '4', '5'], required: false },
    tiers: [['slot-0', 'Slot 0', 450, 0], ['slot-4', 'Slot 4', 350, 4], ['slot-10', 'Slot 10', 150, 10], ['slot-50', 'Slot 50', 50, 50]],
    blurb: 'A brass token clatters down a pegged board into one of the lit slots.',
    closed: 'Half the brass pegs came loose. Board\'s in the shop.'
  },
  'big-six': {
    name: 'Big Six', plays: 1, group: 'luck',
    tiers: [['five', '5', 500, 5], ['fifteen', '15', 300, 15], ['twenty', '20', 150, 20], ['jackpot', 'Jackpot', 50, 200]],
    blurb: 'One spin a day of the great Victorian prize wheel. Every wedge pays.',
    closed: 'Wheel bearing\'s squealing. Needs a fresh coat of grease.'
  },
  'duck-pond': {
    name: 'Duck Pond', plays: 4, group: 'luck',
    choice: { label: 'Pick a duck', options: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'], required: false },
    tiers: [['blank', 'Blank', 300, 0], ['red-dot', 'Red dot', 450, 5], ['silver-star', 'Silver star', 200, 10], ['gold-crown', 'Gold crown', 50, 25]],
    blurb: 'Twelve rubber ducks bob along the current. Scoop one and flip it over.',
    closed: 'Pump\'s clogged with confetti. Pond\'s still.'
  },
  'derby-race': {
    name: 'Derby Race', plays: 3, group: 'luck',
    choice: { label: 'Pick a horse', options: ['1', '2', '3', '4'], required: true },
    tiers: [['loss', 'Lost', 750, 0], ['win', 'Your horse won', 250, 28]],
    blurb: 'Four clockwork horses, one brass track, a four-second photo finish.',
    closed: 'Track gears are stripped. Horses are in the stable.'
  },
  'coin-pusher': {
    name: 'Coin Pusher', plays: 5, group: 'luck',
    choice: { label: 'Pick a drop slot', options: ['1', '2', '3'], required: false },
    tiers: [['no-drop', 'No drop', 500, 0], ['trickle', 'Trickle', 350, 5], ['cascade', 'Cascade', 120, 15], ['avalanche', 'Avalanche', 30, 35]],
    blurb: 'Drop a Sliver coin onto the moving brass shelf and watch the edge.',
    closed: 'Cabinet\'s tilted—attendant\'s resetting the tray.'
  },
  'guess-the-jar': {
    name: 'Guess the Jar', plays: 1, group: 'sideshow',
    choice: { label: 'How many tokens are in the jar?', range: [100, 500], required: true },
    tiers: [['off', 'Off by 21 or more', 500, 5], ['within-20', 'Within 20', 300, 15], ['within-5', 'Within 5', 150, 20], ['exact', 'Exact', 50, 200]],
    blurb: 'An apothecary jar stuffed with brass tokens. One guess a day, from 100 to 500. Every guess pays.',
    closed: 'Someone knocked the jar over. Counting every piece again.'
  },
  'test-your-grip': {
    name: 'Test Your Grip', plays: 2, group: 'sideshow',
    tiers: [['cold-fish', 'Cold fish', 450, 0], ['firm', 'Firm', 300, 6], ['crusher', 'Crusher', 200, 18], ['shattered', 'Shattered the dial', 50, 100]],
    blurb: 'Squeeze the twin iron handles and watch the needle climb.',
    closed: 'Dial glass shattered last night. Waiting on a replacement.'
  },
  'hall-of-mirrors': {
    name: 'Hall of Mirrors', plays: 3, group: 'sideshow',
    choice: { label: 'Pick a mirror', options: ['1', '2', '3', '4'], required: true },
    tiers: [['wrong', 'Bonk. Wrong mirror', 750, 0], ['exit', 'The real exit', 250, 28]],
    blurb: 'Four gilded mirrors in a dark octagon. One is a doorway.',
    closed: 'Glass cleaner\'s still drying. Try not to walk into the walls.'
  }
};

// The three booths that came before the Midway kept their plays in the ledger only, under these ref prefixes.
// On the day the Midway opens, plays made under the old names still count toward today's limit.
const LEGACY_REFS = { 'find-the-pea': 'shell', 'ring-toss': 'rings', 'high-striker': 'striker' };

const tiersOf = (g, choice) => (g.rows ? g.rows[choice] || g.rows.front : g.tiers);

// Average and most per day, straight from the tiers (Ring Toss: the best row). The page shows these with the odds.
export function economy(id) {
  const g = GAMES[id];
  const sets = g.rows ? Object.values(g.rows) : [g.tiers];
  const avg = (tiers) => {
    const total = tiers.reduce((s, t) => s + t[2], 0);
    return tiers.reduce((s, t) => s + (t[2] / total) * t[3], 0);
  };
  const best = Math.max(...sets.map(avg));
  const top = Math.max(...sets.map((t) => t.at(-1)[3]));
  return { avgPerPlay: Math.round(best * 100) / 100, avgPerDay: Math.round(best * g.plays * 100) / 100, maxPerDay: top * g.plays + (g.sweep ? SWEEP_BONUS : 0) };
}

export function oddsOf(id) {
  const g = GAMES[id];
  const show = (tiers) => {
    const total = tiers.reduce((s, t) => s + t[2], 0);
    return tiers.map(([tier, label, w, pay]) => ({ tier, label, chance: Math.round((1000 * w) / total) / 10, pay }));
  };
  return g.rows ? Object.fromEntries(Object.entries(g.rows).map(([row, t]) => [row, show(t)])) : show(g.tiers);
}

// Unbiased whole number in [0, n), from crypto.getRandomValues.
export function randomBelow(n) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}

// Picks a tier by weight. `rand(n)` is injectable for tests.
export function rollTier(tiers, rand = randomBelow) {
  const total = tiers.reduce((s, t) => s + t[2], 0);
  let r = rand(total);
  for (const t of tiers) {
    if (r < t[2]) return t;
    r -= t[2];
  }
  return tiers.at(-1);
}

export class MidwayError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// The member's pick, cleaned and checked. Returns the string stored on the play (or null).
export function cleanChoice(id, raw) {
  const c = GAMES[id].choice;
  if (!c) return null;
  const value = raw === undefined || raw === null || raw === '' ? null : String(raw).trim().toLowerCase();
  if (value === null) {
    if (c.required) throw new MidwayError(400, 'choice', `${c.label} first.`);
    return null;
  }
  if (c.options) {
    if (!c.options.includes(value)) throw new MidwayError(400, 'choice', `${c.label}: ${c.options.join(', ')}.`);
    return value;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < c.range[0] || n > c.range[1]) throw new MidwayError(400, 'choice', `Guess a whole number from ${c.range[0]} to ${c.range[1]}.`);
  return String(n);
}

const others = (n, not) => Array.from({ length: n }, (_, i) => i + 1).filter((x) => x !== not);
const pickOf = (arr, rand) => arr[rand(arr.length)];
function orderWith(first, rand) {
  const rest = others(4, first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [first, ...rest];
}
const between = (lo, hi, rand) => lo + rand(hi - lo + 1);

// What the stage needs to land on the server's result. Pure apart from `rand`.
export function visualParamsFor(id, tier, choice, rand = randomBelow) {
  const k = tier[0];
  switch (id) {
    case 'find-the-pea': {
      const pick = Number(choice) - 1;
      return { pick, pea: k === 'found' ? pick : pickOf(others(3, pick + 1), rand) - 1 };
    }
    case 'ring-toss': return { row: choice, bottle: rand(4) };
    case 'high-striker': {
      const h = { wimp: [1, 3], 'not-bad': [4, 6], strongman: [7, 9], bell: [10, 10] }[k];
      return { height: between(h[0], h[1], rand) };
    }
    case 'milk-bottle-knockdown': {
      const h = { 'zero-one': [0, 1], 'two-three': [2, 3], 'four-five': [4, 5], 'all-six': [6, 6] }[k];
      return { knocked: between(h[0], h[1], rand) };
    }
    case 'skee-ball': return { points: { ten: 10, thirty: 30, fifty: 50, corner: 100 }[k] };
    case 'water-gun-race': {
      const place = { first: 1, second: 2, third: 3, fourth: 4 }[k];
      return { lane: 1 + rand(4), place };
    }
    case 'whac-a-mole': {
      const h = { slow: [4, 8], decent: [9, 13], fast: [14, 18], golden: [19, 22] }[k];
      return { hits: between(h[0], h[1], rand), golden: k === 'golden' };
    }
    case 'rope-ladder-climb': {
      const h = { flipped: [1, 3], mid: [4, 6], 'near-top': [7, 9], top: [10, 10] }[k];
      return { rung: between(h[0], h[1], rand) };
    }
    case 'plinko': return { lane: choice ? Number(choice) : 1 + rand(5), slot: { 'slot-0': 0, 'slot-4': 4, 'slot-10': 10, 'slot-50': 50 }[k] };
    case 'big-six': return { wedge: tier[3] };
    case 'duck-pond': return { duck: choice ? Number(choice) : 1 + rand(12), mark: k };
    case 'coin-pusher': return { slot: choice ? Number(choice) : 1 + rand(3) };
    case 'derby-race': {
      const lane = Number(choice);
      const winner = k === 'win' ? lane : pickOf(others(4, lane), rand);
      return { lane, winner, order: orderWith(winner, rand) };
    }
    case 'hall-of-mirrors': {
      const mirror = Number(choice);
      return { mirror, exit: k === 'exit' ? mirror : pickOf(others(4, mirror), rand) };
    }
    case 'guess-the-jar': {
      const guess = Number(choice);
      const off = { exact: [0, 0], 'within-5': [1, 5], 'within-20': [6, 20], off: [21, 150] }[k];
      const d = between(off[0], off[1], rand);
      const up = guess - d < 50 ? true : guess + d > 650 ? false : rand(2) === 0;
      return { guess, actual: up ? guess + d : guess - d };
    }
    default: return {};
  }
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS midway_plays (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    game_id TEXT NOT NULL,
    eastern_date TEXT NOT NULL,
    play_index INTEGER NOT NULL,
    choice TEXT,
    outcome_tier TEXT NOT NULL,
    base_payout INTEGER NOT NULL,
    sweep_bonus INTEGER NOT NULL DEFAULT 0,
    total_payout INTEGER NOT NULL,
    visual_seed INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, game_id, eastern_date, play_index)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_midway_user_day ON midway_plays(user_id, eastern_date, game_id)'
];
const ready = new WeakMap();
async function ensure(db) {
  if (!ready.has(db)) ready.set(db, (async () => { for (const sql of SCHEMA) await db.prepare(sql).run(); })());
  try {
    await ready.get(db);
  } catch (err) {
    ready.delete(db);
    throw err;
  }
}

export function midwayStore(db) {
  return {
    async today(uid, day) {
      await ensure(db);
      return (await db.prepare('SELECT game_id, play_index, outcome_tier FROM midway_plays WHERE user_id = ? AND eastern_date = ? ORDER BY play_index').bind(uid, day).all()).results;
    },
    async insert(row) {
      await ensure(db);
      const r = await db.prepare(`INSERT OR IGNORE INTO midway_plays (id, user_id, game_id, eastern_date, play_index, choice, outcome_tier, base_payout, sweep_bonus, total_payout, visual_seed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(row.id, row.user_id, row.game_id, row.eastern_date, row.play_index, row.choice, row.outcome_tier, row.base_payout, row.sweep_bonus, row.total_payout, row.visual_seed).run();
      return Boolean(r.meta.changes);
    },
    async remove(id) {
      await db.prepare('DELETE FROM midway_plays WHERE id = ?').bind(id).run();
    },
    async purgeBefore(day) {
      await ensure(db);
      await db.prepare('DELETE FROM midway_plays WHERE eastern_date < ?').bind(day).run();
    }
  };
}

// Today's plays per booth, counting old ledger plays for the three booths that came before.
async function usedToday(env, uid, day) {
  const rows = await midwayStore(env.DB).today(uid, day);
  const used = Object.fromEntries(ALL_GAME_IDS.map((id) => [id, 0]));
  const tiers = {};
  for (const r of rows) {
    used[r.game_id] = Math.max(used[r.game_id], r.play_index);
    (tiers[r.game_id] ||= []).push(r.outcome_tier);
  }
  const bank = ticketStore(env.DB);
  for (const [id, prefix] of Object.entries(LEGACY_REFS)) used[id] += await bank.countRefs(`${prefix}:${uid}:${day}:`);
  return { used, tiers };
}

// Where "now" and the dice come from. Tests move the clock to a week when the booth they play is open, and can load
// the dice; in production they are always the real time and crypto.getRandomValues.
export const clock = { now: () => Date.now(), rand: (n) => randomBelow(n) };

const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function play(env, uid, name, gameId, rawChoice, now = clock.now()) {
  const g = Object.hasOwn(GAMES, gameId) ? GAMES[gameId] : null;
  if (!g) throw new MidwayError(404, 'no_game', 'There\'s no booth by that name on the Midway.');
  const lineup = getWeeklyLineup(new Date(now));
  if (!lineup.activeGames.includes(gameId)) {
    throw new MidwayError(403, 'closed', `${g.closed} ${g.name} is shuttered this week; the Midway turns over Monday at midnight Eastern.`);
  }
  const choice = cleanChoice(gameId, rawChoice);
  const day = getEasternDateKey(new Date(now));
  const { used, tiers: earlier } = await usedToday(env, uid, day);
  if (used[gameId] >= g.plays) {
    throw new MidwayError(429, 'no_plays', `That's all ${g.plays} ${g.plays === 1 ? 'play' : 'plays'} of ${g.name} for today. The booth reopens at midnight Eastern.`);
  }
  const playIndex = used[gameId] + 1;
  const table = tiersOf(g, choice);
  const tier = rollTier(table, clock.rand);
  const top = table.at(-1)[0];
  const sweep = g.sweep && playIndex === 3 && tier[0] === top && (earlier[gameId] || []).length === 2 && earlier[gameId].every((t) => t === top) ? SWEEP_BONUS : 0;
  const total = tier[3] + sweep;
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;
  const row = {
    id: hex(12), user_id: uid, game_id: gameId, eastern_date: day, play_index: playIndex, choice,
    outcome_tier: tier[0], base_payout: tier[3], sweep_bonus: sweep, total_payout: total, visual_seed: seed
  };
  if (!(await midwayStore(env.DB).insert(row))) throw new MidwayError(409, 'busy', 'One play at a time. Try again.');
  const note = total ? `${g.name}: ${tier[1]}${sweep ? ` + sweep bonus` : ''}` : g.name;
  const balance = await ticketStore(env.DB).change(uid, name, total, 'game', { note, ref: `midway:${gameId}:${uid}:${day}:${playIndex}` });
  if (balance === null) {
    await midwayStore(env.DB).remove(row.id);
    throw new MidwayError(409, 'busy', 'One play at a time. Try again.');
  }
  return {
    gameId, outcomeTier: tier[0], label: tier[1], basePayout: tier[3], sweepBonus: sweep, totalPayout: total, newBalance: balance,
    playIndex, playsUsed: playIndex, playsMax: g.plays, choice,
    visualParams: { seed, ...visualParamsFor(gameId, tier, choice, clock.rand) },
    // the names the Ticket Booth and slash commands already used
    amount: total, balance, playsLeft: g.plays - playIndex
  };
}

const dayAfter = (key) => new Date(Date.parse(`${key}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export async function midwayState(env, uid, now = clock.now()) {
  const lineup = getWeeklyLineup(new Date(now));
  const day = lineup.easternKey;
  const [{ used }, wallet] = await Promise.all([usedToday(env, uid, day), ticketStore(env.DB).wallet(uid)]);
  const open = new Set(lineup.activeGames);
  return {
    easternDate: day,
    nextResetIso: easternMidnightIso(dayAfter(day)),
    rotation: {
      week: lineup.weekInCycle + 1, of: 5, booths: lineup.activeGames.length,
      activeGames: lineup.activeGames, nextRotationDateKey: lineup.nextRotationDateKey, nextRotationIso: easternMidnightIso(lineup.nextRotationDateKey)
    },
    balance: Number(wallet?.balance || 0),
    games: ALL_GAME_IDS.map((id) => {
      const g = GAMES[id];
      return {
        id, name: g.name, group: g.group, blurb: g.blurb, closedCopy: g.closed,
        isOpen: open.has(id), playsUsed: Math.min(used[id], g.plays), playsMax: g.plays,
        choice: g.choice || null, sweep: Boolean(g.sweep), odds: oddsOf(id), ...economy(id)
      };
    })
  };
}

// Play rows are kept 30 days (the Sliver ledger keeps what each play paid).
export async function purgeOldPlays(env, now = Date.now()) {
  if (!env.DB) return;
  await midwayStore(env.DB).purgeBefore(getEasternDateKey(new Date(now - 30 * 86_400_000)));
}

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const fail = (status, error, message) => json({ error, message }, status);

export async function handleMidway(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/\/+$/, '').split('/').slice(3); // after /api/midway
  if (!env.DB || !pollConfig(env).ok) return fail(503, 'unavailable', 'The Midway is being set up.');
  const session = await readSession(request, env);
  if (!session) return fail(401, 'signed_out', 'Sign in with Discord first.');
  try {
    if (request.method === 'GET' && parts.length === 1 && parts[0] === 'state') {
      const who = await memberInfo(env, session);
      if (!who.member) return fail(403, 'not_member', 'The Midway is for members of the Belpire Discord.');
      return json(await midwayState(env, session.uid));
    }
    if (request.method === 'POST' && parts.length === 2 && parts[0] === 'play') {
      if (request.headers.get('Origin') !== url.origin || !(request.headers.get('Content-Type') || '').startsWith('application/json')) {
        return fail(403, 'forbidden', 'Use the buttons on belpire.com.');
      }
      const who = await memberInfo(env, session);
      if (!who.member) return fail(403, 'not_member', 'The Midway is for members of the Belpire Discord.');
      const body = await request.json().catch(() => ({}));
      return json({ ok: true, ...(await play(env, session.uid, who.name, parts[1], body?.choice)) });
    }
    return fail(404, 'not_found', 'Not found.');
  } catch (err) {
    if (err instanceof MidwayError) return fail(err.status, err.code, err.message);
    throw err;
  }
}

// The Midway's weekly rotation, run identically on the server (worker/midway.js imports this file) and in the page.
// All 25 booths are shuffled into a 5-week deck anchored to Monday 00:00 America/New_York; each week of the cycle opens
// 4, 5, 5, 5 or 6 of them (the split is shuffled too), so every booth opens exactly once per 5 weeks.
// Deterministic on purpose: anyone can work out any week's lineup, and nothing about it is secret or random per person.

export const ALL_GAME_IDS = [
  'find-the-pea', 'ring-toss', 'high-striker', 'shooting-gallery',
  'milk-bottle-knockdown', 'balloon-darts', 'skee-ball', 'dunk-tank',
  'water-gun-race', 'goldfish-bowl-toss', 'rigged-hoop', 'knife-thrower',
  'whac-a-mole', 'claw-machine', 'buzz-wire', 'frog-bog',
  'rope-ladder-climb', 'plinko', 'big-six', 'duck-pond',
  'derby-race', 'coin-pusher', 'guess-the-jar', 'test-your-grip',
  'hall-of-mirrors'
];

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, rand) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const easternFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export function getEasternDateKey(date = new Date()) {
  return easternFmt.format(date);
}

export function getWeeklyLineup(date = new Date()) {
  const easternKey = getEasternDateKey(date);
  const dayIndex = Math.floor(Date.parse(`${easternKey}T00:00:00Z`) / 86_400_000);
  const weekNumber = Math.floor((dayIndex + 3) / 7); // the flip lands on Monday 00:00 Eastern
  const cycleNumber = Math.floor(weekNumber / 5);
  const weekInCycle = weekNumber % 5;

  const rand = mulberry32(cycleNumber * 7919 + 1337);
  const deck = shuffle(ALL_GAME_IDS, rand);
  const splitSizes = shuffle([4, 5, 5, 5, 6], rand);

  let start = 0;
  for (let i = 0; i < weekInCycle; i++) start += splitSizes[i];
  const activeGames = deck.slice(start, start + splitSizes[weekInCycle]);
  const activeSet = new Set(activeGames);
  const closedGames = ALL_GAME_IDS.filter((id) => !activeSet.has(id));

  const nextMondayDayIndex = (weekNumber + 1) * 7 - 3;
  const nextRotationDateKey = new Date(nextMondayDayIndex * 86_400_000).toISOString().slice(0, 10);

  return { easternKey, weekNumber, cycleNumber, weekInCycle, splitSizes, activeGames, closedGames, nextRotationDateKey };
}

// The exact instant an Eastern calendar day starts (04:00 UTC in summer time, 05:00 otherwise), as ISO.
export function easternMidnightIso(dateKey) {
  for (const hours of [4, 5]) {
    const t = Date.parse(`${dateKey}T00:00:00Z`) + hours * 3_600_000;
    if (getEasternDateKey(new Date(t)) === dateKey && getEasternDateKey(new Date(t - 1)) !== dateKey) return new Date(t).toISOString();
  }
  return `${dateKey}T05:00:00.000Z`;
}

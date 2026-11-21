import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanRanks, mergeRank, setRank, parseLadders, ladderView, countSet } from '../../site/bureau/rsi1/companion/rep-core.js';
import { applyInbox } from '../../site/bureau/rsi1/companion/link-core.js';

const read = (f) => readFileSync(new URL(`../../site/bureau/rsi1/companion/${f}`, import.meta.url), 'utf8');
const L = (id, faction, scope, names) => ({ id, faction, scope, standings: names.map((name, i) => ({ name, min: i * 100 })) });
const ladders = parseLadders({ ladders: [L('B|S', 'Bounty Hunters Guild', 'Bounty', ['Neutral', 'Rookie', 'Hunter']), L('A|S', 'Adagio Holdings', 'Standing', ['Neutral', 'Jr. Contractor', 'Contractor']), { id: 'bad id!', standings: [] }, null] });

test('ladders are read from the game data, sorted by faction, junk dropped', () => {
  assert.deepEqual(ladders.map((l) => l.id), ['A|S', 'B|S']);
  assert.deepEqual(ladders[0].standings.map((s) => s.name), ['Neutral', 'Jr. Contractor', 'Contractor']);
  assert.deepEqual(parseLadders(null), []);
});

test('ranks: the newer choice wins, an empty rank means not set, junk is cleaned', () => {
  let r = mergeRank({}, 'A|S', 'Contractor', 10);
  r = mergeRank(r, 'A|S', 'Jr. Contractor', 5); // older: ignored
  assert.deepEqual(r['A|S'], { rank: 'Contractor', at: 10 });
  r = mergeRank(r, 'A|S', '', 20);
  assert.deepEqual(r['A|S'], { rank: '', at: 20 });
  assert.ok(setRank(r, 'A|S', 'Contractor', 1)['A|S'].at > 20); // a choice made here is always newer than what it replaces
  assert.deepEqual(cleanRanks({ 'bad id!': { rank: 'x' }, 'A|S': 'nope', 'B|S': { rank: 3, at: 'x' } }), { 'B|S': { rank: '', at: 0 } });
});

test('the view puts ladders you set first, says the next rank, filters by words, and ignores ranks the ladder does not have', () => {
  const ranks = { 'B|S': { rank: 'Rookie', at: 1 }, 'A|S': { rank: 'Gone', at: 1 } };
  const v = ladderView(ladders, ranks);
  assert.deepEqual(v.map((l) => [l.id, l.rank, l.next]), [['B|S', 'Rookie', 'Hunter'], ['A|S', '', '']]);
  assert.deepEqual(ladderView(ladders, ranks, 'adagio').map((l) => l.id), ['A|S']);
  assert.equal(countSet(ladders, ranks), 1);
});

test("two-way sync on the page: owned names from the app are added (never removed) and the app's rank choice merges by time", () => {
  const ev = (id, kind, data, at = 1000) => ({ dev: 'd', id, kind, at, data });
  const res = applyInbox([ev('o', 'owned_set', { names: ['Arden Core', 'Karna Rifle', 'Arden Core'] }), ev('r', 'rank_set', { ladder: 'A|S', rank: 'Contractor', at: 50 })],
    { owned: { 'arden core': { name: 'Arden Core', category: 'Armor', tier: 'Q3', at: 1 } } }, [], 2000, [], { 'A|S': { rank: 'Neutral', at: 10 } });
  assert.equal(res.added, 1);
  assert.equal(res.bp.owned['arden core'].category, 'Armor');
  assert.ok(res.bp.owned['karna rifle']);
  assert.deepEqual(res.ranks['A|S'], { rank: 'Contractor', at: 50 });
  assert.equal(res.feed.find((f) => f.kind === 'rank_set').text, 'Rank set in the app: Contractor');
  assert.ok(!res.feed.some((f) => f.kind === 'owned_set'));
  const older = applyInbox([ev('r2', 'rank_set', { ladder: 'A|S', rank: 'Neutral', at: 5 })], null, [], 3000, [], res.ranks);
  assert.deepEqual(older.ranks['A|S'], { rank: 'Contractor', at: 50 });
});

test('wiring: the Reputation card is on OmniOps, reads only our own data API, uses text nodes, and ranks are saved as a profile entry', () => {
  const ui = read('rep-ui.js'), html = read('index.html'), app = read('app.js'), link = read('link-ui.js');
  assert.match(html, /<div class="card mt12" id="opsRep"><\/div>/);
  assert.match(app, /import \{ initRanks \} from '\.\/rep-ui\.js';/); assert.match(app, /initRanks\(\$\('#opsRep'\)\);/);
  assert.deepEqual([...ui.matchAll(/fetch\(\s*([A-Z_]+|'[^']+')/g)].map((m) => m[1]), ['API_FACTIONS']);
  assert.match(ui, /const API_FACTIONS = '\/api\/companion\/data\?name=factions';/);
  assert.match(ui, /const K_RANKS = 'arsenal\.rep\.ranks';/); assert.match(link, /write\(K_RANKS, res\.ranks\)/);
  assert.doesNotMatch(ui + read('rep-core.js'), /innerHTML|insertAdjacentHTML|\.style\.|https?:\/\//);
});

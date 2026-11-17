// TacBoard keeps itself current from your game: contracts you accept in game appear on the board, and finish, fail or abandon with the mission.
import fs from 'node:fs';
const D = 'site/bureau/rsi1/companion/';
const edit = (file, pairs) => {
  const raw = fs.readFileSync(file, 'utf8'), crlf = raw.includes('\r\n');
  let s = raw.replace(/\r\n/g, '\n');
  for (const [a, b] of pairs) { if (!s.includes(a)) { console.error(`NOT FOUND in ${file}:\n${a}`); process.exit(1); } s = s.replace(a, () => b); }
  fs.writeFileSync(file, crlf ? s.replace(/\n/g, '\r\n') : s); console.log('ok', file);
};
const make = (file, text) => { if (fs.existsSync(file)) { console.error('exists: ' + file); process.exit(1); } fs.writeFileSync(file, text); console.log('new', file); };

make(D + 'tac-core.js', `// Keeps the TacBoard in step with the contracts OmniGlass Desktop reads from your Game.log. Pure functions, so they can be tested.
// A contract you accept in game is added once (even if you delete it later, it is not added again); when its mission ends, the board entry
// follows. Only the title, blueprint reward and reputation range come from the log: payout, cargo and deadline stay as you scanned or typed them.
export const MAP_MAX = 400;
export const FRESH_MS = 2 * 864e5; // an accepted contract with no end in the log counts as open only for two days
const STATUS = { active: 'active', done: 'done', failed: 'failed', abandoned: 'abandoned' };

/** Add new game contracts and move finished ones. \`make\` builds a board entry; returns the new list, the new id map and whether anything changed. */
export function syncGame(contracts, map, game, make, now = Date.now()) {
  const list = Array.isArray(contracts) ? contracts.slice() : [];
  const ids = { ...(map && typeof map === 'object' ? map : {}) };
  let changed = false;
  for (const g of [...(Array.isArray(game) ? game : [])].reverse()) { // oldest first, so the newest ends up on top
    const status = STATUS[g?.state];
    if (!g || typeof g.id !== 'string' || !status) continue;
    const have = ids[g.id] ? list.find((c) => c.id === ids[g.id]) : null;
    if (have) {
      if ((have.status === 'new' || have.status === 'active') && status !== 'active') { have.status = status; changed = true; }
      continue;
    }
    if (ids[g.id]) continue; // you deleted it from the board: leave it deleted
    const at = Date.parse(g.at);
    if (status === 'active' && !(now - at < FRESH_MS)) continue; // an old, never-finished contract is not shown as open
    const c = make({ title: g.title, type: 'OTHER', reputation: g.rep || null, bonus: g.blueprint ? 'Blueprint reward' : null });
    c.status = status; c.source = 'game';
    list.unshift(c); ids[g.id] = c.id; changed = true;
  }
  const keys = Object.keys(ids); if (keys.length > MAP_MAX) for (const k of keys.slice(0, keys.length - MAP_MAX)) delete ids[k];
  return { contracts: list, map: ids, changed };
}
`);

edit(D + 'local-core.js', [
[`  return { pending: !!raw.pending,`, `  const contracts = Array.isArray(raw.contracts)
    ? raw.contracts.filter((c) => c && typeof c === 'object' && typeof c.id === 'string' && typeof c.title === 'string' && c.title).slice(0, 60)
        .map((c) => ({ id: str(c.id, 60), title: str(c.title, 120), blueprint: c.blueprint === true, rep: str(c.rep, 60), state: ['active', 'done', 'failed', 'abandoned'].includes(c.state) ? c.state : 'active', at: str(c.at, 40) }))
    : [];
  return { contracts, pending: !!raw.pending,`]]);

edit(D + 'app.js', [
[`import { initLocal } from './local-ui.js';`, `import { initLocal } from './local-ui.js';
import { readLocal } from './local-core.js';
import { syncGame } from './tac-core.js';`],
[`// ---------------- LIVE DATA (our own Worker; nothing leaves this origin) ----------------`,
`// TacBoard from your game: contracts accepted, finished or dropped in game follow into the board (read-only; payout and cargo stay yours).
function syncGameContracts() {
  const snap = readLocal(window.__OMNIGLASS__) || readLocal(window.omniglass && window.omniglass.snapshot());
  if (!snap || !snap.contracts.length) return;
  const r = syncGame(S.contracts, ls.get('gameContracts', {}), snap.contracts, normContract);
  ls.set('gameContracts', r.map);
  if (r.changed) { S.contracts = r.contracts; Store.saveContracts(); }
}
window.addEventListener('omniglass-local', syncGameContracts);
window.addEventListener('omniglass-bridge', syncGameContracts);

// ---------------- LIVE DATA (our own Worker; nothing leaves this origin) ----------------`],
[`Store.init();`, `Store.init();
syncGameContracts();`]]);

make('worker/test/tac.test.mjs', `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncGame } from '../../site/bureau/rsi1/companion/tac-core.js';
import { readLocal } from '../../site/bureau/rsi1/companion/local-core.js';

const NOW = Date.parse('2026-11-16T23:00:00Z');
const make = (c) => ({ id: 'c-' + c.title, status: 'new', title: c.title, type: c.type, reputation: c.reputation, bonus: c.bonus });
const g = (id, title, state, at = '2026-11-16T22:00:00Z', blueprint = false) => ({ id, title, state, at, blueprint, rep: '' });

test('tacboard: a new accepted contract is added once, with its blueprint flag', () => {
  const a = syncGame([], {}, [g('m1', 'Haul A', 'active', undefined, true)], make, NOW);
  assert.equal(a.contracts.length, 1); assert.equal(a.contracts[0].status, 'active'); assert.equal(a.contracts[0].bonus, 'Blueprint reward'); assert.equal(a.changed, true);
  const b = syncGame(a.contracts, a.map, [g('m1', 'Haul A', 'active')], make, NOW);
  assert.equal(b.contracts.length, 1); assert.equal(b.changed, false);
});
test('tacboard: the mission ending moves the entry; payout you typed is kept', () => {
  const a = syncGame([], {}, [g('m1', 'Haul A', 'active')], make, NOW);
  a.contracts[0].payout = 12000;
  const b = syncGame(a.contracts, a.map, [g('m1', 'Haul A', 'done')], make, NOW);
  assert.equal(b.contracts[0].status, 'done'); assert.equal(b.contracts[0].payout, 12000); assert.equal(b.changed, true);
});
test('tacboard: a contract you deleted stays deleted, and an old unfinished one is not shown as open', () => {
  const a = syncGame([], {}, [g('m1', 'Haul A', 'active')], make, NOW);
  const b = syncGame([], a.map, [g('m1', 'Haul A', 'done')], make, NOW);
  assert.equal(b.contracts.length, 0);
  const c = syncGame([], {}, [g('m9', 'Old', 'active', '2026-11-01T00:00:00Z'), g('m8', 'Old done', 'done', '2026-11-01T00:00:00Z')], make, NOW);
  assert.deepEqual(c.contracts.map((x) => x.title), ['Old done']);
});
test('tacboard: odd input does not break it, and a manual status change is not overwritten', () => {
  assert.equal(syncGame(null, null, null, make, NOW).contracts.length, 0);
  assert.equal(syncGame([], {}, [null, { id: 5 }, g('m1', 'X', 'weird')], make, NOW).contracts.length, 0);
  const a = syncGame([], {}, [g('m1', 'Haul A', 'active')], make, NOW); a.contracts[0].status = 'failed';
  assert.equal(syncGame(a.contracts, a.map, [g('m1', 'Haul A', 'done')], make, NOW).contracts[0].status, 'failed');
});
test('local data: contracts are cleaned', () => {
  const s = readLocal({ app: 'omniglass-desktop', contracts: [{ id: 'a', title: 'T', state: 'done', blueprint: true }, { id: 'b', title: '', state: 'done' }, { id: 5 }] });
  assert.equal(s.contracts.length, 1); assert.equal(s.contracts[0].state, 'done'); assert.equal(s.contracts[0].blueprint, true);
  assert.deepEqual(readLocal({ app: 'omniglass-desktop' }).contracts, []);
});
`);

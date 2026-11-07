import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { coinRoleIds, rolePlan, syncCoinRoles } from '../coin-roles.js';
import { ticketStore } from '../ticket-db.js';
import { fakeD1 } from './helpers/d1.mjs';

const GUILD = '100000000000000001';
const IDS = Array.from({ length: 15 }, (_, i) => String(500000000000000000n + BigInt(i)));
const A = '300000000000000001', B = '300000000000000002', GONE = '300000000000000009';
const realFetch = globalThis.fetch;
let env, calls, roles;

beforeEach(() => {
  calls = [];
  roles = { [A]: ['111111111111111111'], [B]: [IDS[0], IDS[3]] };
  globalThis.fetch = async (url, init = {}) => {
    const p = new URL(url).pathname.replace('/api/v10', '');
    const method = init.method || 'GET';
    let m = p.match(/members\/(\d+)$/);
    if (m) return roles[m[1]] ? Response.json({ roles: roles[m[1]], user: { id: m[1] } }) : Response.json({ code: 10007 }, { status: 404 });
    m = p.match(/members\/(\d+)\/roles\/(\d+)$/);
    if (m) { calls.push([method, m[1], m[2]]); return new Response(null, { status: 204 }); }
    throw new Error('unexpected ' + method + ' ' + p);
  };
  env = { DISCORD_BOT_TOKEN: 't', DISCORD_GUILD_ID: GUILD, COIN_ROLE_IDS: IDS.join(','), DB: fakeD1() };
});
afterEach(() => { globalThis.fetch = realFetch; });

test('COIN_ROLE_IDS must hold all 15 role IDs', () => {
  assert.equal(coinRoleIds({ COIN_ROLE_IDS: IDS.join(' , ') }).length, 15);
  assert.equal(coinRoleIds({ COIN_ROLE_IDS: IDS.slice(0, 14).join(',') }), null);
  assert.equal(coinRoleIds({}), null);
});

test('rolePlan: one coin role, the right one', () => {
  assert.deepEqual(rolePlan(['x'], IDS, 2), { add: [IDS[2]], remove: [] });
  assert.deepEqual(rolePlan([IDS[0], IDS[3], 'x'], IDS, 3), { add: [], remove: [IDS[0]] });
  assert.deepEqual(rolePlan([IDS[5]], IDS, -1), { add: [], remove: [IDS[5]] });
});

test('the cron gives the right role, swaps old ones, and only touches what changed', async () => {
  const store = ticketStore(env.DB);
  await store.change(A, 'Ann', 600, 'award', { ref: 'a1' });   // tier 3: The Midway
  await store.change(B, 'Bo', 1200, 'award', { ref: 'b1' });   // tier 4: The Green Room (already held, plus a stale tier 1)
  await store.change(GONE, 'Gone', 50, 'award', { ref: 'g1' }); // left the server
  const r = await syncCoinRoles(env);
  assert.equal(r.checked, 3);
  assert.deepEqual(calls.sort(), [['DELETE', B, IDS[0]], ['PUT', A, IDS[2]]].sort());
  calls = [];
  assert.equal((await syncCoinRoles(env)).checked, 0, 'nothing changed, nobody looked up');
  await store.change(A, 'Ann', 600, 'award', { ref: 'a2' });   // 1,200 won: tier 4
  roles[A] = [IDS[2]];
  await syncCoinRoles(env);
  assert.deepEqual(calls.sort(), [['DELETE', A, IDS[2]], ['PUT', A, IDS[3]]].sort());
});

test('hidden from the High Scores means no coin role', async () => {
  await ticketStore(env.DB).change(B, 'Bo', 1200, 'award', { ref: 'b1' });
  await env.DB.prepare('UPDATE ticket_wallets SET hidden = 1 WHERE user_id = ?').bind(B).run();
  await syncCoinRoles(env);
  assert.deepEqual(calls.sort(), [['DELETE', B, IDS[0]], ['DELETE', B, IDS[3]]].sort());
});

test('does nothing until the role IDs are set', async () => {
  assert.deepEqual(await syncCoinRoles({ ...env, COIN_ROLE_IDS: '' }), { skipped: true, changed: 0 });
});

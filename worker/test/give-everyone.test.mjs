import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { awardEveryone } from '../tickets.js';
import { COMMANDS } from '../interactions.js';
import { ticketStore } from '../ticket-db.js';
import { fakeD1 } from './helpers/d1.mjs';

const GUILD = '100000000000000001';
const realFetch = globalThis.fetch;
let env;
const members = [
  { user: { id: '300000000000000001', username: 'ann' }, nick: 'Ann' },
  { user: { id: '300000000000000002', username: 'bo', global_name: 'Bo' } },
  { user: { id: '300000000000000003', username: 'usher', bot: true } }
];

beforeEach(() => {
  globalThis.fetch = async (url) => {
    const p = new URL(url).pathname;
    if (p.endsWith(`/guilds/${GUILD}/members`)) return Response.json(members);
    throw new Error('unexpected ' + url);
  };
  env = { DISCORD_BOT_TOKEN: 't', DISCORD_GUILD_ID: GUILD, DB: fakeD1() };
});
afterEach(() => { globalThis.fetch = realFetch; });

test('everyone but bots gets the gift once per run', async () => {
  const r = await awardEveryone(env, 'RingMaster', 10, 'Opening night', 'i1');
  assert.deepEqual(r, { given: 2, already: 0, amount: 10 });
  const store = ticketStore(env.DB);
  assert.equal(Number((await store.wallet('300000000000000001')).balance), 10);
  assert.equal(Number((await store.wallet('300000000000000002')).lifetime), 10);
  assert.equal(await store.wallet('300000000000000003'), null);
  assert.deepEqual(await awardEveryone(env, 'RingMaster', 10, 'Opening night', 'i1'), { given: 0, already: 2, amount: 10 }, 'a retry never pays twice');
  assert.equal((await awardEveryone(env, 'RingMaster', 10, 'Again', 'i2')).given, 2, 'a new command is a new gift');
});

test('amount limits', async () => {
  await assert.rejects(awardEveryone(env, 'R', 0, 'x', 'k'), /between 1/);
  await assert.rejects(awardEveryone(env, 'R', 100000, 'x', 'k'), /between 1/);
});

test('the command is registered for Ringleaders with an amount and a reason', () => {
  const c = COMMANDS.find((x) => x.name === 'give-everyone');
  assert.ok(c);
  assert.deepEqual(c.options.map((o) => [o.name, o.required]), [['amount', true], ['reason', true]]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleDevices, cleanEvent, newCode, normalCode, newToken, EVENT_KINDS } from '../companion-devices.js';
import { COMPANION_COOKIE } from '../companion.js';
import { seal } from '../auth.js';
import { fakeD1 } from './helpers/d1.mjs';

const SECRET = 'x'.repeat(40);
const ORIGIN = 'https://bureau.belpire.com';
const UID = '223456789012345678';
const OTHER = '323456789012345678';

const envWith = () => ({ DB: fakeD1(), SESSION_SECRET: SECRET });
async function cookieFor(uid = UID) {
  const v = await seal({ uid, name: 'Pilot One', iat: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET, 'bureau-session');
  return `${COMPANION_COOKIE}=${v}`;
}
const page = async (env, method, path, { uid = UID, body, origin = ORIGIN } = {}) =>
  handleDevices(new Request(ORIGIN + path, { method, headers: { Cookie: await cookieFor(uid), ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) }), env);
const app = (env, method, path, { token, body } = {}) =>
  handleDevices(new Request(ORIGIN + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) }), env);

async function pair(env, uid = UID, name = 'Gaming PC') {
  const made = await (await page(env, 'POST', '/api/companion/pair/new', { uid })).json();
  const res = await app(env, 'POST', '/api/companion/pair', { body: { code: made.code, name } });
  return { made, res, got: res.status === 200 ? await res.clone().json() : null };
}
const ev = (id, name = 'Test Blueprint', at = 1000) => ({ id, kind: 'blueprint', at, data: { name } });

test('a code looks like XXXX-XXXX from 32 unambiguous characters and normalises either way', () => {
  const seen = new Set();
  for (let i = 0; i < 400; i++) { const c = newCode(); assert.match(c, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/); for (const ch of c.replace('-', '')) seen.add(ch); }
  assert.ok(seen.size >= 30, 'all 32 symbols should turn up');
  assert.equal(normalCode('abcd-2345 '), 'ABCD2345');
  assert.equal(normalCode('o1il-0O1L'), '01110011');
  assert.match(newToken(), /^ogd_[A-Za-z0-9_-]{43}$/);
});

test('pairing: a signed-in page makes a code, the app trades it for a token once, and the code is then dead', async () => {
  const env = envWith();
  const { made, res, got } = await pair(env);
  assert.equal(made.expiresIn, 600);
  assert.equal(res.status, 200);
  assert.match(got.token, /^ogd_/);
  const again = await app(env, 'POST', '/api/companion/pair', { body: { code: made.code, name: 'Second' } });
  assert.equal(again.status, 400);
  assert.equal((await again.json()).error, 'bad_code');
});

test('the token is stored only as a hash, and the code too', async () => {
  const env = envWith();
  const { made, got } = await pair(env);
  const dump = JSON.stringify(env.DB._raw.prepare('SELECT * FROM companion_devices').all()) + JSON.stringify(env.DB._raw.prepare('SELECT * FROM companion_pair').all());
  assert.ok(!dump.includes(got.token));
  assert.ok(!dump.includes(normalCode(made.code)));
});

test('a code accepts lower case and a missing dash, rejects rubbish, and expires after ten minutes', async () => {
  const env = envWith();
  const made = await (await page(env, 'POST', '/api/companion/pair/new')).json();
  const sloppy = made.code.toLowerCase().replace('-', ' ');
  assert.equal((await app(env, 'POST', '/api/companion/pair', { body: { code: 'nope' } })).status, 400);
  env.DB._raw.prepare('UPDATE companion_pair SET expires = ?').run(Date.now() - 1);
  assert.equal((await app(env, 'POST', '/api/companion/pair', { body: { code: sloppy } })).status, 400);
  const fresh = await (await page(env, 'POST', '/api/companion/pair/new')).json();
  assert.equal((await app(env, 'POST', '/api/companion/pair', { body: { code: fresh.code.toLowerCase().replace('-', '') } })).status, 200);
});

test('making codes needs a companion session and the site as origin; at most five are pending', async () => {
  const env = envWith();
  assert.equal((await app(env, 'POST', '/api/companion/pair/new')).status, 401);
  assert.equal((await page(env, 'POST', '/api/companion/pair/new', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await page(env, 'POST', '/api/companion/pair/new', { origin: null })).status, 403);
  for (let i = 0; i < 5; i++) assert.equal((await page(env, 'POST', '/api/companion/pair/new')).status, 200);
  assert.equal((await page(env, 'POST', '/api/companion/pair/new')).status, 429);
});

test('events: the app posts with its token, duplicates are ignored, the page reads them and acknowledges', async () => {
  const env = envWith();
  const { got } = await pair(env);
  const r1 = await app(env, 'POST', '/api/companion/inbox', { token: got.token, body: { events: [ev('a', 'One'), ev('b', 'Two', 2000)] } });
  assert.deepEqual(await r1.json(), { accepted: 2, rejected: 0 });
  const r2 = await app(env, 'POST', '/api/companion/inbox', { token: got.token, body: { events: [ev('a', 'One'), ev('c', 'Three', 3000)] } });
  assert.deepEqual(await r2.json(), { accepted: 1, rejected: 0 });

  const read = await (await page(env, 'GET', '/api/companion/inbox')).json();
  assert.deepEqual(read.events.map((e) => e.data.name), ['One', 'Two', 'Three']);
  assert.equal(read.events[0].dev, got.deviceId);

  const keys = read.events.slice(0, 2).map((e) => `${e.dev}:${e.id}`);
  assert.equal((await (await page(env, 'POST', '/api/companion/inbox/ack', { body: { keys } })).json()).acked, 2);
  const left = await (await page(env, 'GET', '/api/companion/inbox')).json();
  assert.deepEqual(left.events.map((e) => e.id), ['c']);
});

test('the app token cannot read the inbox or list devices, and a missing or wrong token is refused', async () => {
  const env = envWith();
  const { got } = await pair(env);
  assert.equal((await app(env, 'GET', '/api/companion/inbox', { token: got.token })).status, 401);
  assert.equal((await app(env, 'GET', '/api/companion/devices', { token: got.token })).status, 401);
  assert.equal((await app(env, 'POST', '/api/companion/inbox', { body: { events: [ev('a')] } })).status, 401);
  assert.equal((await app(env, 'POST', '/api/companion/inbox', { token: 'ogd_' + 'A'.repeat(43), body: { events: [ev('a')] } })).status, 401);
  assert.equal((await app(env, 'POST', '/api/companion/inbox', { token: 'not-a-token', body: { events: [ev('a')] } })).status, 401);
});

test('two people never see each other\'s events, and one cannot acknowledge or revoke the other\'s', async () => {
  const env = envWith();
  const a = (await pair(env, UID)).got;
  const b = (await pair(env, OTHER)).got;
  await app(env, 'POST', '/api/companion/inbox', { token: a.token, body: { events: [ev('x', 'Mine')] } });
  await app(env, 'POST', '/api/companion/inbox', { token: b.token, body: { events: [ev('x', 'Theirs')] } });
  const mine = await (await page(env, 'GET', '/api/companion/inbox', { uid: UID })).json();
  assert.deepEqual(mine.events.map((e) => e.data.name), ['Mine']);
  await page(env, 'POST', '/api/companion/inbox/ack', { uid: UID, body: { keys: [`${b.deviceId}:x`] } });
  assert.equal((await (await page(env, 'GET', '/api/companion/inbox', { uid: OTHER })).json()).events.length, 1);
  assert.equal((await page(env, 'DELETE', `/api/companion/devices?id=${b.deviceId}`, { uid: UID })).status, 404);
});

test('revoking a device kills its token and drops what it left waiting', async () => {
  const env = envWith();
  const { got } = await pair(env);
  await app(env, 'POST', '/api/companion/inbox', { token: got.token, body: { events: [ev('a')] } });
  const list = await (await page(env, 'GET', '/api/companion/devices')).json();
  assert.equal(list.devices.length, 1);
  assert.equal(list.devices[0].name, 'Gaming PC');
  assert.equal(list.devices[0].waiting, 1);
  assert.equal((await page(env, 'DELETE', `/api/companion/devices?id=${got.deviceId}`)).status, 200);
  assert.equal((await app(env, 'POST', '/api/companion/inbox', { token: got.token, body: { events: [ev('b')] } })).status, 401);
  assert.equal((await (await page(env, 'GET', '/api/companion/inbox')).json()).events.length, 0);
});

test('at most eight devices per person', async () => {
  const env = envWith();
  for (let i = 0; i < 8; i++) assert.equal((await pair(env)).res.status, 200);
  const made = await page(env, 'POST', '/api/companion/pair/new');
  assert.equal(made.status, 409);
});

test('events are cleaned: unknown kinds and bad ids are dropped, values are short plain text, numbers and booleans', () => {
  assert.equal(cleanEvent({ id: 'a', kind: 'format_disk', data: {} }), null);
  assert.equal(cleanEvent({ id: 'bad id!', kind: 'blueprint', data: { name: 'x' } }), null);
  assert.equal(cleanEvent({ id: 'a', kind: 'blueprint', data: {} }), null);
  const c = cleanEvent({ id: 'a', kind: 'contract_accepted', at: 5, data: { title: ' Haul\u0000  cargo '.padEnd(300, 'z'), reward: 12, bp: true, nested: { x: 1 }, list: [1], 'bad key': 1, n: NaN } });
  assert.equal(c.data.title.length, 120);
  assert.ok(!c.data.title.includes('\u0000'));
  assert.deepEqual(Object.keys(c.data).sort(), ['bp', 'reward', 'title']);
  assert.ok(cleanEvent({ id: 'a', kind: 'blueprint', at: Date.now() + 9e12, data: { name: 'x' } }).at < Date.now() + 90_000_000);
  assert.deepEqual([...EVENT_KINDS].sort(), ['blueprint', 'contract_accepted', 'incapacitated', 'mission_end', 'vehicle_destroyed']);
});

test('bad bodies and oversize batches are refused, and a batch past 100 is trimmed', async () => {
  const env = envWith();
  const { got } = await pair(env);
  assert.equal((await app(env, 'POST', '/api/companion/inbox', { token: got.token, body: { nope: 1 } })).status, 400);
  const huge = { events: [ev('a', 'x'.repeat(70_000))] };
  assert.equal((await app(env, 'POST', '/api/companion/inbox', { token: got.token, body: huge })).status, 413);
  const many = { events: Array.from({ length: 150 }, (_, i) => ev(`e${i}`, `N${i}`, i)) };
  assert.equal((await (await app(env, 'POST', '/api/companion/inbox', { token: got.token, body: many })).json()).accepted, 100);
});

test('a full inbox pushes back with 429 instead of growing without end', async () => {
  const env = envWith();
  const { got } = await pair(env);
  const ins = env.DB._raw.prepare('INSERT INTO companion_inbox (uid, dev, eid, kind, data, at) VALUES (?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < 2000; i++) ins.run(UID, 'old', `e${i}`, 'blueprint', '{"name":"x"}', i);
  const res = await app(env, 'POST', '/api/companion/inbox', { token: got.token, body: { events: [ev('z')] } });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, 'inbox_full');
});

test('without the database or secret the whole feature reports unavailable', async () => {
  assert.equal((await app({}, 'POST', '/api/companion/pair', { body: { code: 'ABCD-2345' } })).status, 503);
});

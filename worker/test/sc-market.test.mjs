import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { parseTerminals, parsePriceRow, parsePrices, parseLiveVersion, unwrap, refreshMarket, handleMarket, cleanShipName, MARKET_EVERY_MS } from '../sc-market.js';

// These fixtures follow the field names UEX documents for commodities_prices_all; they are examples, not
// captured responses. The parser is tolerant, and a real response with different names fails loudly (see below).
const ROWS = [
  { commodity_name: 'Recycled Material Composite', terminal_name: 'TDD - Commons', star_system_name: 'Stanton', price_buy: 0, price_sell: 6000, scu_sell_stock: 0, scu_buy: 0, date_modified: 1793000000 },
  { commodity_name: 'Recycled Material Composite', terminal_name: 'Admin - Endgame', star_system_name: 'Pyro', price_buy: 7700, price_sell: 0, scu_buy: 120, date_modified: 1793000100 },
  { commodity_name: 'Gold', terminal_name: 'Somewhere', star_system_name: 'Stanton', price_buy: 5900, price_sell: 6400 },
  { commodity_name: 'Nothing', terminal_name: 'Nowhere', price_buy: 0, price_sell: 0 },
  null,
  { terminal_name: 'No commodity', price_buy: 5 }
];

function memoryKV() {
  const store = new Map();
  return { store, async get(k, t) { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, async put(k, v) { store.set(k, v); } };
}

let realFetch;
let calls;
let responses;
beforeEach(() => {
  realFetch = globalThis.fetch;
  calls = [];
  responses = {
    commodities_prices_all: { status: 'ok', data: ROWS },
    game_versions: { status: 'ok', data: { live: '4.11.0', ptu: '4.12.0-ptu' } },
    terminals: { status: 'ok', data: [{ id: 7, name: 'Admin - Endgame', star_system_name: 'Pyro', outpost_name: 'Endgame' }] }
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, auth: init.headers?.Authorization });
    for (const k of Object.keys(responses)) if (u.includes(`/${k}/`)) return responses[k] === null ? new Response('no', { status: 503 }) : new Response(JSON.stringify(responses[k]), { status: 200 });
    throw new Error(`unexpected fetch ${u}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

test('parsePriceRow keeps priced rows and drops unusable ones', () => {
  const rows = parsePrices(ROWS);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { commodity: 'Recycled Material Composite', terminal: 'TDD - Commons', system: 'Stanton', place: '', buy: null, sell: 6000, scuBuy: 0, scuSell: 0, at: 1793000000 });
  assert.equal(parsePriceRow({ commodity_name: 'X', terminal_name: 'Y', price_buy: 'abc' }), null);
});

test('a response with unknown field names fails loudly and shows the keys it saw', () => {
  assert.throws(() => parsePrices([{ foo: 1, bar: 2 }]), /no usable rows \(first row keys: foo,bar\)/);
  assert.throws(() => parsePrices({}), /expected a list/);
});

test('unwrap rejects a non-ok UEX status', () => {
  assert.deepEqual(unwrap({ status: 'ok', data: [1] }), [1]);
  assert.throws(() => unwrap({ status: 'requests_limit_reached', data: null }), /requests_limit_reached/);
});

test('parseLiveVersion only trusts version-looking strings', () => {
  assert.equal(parseLiveVersion({ live: '4.11.0' }), '4.11.0');
  assert.equal(parseLiveVersion([{ version: '4.10.2' }]), '4.10.2');
  assert.equal(parseLiveVersion({ live: 'soon' }), null);
  assert.equal(parseLiveVersion(null), null);
});

test('refreshMarket does nothing without a token, and the endpoint says so', async () => {
  const env = { SC_DATA: memoryKV() };
  assert.equal(await refreshMarket(env), null);
  assert.equal(calls.length, 0);
  const body = await handleMarket(env, { waitUntil() {} });
  assert.deepEqual(body, { enabled: false, prices: [], version: null, updatedAt: null });
});

test('refresh stores a snapshot, sends the token, and does not hit UEX again within the hour', async () => {
  const env = { SC_DATA: memoryKV(), UEX_API_TOKEN: 'secret-token' };
  const m = await refreshMarket(env);
  assert.equal(m.prices.length, 3);
  assert.equal(m.version, '4.11.0');
  assert.ok(calls.every((c) => c.auth === 'Bearer secret-token'));
  assert.equal(calls.length, 3);
  await refreshMarket(env);
  assert.equal(calls.length, 3, 'second run inside the window must not call UEX');
  const stored = JSON.parse(env.SC_DATA.store.get('sc:market'));
  stored.checkedAt = new Date(Date.now() - MARKET_EVERY_MS - 1000).toISOString();
  env.SC_DATA.store.set('sc:market', JSON.stringify(stored));
  await refreshMarket(env);
  assert.equal(calls.length, 6);
});

test('a failed prices call keeps the last good prices and flags the page as partial', async () => {
  const env = { SC_DATA: memoryKV(), UEX_API_TOKEN: 't' };
  await refreshMarket(env);
  responses.commodities_prices_all = null;
  const m = await refreshMarket(env, { force: true });
  assert.equal(m.prices.length, 3);
  assert.ok(m.errors.length > 0);
  const pub = await handleMarket(env, { waitUntil() {} });
  assert.equal(pub.partial, true);
  assert.equal('errors' in pub, false, 'upstream error text must not reach the page');
  assert.equal(JSON.stringify(pub).includes('t"'), true);
});

test('GET /api/sc-market works through the Worker and never exposes the token', async () => {
  const env = { SC_DATA: memoryKV(), UEX_API_TOKEN: 'secret-token' };
  const res = await worker.fetch(new Request('https://bureau.belpire.com/api/sc-market'), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes('secret-token'));
  const body = JSON.parse(text);
  assert.equal(body.enabled, true);
  assert.equal(body.version, '4.11.0');
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=300');
});

test('ship names are validated before anything is fetched', async () => {
  assert.equal(cleanShipName('Drake Vulture'), 'Drake Vulture');
  assert.equal(cleanShipName("Hull-C"), 'Hull-C');
  assert.equal(cleanShipName('x'), null);
  assert.equal(cleanShipName('a&b=<script>'), null);
  const res = await worker.fetch(new Request('https://bureau.belpire.com/api/sc-ship?name=%3Cscript%3E'), {}, { waitUntil() {} });
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('rows without a system or place are filled from the terminals list, by id or by name', async () => {
  const terms = parseTerminals([
    { id: 7, name: 'Admin - Endgame', star_system_name: 'Pyro', outpost_name: 'Endgame' },
    { id: 9, name: 'TDD - Area 18', nickname: 'Area18 TDD', star_system_name: 'Stanton', city_name: 'Area 18', planet_name: 'ArcCorp' }
  ]);
  const rows = parsePrices([
    { commodity_name: 'Gold', terminal_name: 'Whatever', id_terminal: 7, price_buy: 10 },
    { commodity_name: 'Gold', terminal_name: 'tdd - area 18', price_sell: 12 },
    { commodity_name: 'Gold', terminal_name: 'Unlisted', star_system_name: 'Nyx', price_sell: 12 },
    { commodity_name: 'Gold', terminal_name: 'Also unlisted', price_sell: 12 }
  ], terms);
  assert.deepEqual(rows.map((r) => [r.system, r.place]), [['Pyro', 'Endgame'], ['Stanton', 'Area 18'], ['Nyx', ''], ['', '']]);
  assert.equal(parseTerminals(null).size, 0);
});

test('an old snapshot without the schema is rebuilt on the next request, once', async () => {
  const env = { SC_DATA: memoryKV(), UEX_API_TOKEN: 't' };
  env.SC_DATA.store.set('sc:market', JSON.stringify({ updatedAt: 'x', checkedAt: new Date().toISOString(), version: '4.0', prices: [{ commodity: 'Old', terminal: 'T', system: '', place: '' }], errors: [] }));
  const body = await handleMarket(env, { waitUntil() {} });
  assert.equal(body.prices.length, 3); assert.equal(body.prices[1].system, 'Pyro');
  const n = calls.length; await handleMarket(env, { waitUntil() {} }); assert.equal(calls.length, n);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { KINDS, PROMPTS, cleanScan, extractJson, sniffImage, takeScan, handleScan, MAX_IMAGES, MAX_IMAGE_BYTES } from '../sc-scan.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const GIF = new TextEncoder().encode('GIF89a......');

function memoryKV() {
  const store = new Map();
  return { store, async get(k) { return store.get(k) ?? null; }, async put(k, v) { store.set(k, v); } };
}
function aiReturning(response) {
  const calls = [];
  return { calls, async run(model, input) { calls.push({ model, input }); if (response instanceof Error) throw response; return { response }; } };
}
function scanRequest({ kind = 'salvage', files = [JPEG], origin = 'https://bureau.belpire.com', ip = '203.0.113.7' } = {}) {
  const form = new FormData();
  if (kind != null) form.set('kind', kind);
  for (const f of files) form.append('images', new Blob([f], { type: 'image/jpeg' }), 'a.jpg');
  return new Request('https://bureau.belpire.com/api/sc-scan', { method: 'POST', body: form, headers: { ...(origin ? { Origin: origin } : {}), 'CF-Connecting-IP': ip } });
}
const env = (ai) => ({ AI: ai, SC_DATA: memoryKV() });

test('the fabricator list is cleaned to names, categories, tiers and an owned flag', () => {
  const f = cleanScan('fabricator', { seen: 'list', category: 'Weapons', rows: [{ name: 'Gallant Rifle', category: 'Weapons', tier: 'Q3', owned: true }, { name: 'Locked One', owned: 'no' }, { nothing: 1 }, { name: 'x'.repeat(200) }] });
  assert.equal(f.rows.length, 3);
  assert.deepEqual(f.rows[0], { name: 'Gallant Rifle', category: 'Weapons', tier: 'Q3', owned: true });
  assert.equal(f.rows[1].owned, null);
  assert.equal(f.rows[2].name.length, 80);
});

test('every kind has a prompt and a shape', () => {
  assert.deepEqual(KINDS.sort(), ['cargo', 'contracts', 'fabricator', 'mining', 'salvage', 'ship', 'trade', 'weapon']);
  for (const k of KINDS) assert.ok(PROMPTS[k].includes('"seen"'), k);
});

test('extractJson finds JSON inside prose and code fences, and survives braces in strings', () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a": 1, "b": "x}y"}\n```'), { a: 1, b: 'x}y' });
  assert.deepEqual(extractJson({ response: '{"a":2}' }), { a: 2 });
  assert.equal(extractJson('no json here'), null);
  assert.equal(extractJson('{"a": '), null);
});

test('cleanScan forces each kind into its fixed shape: numbers coerced, text trimmed, junk dropped', () => {
  const s = cleanScan('salvage', { seen: 'terminal', notes: ['blurry', 5, null], rmcScu: '1,200', rmcPrice: 'abc', cmYield: 60, evil: '<script>', contract: true });
  assert.equal(s.rmcScu, 1200); assert.equal(s.rmcPrice, null); assert.equal(s.cmYield, 60); assert.equal(s.contract, null);
  assert.equal('evil' in s, false);
  assert.deepEqual(s.notes, ['blurry', '5']);

  const m = cleanScan('mining', { lines: [{ ore: 'Quantanium', raw: 10, yieldPct: '70' }, null, 'x', { foo: 1 }], fee: 5000 });
  assert.deepEqual(m.lines, [{ ore: 'Quantanium', raw: 10, yieldPct: 70, refinedScu: null }]);

  const c = cleanScan('cargo', { boxes: { 32: 2, 16: '3', 99: 5 }, totalScu: null });
  assert.equal(c.boxes['32'], 2); assert.equal(c.boxes['16'], 3); assert.equal('99' in c.boxes, false);

  const ct = cleanScan('contracts', { contracts: [{ title: 'Haul', type: 'hauling', payout: '45,000', cargo: [{ commodity: 'Gold', scu: 8 }], objectives: ['a'.repeat(500)] }, { nothing: true }] });
  assert.equal(ct.contracts.length, 1); assert.equal(ct.contracts[0].type, 'HAULING'); assert.equal(ct.contracts[0].payout, 45000); assert.equal(ct.contracts[0].objectives[0].length, 200);

  assert.equal(cleanScan('salvage', 'text'), null);
  assert.equal(cleanScan('nope', {}), null);
});

test('sniffImage trusts bytes, not the declared type', () => {
  assert.equal(sniffImage(JPEG), 'image/jpeg');
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(GIF), null);
  assert.equal(sniffImage(new Uint8Array(4)), null);
});

test('a good scan returns cleaned data and sends the right prompt and images to the model', async () => {
  const ai = aiReturning('{"seen":"salvage terminal","notes":[],"rmcScu":120,"rmcPrice":6000}');
  const e = env(ai);
  const res = await worker.fetch(scanRequest({ files: [JPEG, PNG] }), e, { waitUntil() {} });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.json();
  assert.equal(body.ok, true); assert.equal(body.data.rmcScu, 120); assert.equal(body.remaining, 14);
  const call = ai.calls[0];
  assert.match(call.input.messages[0].content, /rmcScu/);
  assert.equal(call.input.messages[1].content.filter((c) => c.type === 'image_url').length, 2);
  assert.match(call.input.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
});

test('requests are refused before the model is called: wrong origin, bad kind, bad files, too many, too big', async () => {
  const ai = aiReturning('{}');
  const e = env(ai);
  const run = async (opts) => (await worker.fetch(scanRequest(opts), e, { waitUntil() {} })).status;
  assert.equal(await run({ origin: 'https://evil.example' }), 403);
  assert.equal(await run({ origin: null }), 403);
  assert.equal(await run({ kind: 'describe-anything' }), 400);
  assert.equal(await run({ kind: null }), 400);
  assert.equal(await run({ files: [] }), 400);
  assert.equal(await run({ files: [GIF] }), 400);
  assert.equal(await run({ files: Array(MAX_IMAGES + 1).fill(JPEG) }), 400);
  assert.equal(await run({ files: [new Uint8Array(MAX_IMAGE_BYTES + 1).fill(0xff)] }), 413);
  const get = await worker.fetch(new Request('https://bureau.belpire.com/api/sc-scan'), e, { waitUntil() {} });
  assert.equal(get.status, 405);
  assert.equal(ai.calls.length, 0);
});

test('without the AI binding the endpoint says it is unavailable', async () => {
  const res = await worker.fetch(scanRequest(), { SC_DATA: memoryKV() }, { waitUntil() {} });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'unavailable');
});

test('per-visitor and whole-site daily limits stop scans without calling the model', async () => {
  const ai = aiReturning('{"seen":"x"}');
  const e = { ...env(ai), SC_SCAN_PER_IP: '2', SC_SCAN_DAILY: '3' };
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await handleScan(scanRequest(), e)).status);
  assert.deepEqual(codes, [200, 200, 429]);
  assert.equal((await handleScan(scanRequest({ ip: '198.51.100.9' }), e)).status, 200);
  const last = await handleScan(scanRequest({ ip: '198.51.100.10' }), e);
  assert.equal(last.status, 429);
  assert.equal(last.body.error, 'busy');
  assert.equal(ai.calls.length, 3);
});

test('counters hash the address and expire; no raw IP is stored', async () => {
  const e = { SC_DATA: { store: new Map(), async get(k) { return this.store.get(k) ?? null; }, async put(k, v, o) { this.store.set(k, { v, o }); } } };
  e.SC_DATA.get = async (k) => e.SC_DATA.store.get(k)?.v ?? null;
  await takeScan(e, new Request('https://x', { headers: { 'CF-Connecting-IP': '203.0.113.7' } }));
  const keys = [...e.SC_DATA.store.keys()];
  assert.ok(keys.every((k) => !k.includes('203.0.113.7')));
  assert.ok([...e.SC_DATA.store.values()].every((x) => x.o.expirationTtl > 0));
});

test('a model that fails or rambles gives a clean error, never raw model text', async () => {
  const bad = await handleScan(scanRequest(), env(aiReturning('I cannot help with that.')));
  assert.equal(bad.status, 502); assert.equal(bad.body.error, 'unreadable');
  const boom = await handleScan(scanRequest(), env(aiReturning(new Error('model exploded: secret detail'))));
  assert.equal(boom.status, 502); assert.equal(boom.body.error, 'scan_failed');
  assert.ok(!JSON.stringify(boom.body).includes('secret'));
});

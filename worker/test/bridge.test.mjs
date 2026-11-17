import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BRIDGE_URL, ALPHABET, parseBridge, watchMessage, helloMessage, normCode, retryDelay, MAX_RETRIES } from '../../site/bureau/rsi1/companion/bridge-core.js';

const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const dir = 'site/bureau/rsi1/companion/';

test('messages from the app: only four kinds, objects only, size capped', () => {
  assert.deepEqual(parseBridge('{"t":"hello","version":"0.0.2","snapshot":{"a":1}}'), { t: 'hello', version: '0.0.2', snapshot: { a: 1 } });
  assert.deepEqual(parseBridge('{"t":"hello"}'), { t: 'hello', version: '', snapshot: null });
  assert.deepEqual(parseBridge('{"t":"snapshot","data":{"blueprints":[]}}'), { t: 'snapshot', data: { blueprints: [] } });
  assert.deepEqual(parseBridge('{"t":"snapshot","data":[1]}'), { t: 'snapshot', data: null });
  assert.deepEqual(parseBridge('{"t":"ack","ok":true}'), { t: 'ack', ok: true });
  assert.deepEqual(parseBridge('{"t":"error","error":"x"}'), { t: 'error', error: 'x' });
  for (const bad of ['', 'x', '[]', 'null', '{"t":"other"}', '{"t":5}', 5, null, undefined, 'x'.repeat(700000)]) assert.equal(parseBridge(bad), null);
});
test('pairing codes and tokens are checked before anything is sent', () => {
  assert.equal(ALPHABET, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789');
  assert.equal(normCode('abcd-2345'), 'ABCD2345'); assert.equal(normCode(' wxyz 6789 '), 'WXYZ6789');
  for (const bad of ['', 'ABCD234', 'ABCD23456', 'ABCD234I', 'ABCD2340', null, undefined, 5]) assert.equal(normCode(bad), null);
  assert.equal(helloMessage({ code: 'abcd2345' }), '{"t":"hello","auth":{"code":"ABCD2345"}}');
  assert.equal(helloMessage({ token: 'b'.repeat(40), code: 'ABCD2345' }), `{"t":"hello","auth":{"token":"${'b'.repeat(40)}"}}`, 'a saved token wins');
  assert.equal(helloMessage({ token: 'zz', code: 'bad' }), null); assert.equal(helloMessage(), null);
  assert.deepEqual(parseBridge(`{"t":"auth","ok":true,"token":"${'c'.repeat(40)}"}`), { t: 'auth', ok: true, token: 'c'.repeat(40), locked: false });
  assert.deepEqual(parseBridge('{"t":"auth","ok":false,"locked":true}'), { t: 'auth', ok: false, token: '', locked: true });
  assert.deepEqual(parseBridge('{"t":"auth","ok":true,"token":"<script>"}'), { t: 'auth', ok: true, token: '', locked: false });
});
test('the only request the page can make is add or remove on the Watching list, with a plain key', () => {
  assert.equal(watchMessage('add', 'Pyro Core'), '{"t":"watch","op":"add","key":"pyrocore"}');
  assert.equal(watchMessage('remove', 'Arrow-BP'), '{"t":"watch","op":"remove","key":"arrowbp"}');
  for (const [op, key] of [['toggle', 'a'], ['add', ''], ['add', '!!!'], ['add', 'x'.repeat(101)], [undefined, 'a'], ['add', undefined]]) assert.equal(watchMessage(op, key), null);
});
test('the address is fixed to this PC and retries are few and slow down', () => {
  assert.equal(BRIDGE_URL, 'ws://127.0.0.1:47831/omniglass'); assert.equal(MAX_RETRIES, 3);
  assert.deepEqual([0, 1, 2, 3, 9].map(retryDelay), [1000, 2000, 4000, 8000, 30000]);
});
test('the first connection needs the pairing code; after that a saved token is enough; a wrong code is not retried', async () => {
  const store = new Map(); const events = []; const sockets = [];
  globalThis.window = { dispatchEvent: (e) => events.push(e.type) };
  globalThis.Event = class { constructor(t) { this.type = t; } };
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  globalThis.WebSocket = class { constructor(u) { this.url = u; this.sent = []; sockets.push(this); } send(m) { this.sent.push(m); } close() { this.closed = true; this.onclose?.(); } };
  const { initBridge } = await import('../../site/bureau/rsi1/companion/bridge.js');
  const TOKEN = 'a'.repeat(40);
  initBridge();
  assert.equal(sockets.length, 0, 'nothing connects by itself'); assert.equal(window.omniglass.status().state, 'off');
  assert.equal(window.omniglass.connect(''), false); assert.equal(window.omniglass.status().state, 'needcode'); assert.equal(sockets.length, 0, 'no code, no connection');
  assert.equal(window.omniglass.connect('abc'), false); assert.equal(window.omniglass.status().state, 'denied'); assert.equal(sockets.length, 0);
  assert.equal(window.omniglass.connect('abcd-2345'), true);
  assert.equal(sockets.length, 1); assert.equal(sockets[0].url, BRIDGE_URL); assert.equal(window.omniglass.status().state, 'connecting');
  assert.equal(window.omniglass.watch('add', 'x'), false, 'not before it is connected');
  sockets[0].onopen(); assert.deepEqual(sockets[0].sent, ['{"t":"hello","auth":{"code":"ABCD2345"}}']);
  sockets[0].onmessage({ data: JSON.stringify({ t: 'auth', ok: true, token: TOKEN }) });
  assert.equal(store.get('og.bridge.token'), TOKEN); assert.equal(window.omniglass.status().paired, true);
  sockets[0].onmessage({ data: JSON.stringify({ t: 'hello', version: '0.0.2', snapshot: { blueprints: ['A'], channel: 'live' } }) });
  assert.equal(window.omniglass.status().state, 'on'); assert.equal(window.omniglass.snapshot().app, 'omniglass-desktop'); assert.deepEqual(window.omniglass.snapshot().blueprints, ['A']);
  sockets[0].onmessage({ data: JSON.stringify({ t: 'snapshot', data: { blueprints: ['A', 'B'] } }) });
  assert.deepEqual(window.omniglass.snapshot().blueprints, ['A', 'B']);
  assert.equal(window.omniglass.watch('add', 'Pyro Core'), true); assert.equal(sockets[0].sent[1], '{"t":"watch","op":"add","key":"pyrocore"}');
  assert.equal(window.omniglass.watch('toggle', 'x'), false);
  assert.equal(store.get('og.bridge'), '1'); assert.ok(events.includes('omniglass-bridge'));
  window.omniglass.disconnect();
  assert.equal(window.omniglass.status().state, 'off'); assert.equal(window.omniglass.snapshot(), null); assert.equal(store.get('og.bridge'), '0'); assert.equal(store.get('og.bridge.token'), TOKEN, 'the pairing is kept');

  assert.equal(window.omniglass.connect(''), true, 'a saved token needs no code');
  sockets[1].onopen(); assert.deepEqual(sockets[1].sent, [`{"t":"hello","auth":{"token":"${TOKEN}"}}`]);
  sockets[1].onmessage({ data: JSON.stringify({ t: 'auth', ok: false, locked: false }) });
  assert.equal(window.omniglass.status().state, 'denied'); assert.equal(store.get('og.bridge.token'), undefined, 'a refused token is dropped'); assert.equal(sockets.length, 2, 'and nothing retries');
  assert.equal(window.omniglass.connect('ABCD2345'), true); sockets[2].onopen();
  sockets[2].onmessage({ data: JSON.stringify({ t: 'auth', ok: false, locked: true }) });
  assert.equal(window.omniglass.status().state, 'locked'); assert.equal(sockets.length, 3);

  store.set('og.bridge.token', TOKEN); store.set('og.bridge', '1'); initBridge();
  assert.equal(sockets.length, 4, 'a returning paired visit reconnects by itself'); assert.equal(window.omniglass.status().state, 'connecting');
  store.delete('og.bridge.token'); store.set('og.bridge', '1'); initBridge();
  assert.equal(sockets.length, 4, 'without a token it waits for the code'); assert.equal(window.omniglass.status().state, 'needcode');
  window.omniglass.unpair(); assert.equal(store.get('og.bridge.token'), undefined);
});
test('WebSocket appears in exactly one page script, and the page headers allow only that address', () => {
  const offenders = ['app.js', 'core.js', 'sync.js', 'local-core.js', 'local-ui.js', 'bridge-core.js'].filter((f) => /WebSocket/.test(read(dir + f)));
  assert.deepEqual(offenders, []); assert.match(read(dir + 'bridge.js'), /new WebSocket\(BRIDGE_URL\)/);
  assert.match(read('site/_headers'), /connect-src 'self' ws:\/\/127\.0\.0\.1:47831 ws:\/\/localhost:47831;/);
  assert.doesNotMatch(read(dir + 'bridge.js') + read(dir + 'bridge-core.js') + read(dir + 'local-ui.js'), /innerHTML|insertAdjacentHTML|fetch\(|XMLHttpRequest|sendBeacon|eval\(|new Function/);
  assert.match(read(dir + 'app.js'), /initBridge\(\);\s*initLocal\(\);/);
});

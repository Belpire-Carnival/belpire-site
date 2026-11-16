import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readLocal, dataLine } from '../../site/bureau/rsi1/companion/local-core.js';

const read = (f) => readFileSync(new URL(`../../site/bureau/rsi1/companion/${f}`, import.meta.url), 'utf8');

test('local data: only trusted from OmniGlass Desktop, and cleaned', () => {
  assert.equal(readLocal(undefined), null); assert.equal(readLocal({ app: 'other' }), null); assert.equal(readLocal('x'), null);
  const s = readLocal({ app: 'omniglass-desktop', channel: 'ptu', dataBuild: '5.0.0', blueprints: ['A', 5, 'B'], ranks: { 'x|y': 'Jr' }, recent: [{ label: 'L', detail: 'D', tone: '<b>', ts: 't' }, { nope: 1 }] });
  assert.deepEqual(s.blueprints, ['A', 'B']); assert.equal(s.ranks, 1); assert.equal(s.channel, 'ptu'); assert.equal(s.recent.length, 1); assert.equal(s.recent[0].tone, 'info');
  assert.equal(dataLine(s), 'Game data: PTU 5.0.0');
});
test('local data: the pending marker is accepted and shows empty lists', () => {
  const s = readLocal({ v: 1, app: 'omniglass-desktop', pending: true });
  assert.equal(s.pending, true); assert.deepEqual(s.blueprints, []); assert.equal(s.channel, 'live');
});
test('the local-data script is read-only: no requests, no HTML injection, no outside origins', () => {
  for (const f of ['local-core.js', 'local-ui.js']) {
    const t = read(f);
    assert.doesNotMatch(t, /innerHTML|insertAdjacentHTML|fetch\(|XMLHttpRequest|WebSocket|sendBeacon|eval\(|new Function|https?:\/\//, f);
  }
});
test('the page has the local card and the Wardrobe replacement, and the Wardrobe link leaves the app through ?browser=1', () => {
  const html = read('index.html'), css = read('companion.css'), app = read('app.js');
  assert.match(html, /id="localGame"/); assert.match(html, /id="wardrobeApp"/); assert.match(html, /href="\/rsi1\/companion\/\?browser=1#wardrobe"/);
  assert.match(css, /\.in-app #wardrobe \{ display: none; \}/); assert.match(app, /initLocal\(\);/);
});

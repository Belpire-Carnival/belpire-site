import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, COMMANDS } from '../../site/bureau/rsi1/companion/voice.js';

test('voice parse: module names map to views', () => {
  assert.deepEqual(parse('Missions.'), { type: 'view', id: 'contracts' });
  assert.deepEqual(parse('go to my fleet'), { type: 'view', id: 'fleet' });
  assert.deepEqual(parse('Open avionics'), { type: 'view', id: 'calc' });
});
test('voice parse: menu, scroll, unknown', () => {
  assert.deepEqual(parse('open the menu'), { type: 'menu', open: true });
  assert.deepEqual(parse('close menu'), { type: 'menu', open: false });
  assert.equal(parse('scroll down').dir, 1);
  assert.equal(parse('banana'), null);
  assert.equal(parse(''), null);
});
test('every command targets a real view id', () => {
  const ids = new Set(['ops','contracts','log','salvage','mining','trade','cargo','calc','combat','fleet','manual']);
  for (const [, id] of COMMANDS) assert.ok(ids.has(id), id);
});

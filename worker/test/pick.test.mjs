import { test } from 'node:test';
import assert from 'node:assert/strict';
import { norm, rank, exact } from '../../site/bureau/rsi1/companion/pick-core.js';

const ships = ['Hyūn', 'Hawk', 'Hull C', 'Cutlass Black', 'Cutlass Red', 'Carrack', 'CF-337 Panther Repeater', 'Mantis GT-220 Gatling'];

test('norm ignores case, accents and punctuation', () => {
  assert.equal(norm('Hyūn'), 'hyun');
  assert.equal(norm('  CF-337  Panther '), 'cf 337 panther');
});
test('rank puts names that start with the text first', () => {
  assert.deepEqual(rank(ships, 'cut'), ['Cutlass Red', 'Cutlass Black']);
  assert.equal(rank(ships, 'hyun')[0], 'Hyūn');
});
test('rank finds word starts, partial words and every-word matches', () => {
  assert.ok(rank(ships, 'black').includes('Cutlass Black'));
  assert.ok(rank(ships, 'cf 337').includes('CF-337 Panther Repeater'));
  assert.ok(rank(ships, 'panther 337').includes('CF-337 Panther Repeater'));
  assert.deepEqual(rank(ships, 'zzz'), []);
});
test('rank respects the limit and drops duplicates', () => {
  assert.equal(rank(ships, '', 3).length, 3);
  assert.deepEqual(rank(['A', 'a', 'A '], 'a'), ['A']);
});
test('exact returns the list spelling or nothing', () => {
  assert.equal(exact(ships, 'hyun'), 'Hyūn');
  assert.equal(exact(ships, 'cutlass'), '');
  assert.equal(exact(ships, ''), '');
});

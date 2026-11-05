import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { COINS, coinFor, coinLadder } from '../coins.js';

test('the coin ladder: 15 district tiers, rising, The Gate to The Witching Hour', () => {
  assert.equal(COINS.length, 15);
  assert.deepEqual(COINS.map((c) => c.min), [0, 125, 500, 1100, 2000, 3200, 5000, 7200, 10000, 13500, 18000, 24000, 31000, 42424, 666666]);
  assert.equal(COINS[0].name, 'The Gate');
  assert.equal(COINS.at(-1).name, 'The Witching Hour');
  assert.equal(new Set(COINS.map((c) => c.slug)).size, 15);
});

test('coinFor picks by lifetime Slivers won', () => {
  assert.equal(coinFor(0).name, 'The Gate');
  assert.equal(coinFor(-5).name, 'The Gate');
  assert.equal(coinFor(124).name, 'The Gate');
  assert.equal(coinFor(125).name, 'The Ticket Booth');
  assert.deepEqual(coinFor(42423).next, { name: 'The Main Stage', min: 42424, need: 1 });
  assert.equal(coinFor(42424).tier, 14);
  assert.equal(coinFor(666665).name, 'The Main Stage');
  assert.equal(coinFor(666666).name, 'The Witching Hour');
  assert.equal(coinFor(666666).next, null);
});

test('every coin has all three image sizes on disk', () => {
  for (const c of coinLadder()) {
    for (const path of [c.icon, c.thumb, c.image]) assert.ok(existsSync(new URL(`../../site${path}`, import.meta.url)), path);
  }
});

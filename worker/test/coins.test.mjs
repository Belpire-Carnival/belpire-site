import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { COINS, coinFor, coinLadder } from '../coins.js';

test('the coin ladder: 11 coins, rising, Shattered to Crimson Rare', () => {
  assert.equal(COINS.length, 11);
  assert.equal(COINS[0].min, 0);
  for (let i = 1; i < COINS.length; i++) assert.ok(COINS[i].min > COINS[i - 1].min);
  assert.equal(COINS.at(-1).name, 'Crimson Rare');
  assert.equal(COINS.at(-1).min, 666666);
  assert.equal(COINS.find((c) => c.name === 'Gold').min, 5000);
});

test('coinFor picks by the balance held now', () => {
  assert.equal(coinFor(0).name, 'Shattered');
  assert.equal(coinFor(-5).name, 'Shattered');
  assert.equal(coinFor(99).name, 'Shattered');
  assert.equal(coinFor(100).name, 'Chipped');
  assert.equal(coinFor(4999).name, 'Brass');
  assert.deepEqual(coinFor(4999).next, { name: 'Gold', min: 5000, need: 1 });
  assert.equal(coinFor(5000).name, 'Gold');
  assert.equal(coinFor(666665).name, 'Gilded');
  assert.equal(coinFor(666666).name, 'Crimson Rare');
  assert.equal(coinFor(666666).next, null);
  assert.equal(coinFor(666666).level, 11);
});

test('every coin has both image sizes on disk', () => {
  for (const c of coinLadder()) {
    for (const path of [c.icon, c.image]) assert.ok(existsSync(new URL(`../../site${path}`, import.meta.url)), path);
  }
});

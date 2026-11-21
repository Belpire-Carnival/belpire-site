import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { allGames, fitting, pickOne, playerLabel } from '../../site/jackbox/pick.js';

const data = JSON.parse(await readFile(new URL('../../site/jackbox/packs.json', import.meta.url), 'utf8'));

test('packs.json is well formed', () => {
  const styles = Object.keys(data.styles);
  assert.ok(styles.length >= 3);
  const appids = new Set();
  for (const p of data.packs) {
    assert.ok(Number.isInteger(p.appid) && p.appid > 0, `${p.name}: appid`);
    assert.ok(!appids.has(p.appid), `${p.name}: duplicate appid`);
    appids.add(p.appid);
    assert.ok(p.name && p.short, `${p.name}: names`);
    assert.ok(p.year >= 2014 && p.year <= 2030, `${p.name}: year`);
    assert.ok(p.games.length >= 1, `${p.name}: games`);
    for (const g of p.games) {
      assert.ok(g.name, `${p.name}: game name`);
      assert.ok(Number.isInteger(g.min) && Number.isInteger(g.max) && g.min >= 1 && g.min <= g.max, `${g.name}: player range`);
      assert.ok(styles.includes(g.style), `${g.name}: style ${g.style}`);
    }
  }
});

test('flattening keeps every game with its box', () => {
  const games = allGames(data.packs);
  assert.equal(games.length, data.packs.reduce((n, p) => n + p.games.length, 0));
  const tmp = games.find((g) => g.name === 'Trivia Murder Party');
  assert.equal(tmp.pack, 'Pack 3');
});

const sample = [
  { name: 'Small', min: 1, max: 4, style: 'trivia', year: 2015 },
  { name: 'Mid', min: 3, max: 8, style: 'writing', year: 2021 },
  { name: 'Big', min: 3, max: 16, style: 'writing', year: 2017 }
];

test('fitting respects player count, style and box age', () => {
  assert.deepEqual(fitting(sample, { players: 2 }).map((g) => g.name), ['Small']);
  assert.deepEqual(fitting(sample, { players: 10 }).map((g) => g.name), ['Big']);
  assert.deepEqual(fitting(sample, { players: 4, style: 'writing' }).map((g) => g.name), ['Mid', 'Big']);
  assert.deepEqual(fitting(sample, { players: 4, newerOnly: true }).map((g) => g.name), ['Mid']);
  assert.deepEqual(fitting(sample, { players: 20 }), []);
});

test('pickOne avoids repeating the last pick', () => {
  const two = sample.slice(1);
  for (let i = 0; i < 20; i++) assert.equal(pickOne(two, 'Mid').name, 'Big');
  assert.equal(pickOne([sample[0]], 'Small').name, 'Small');
  assert.equal(pickOne([], null), null);
  assert.equal(pickOne(sample, null, () => 0).name, 'Small');
});

test('player labels read naturally', () => {
  assert.equal(playerLabel({ min: 3, max: 8 }), '3–8 players');
  assert.equal(playerLabel({ min: 2, max: 2 }), '2 players');
  assert.equal(playerLabel({ min: 1, max: 1 }), '1 player');
});

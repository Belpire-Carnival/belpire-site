import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, buildIndex, suggest, matchesSearch, sourceLabel } from '../../site/search.mjs';

const feed = {
  tracked: [
    { appid: 1966720, name: 'Lethal Company', tent: 'horror' },
    { appid: 2221490, name: 'The Division 2', tent: 'other' },
    { appid: 365590, name: 'The Division', tent: 'other' },
    { appid: 3241660, name: 'R.E.P.O.', tent: 'horror' },
    { appid: 3097560, name: "Liar's Bar", tent: 'party' }
  ],
  favorites: [{ appid: 1966720, name: 'Lethal Company', tent: 'horror', title: 'v70 patch' }],
  upcoming: [
    { appid: 900001, name: 'Lethal Lanterns', tent: 'horror' },
    { appid: 900002, name: 'Pokémon Party Palace', tent: 'party' }
  ]
};
const index = buildIndex(feed);

test('normalize folds case, accents and punctuation', () => {
  assert.equal(normalize('Pokémon: Party & Palace!'), 'pokemon party and palace');
  assert.equal(normalize('R.E.P.O.'), 'r e p o');
});

test('index merges sources per game', () => {
  const lethal = index.find((e) => e.appid === 1966720);
  assert.deepEqual([...lethal.sources].sort(), ['news', 'tracked']);
  assert.equal(index.length, 7);
  assert.equal(sourceLabel(lethal), 'Patch notes');
  assert.equal(sourceLabel(index.find((e) => e.appid === 900001)), 'Coming soon');
  assert.equal(sourceLabel(index.find((e) => e.appid === 365590)), 'Tracked');
});

test('suggestions match word starts and rank prefix hits first', () => {
  assert.deepEqual(suggest(index, 'leth').map((e) => e.name), ['Lethal Company', 'Lethal Lanterns']);
  assert.deepEqual(suggest(index, 'div 2').map((e) => e.name), ['The Division 2']);
  assert.deepEqual(suggest(index, 'division').map((e) => e.name), ['The Division', 'The Division 2']);
  assert.deepEqual(suggest(index, 'pokemon').map((e) => e.name), ['Pokémon Party Palace']);
  assert.deepEqual(suggest(index, 'liars').map((e) => e.name), []); // "liar s" — apostrophe splits the word
  assert.deepEqual(suggest(index, 'liar').map((e) => e.name), ["Liar's Bar"]);
  assert.deepEqual(suggest(index, 'company').map((e) => e.name), ['Lethal Company']);
  assert.deepEqual(suggest(index, ''), []);
  assert.equal(suggest(index, 'e', 3).length <= 3, true);
});

test('matchesSearch: exact app for a picked game, word starts for free text', () => {
  const item = { appid: 2221490, name: 'The Division 2' };
  assert.equal(matchesSearch(item, null), true);
  assert.equal(matchesSearch(item, { appid: 2221490, name: 'The Division 2' }), true);
  assert.equal(matchesSearch({ appid: 365590, name: 'The Division' }, { appid: 2221490 }), false);
  assert.equal(matchesSearch(item, { text: 'div' }), true);
  assert.equal(matchesSearch(item, { text: 'vision' }), false);
});

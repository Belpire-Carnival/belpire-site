import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProfile, dedupeMembers, overlap, isMultiplayer, suggestTent, parseStoreTags, sideshowTags, searchesFor, redact, renderReport } from './crew-overlap.mjs';

test('parses every Steam profile link style', () => {
  assert.deepEqual(parseProfile('https://steamcommunity.com/profiles/76561190000000001/'), { steamid: '76561190000000001' });
  assert.deepEqual(parseProfile('https://steamcommunity.com/id/Some_Name/'), { vanity: 'Some_Name' });
  assert.deepEqual(parseProfile('76561190000000002'), { steamid: '76561190000000002' });
  assert.deepEqual(parseProfile('some-name'), { vanity: 'some-name' });
  assert.equal(parseProfile('https://example.com/nope'), null);
});

test('duplicate crew entries are dropped', () => {
  const { members, dupes } = dedupeMembers([{ steamid: '1' }, { steamid: '2' }, { steamid: '1' }, { vanity: 'A' }, { vanity: 'a' }]);
  assert.equal(members.length, 3);
  assert.equal(dupes.length, 2);
});

const libs = [
  { name: 'A', games: [{ appid: 10, name: 'Shared Co-op', playtime_forever: 600 }, { appid: 20, name: 'Two Owners', playtime_forever: 30 }, { appid: 30, name: 'Only A', playtime_forever: 9000 }] },
  { name: 'B', games: [{ appid: 10, name: 'Shared Co-op', playtime_forever: 120 }, { appid: 20, name: 'Two Owners', playtime_forever: 0 }] },
  { name: 'C', games: [{ appid: 10, name: 'Shared Co-op', playtime_forever: 0 }] }
];

test('overlap keeps games owned by enough of the crew, most shared first', () => {
  const rows = overlap(libs, 2);
  assert.deepEqual(rows.map((r) => r.appid), [10, 20]);
  assert.equal(rows[0].owners.length, 3);
  assert.equal(rows[0].players, 2); // A and B played an hour or more
  assert.equal(rows[0].minutes, 720);
  assert.deepEqual(overlap(libs, 3).map((r) => r.appid), [10]);
});

test('multiplayer detection and tent suggestions', () => {
  assert.equal(isMultiplayer({ categories: [{ id: 2 }, { id: 38 }] }), true);
  assert.equal(isMultiplayer({ categories: [{ id: 2 }] }), false);
  assert.equal(isMultiplayer(null), false);
  assert.equal(suggestTent(['Survival Horror', 'Co-op']), 'horror');
  assert.equal(suggestTent(['Party Game']), 'party');
  assert.equal(suggestTent(['Looter Shooter', 'Co-op']), 'other');
});

test('store tags are read in order', () => {
  const html = '<a href="x" class="app_tag" style="">\n\t\tSurvival\t</a><a class="app_tag">Open World</a><a class="app_tag">Crafting &amp; Building</a><a class="app_tag">+</a>';
  assert.deepEqual(parseStoreTags(html), ['Survival', 'Open World', 'Crafting & Building']);
});

test('sideshow tags skip horror, party and generic tags and favor what the crew plays', () => {
  const rows = [
    { multiplayer: true, owners: ['A', 'B', 'C'], minutes: 6000, tags: ['Survival', 'Horror', 'Multiplayer', 'Crafting'] },
    { multiplayer: true, owners: ['A', 'B'], minutes: 60, tags: ['Racing', 'Party Game'] },
    { multiplayer: false, owners: ['A', 'B', 'C'], minutes: 99999, tags: ['Puzzle'] }
  ];
  const tags = sideshowTags(rows, 3);
  assert.deepEqual(tags, ['Survival', 'Crafting', 'Racing']);
  assert.deepEqual(searchesFor(['Survival']), [{ tent: 'other', tags: ['Online Co-Op', 'Survival'] }]);
});

test('the API key never appears in error text', () => {
  const key = 'A'.repeat(32);
  assert.equal(redact(`failed https://api.steampowered.com/x?key=${key}`, key), 'failed https://api.steampowered.com/x?key=***');
});

test('report lists new shared games, tracked ones, skipped members and search suggestions', () => {
  const md = renderReport({
    crew: [{ name: 'A', count: 3 }, { name: 'B', count: 2 }],
    skipped: ['C'],
    dupes: [],
    rows: [
      { appid: 10, name: 'Shared Co-op', owners: ['A', 'B'], players: 2, minutes: 720, multiplayer: true, tent: 'other', tags: ['Survival'] },
      { appid: 99, name: 'Already Here', owners: ['A', 'B'], players: 1, minutes: 60, multiplayer: true, tent: 'horror', tags: [] }
    ],
    tracked: new Set([99]),
    tags: ['Survival'],
    minOwners: 2,
    generated: '2026-10-26 17:00'
  });
  assert.match(md, /\| Shared Co-op \| 2 \| 2 \| 12 \| other \| Survival \|/);
  assert.match(md, /\{ "appid": 10, "name": "Shared Co-op", "tent": "other" \}/);
  assert.match(md, /Already Here \(2 owners/);
  assert.match(md, /Skipped.*C/);
  assert.match(md, /"Online Co-Op","Survival"/);
});

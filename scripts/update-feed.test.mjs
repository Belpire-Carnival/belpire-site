import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, classifyNews, parseSearchAppIds, pickChips } from './update-feed.mjs';

test('cleanText strips BBCode, HTML, images and links', () => {
  const raw = '[h1]Patch 1.2[/h1] {STEAM_CLAN_IMAGE}/abc/x.png [b]Fixed[/b] the <i>lantern</i> bug &amp; more https://example.com';
  assert.equal(cleanText(raw), 'Patch 1.2 Fixed the lantern bug & more');
});

test('cleanText truncates on a word boundary', () => {
  const out = cleanText('one two three four five six', 12);
  assert.equal(out, 'one two…');
});

test('classifyNews', () => {
  assert.equal(classifyNews({ title: 'Hotfix 0.9.3', tags: [] }), 'PATCH');
  assert.equal(classifyNews({ title: 'Whatever', tags: ['patchnotes'] }), 'PATCH');
  assert.equal(classifyNews({ title: 'Halloween Event is live', tags: [] }), 'EVENT');
  assert.equal(classifyNews({ title: 'Dev diary #4', tags: [] }), 'NEWS');
});

test('parseSearchAppIds dedupes and keeps order', () => {
  const html = '<a data-ds-appid="111" ...></a><a data-ds-appid="222"></a><a data-ds-appid="111"></a>';
  assert.deepEqual(parseSearchAppIds(html), [111, 222]);
});

test('pickChips prefers Online Co-op over generic co-op/multiplayer', () => {
  const cats = [{ description: 'Multi-player' }, { description: 'Co-op' }, { description: 'Online Co-op' }, { description: 'Steam Achievements' }];
  assert.deepEqual(pickChips(cats), ['Online Co-op']);
});

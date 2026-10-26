import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseReleasesAtom, releasesFeedUrl } from '../github.js';
import { buildSnapshot } from '../star-citizen.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('parses versioned releases and ignores off-site links', () => {
  const r = parseReleasesAtom(fixture('smart-citizen.atom'), 'Osiris-DevWorks/smart-citizen');
  assert.deepEqual(r.map((x) => x.tag), ['v2.4.0', 'v2.3.1']);
  assert.deepEqual(r[0], {
    tag: 'v2.4.0',
    title: 'Smart Citizen v2.4.0',
    updated: '2026-10-11T17:17:00.000Z',
    url: 'https://github.com/Osiris-DevWorks/smart-citizen/releases/tag/v2.4.0'
  });
});

test('parses rolling LIVE/PTU releases (StarStrings)', () => {
  const r = parseReleasesAtom(fixture('starstrings.atom'), 'MrKraken/StarStrings');
  assert.deepEqual(r.map((x) => [x.tag, x.title]), [
    ['latest-ptu', 'SC PTU Build (release-2026-10-23-c195ea1)'],
    ['latest', 'SC LIVE Build (release-2026-10-09-292e6be)']
  ]);
});

test('rejects malformed repo names', () => {
  assert.equal(releasesFeedUrl('MrKraken/StarStrings'), 'https://github.com/MrKraken/StarStrings/releases.atom');
  assert.throws(() => releasesFeedUrl('../../etc'));
  assert.throws(() => releasesFeedUrl('a/b/c'));
});

test('release feeds are fetched at most hourly and kept when GitHub fails', async () => {
  const realFetch = globalThis.fetch;
  let githubCalls = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.startsWith('https://github.com/')) {
      githubCalls++;
      return new Response('nope', { status: 503 });
    }
    return new Response('{}', { status: 500 });
  };
  try {
    const prev = { releases: { 'MrKraken/StarStrings': [{ tag: 'latest' }] }, releasesCheckedAt: new Date().toISOString() };
    const recent = await buildSnapshot(prev);
    assert.equal(githubCalls, 0, 'recently checked: no GitHub calls');
    assert.deepEqual(recent.releases, prev.releases);

    const old = { ...prev, releasesCheckedAt: new Date(Date.now() - 2 * 3600e3).toISOString() };
    const snap = await buildSnapshot(old);
    assert.equal(githubCalls, 2);
    assert.deepEqual(snap.releases['MrKraken/StarStrings'], [{ tag: 'latest' }], 'previous data kept on failure');
    assert.ok(snap.errors.some((e) => e.startsWith('releases MrKraken/StarStrings')));
  } finally {
    globalThis.fetch = realFetch;
  }
});

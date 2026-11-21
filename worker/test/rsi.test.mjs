import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCommLink, parseStatus, parseIssues, parseCStateDate, normalizeStatus, decodeEntities } from '../rsi.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('parseCommLink reads the hub blocks, dedupes and rejects off-site links', () => {
  const items = parseCommLink(fixture('commlink.html'));
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], {
    id: '21390',
    channel: 'transmission',
    type: 'post',
    title: 'Example Roundup - October 21, 2026',
    summary: 'A short placeholder summary with an apostrophe’s entity & an ampersand.',
    posted: '5 days ago',
    url: 'https://robertsspaceindustries.com/comm-link/transmission/21390-Example-Roundup-October-21-2026'
  });
  assert.equal(items[1].type, 'video');
  assert.equal(items[1].title, 'Example | Behind the Ships : Video');
  assert.equal(items[2].channel, 'engineering');
  assert.equal(items[2].title, 'Q&A: Example Ship');
  assert.equal(items[2].summary, 'Placeholder engineering summary.');
});

test('parseCommLink returns [] for an unrecognised page', () => {
  assert.deepEqual(parseCommLink('<html><body>redesigned</body></html>'), []);
});

test('parseStatus normalises cState systems and unresolved issues', () => {
  const s = parseStatus(fixture('status.json'));
  assert.equal(s.summary, 'degraded');
  assert.deepEqual(s.systems.map((x) => [x.name, x.status]), [
    ['Platform', 'operational'],
    ['Persistent Universe', 'degraded'],
    ['Arena Commander', 'operational']
  ]);
  assert.equal(s.systems[1].unresolved[0].title, 'Live Services Disruption');
  assert.match(s.systems[1].unresolved[0].url, /^https:\/\/status\.robertsspaceindustries\.com\/issues\//);
});

test('parseIssues sorts newest first and parses cState dates', () => {
  const issues = parseIssues(fixture('issues.json'));
  assert.deepEqual(issues.map((i) => i.id), [
    '2026-10-26_live-services-disruption.md',
    '2026-10-21_rsi-platform-maintenance.md',
    '2026-10-09_live-deployment.md'
  ]);
  assert.equal(issues[0].resolved, false);
  assert.equal(issues[1].createdAt, '2026-10-21T14:30:00.000Z');
  assert.equal(issues[1].resolvedAt, '2026-10-22T05:00:00.000Z');
  assert.deepEqual(issues[2].affected, ['Persistent Universe', 'Arena Commander']);
});

test('dates, statuses and entities', () => {
  assert.equal(parseCStateDate('2026-10-22 07:43:38 -0400 -0400'), '2026-10-22T11:43:38.000Z');
  assert.equal(parseCStateDate('garbage'), null);
  assert.equal(normalizeStatus('disrupted'), 'degraded');
  assert.equal(normalizeStatus('down'), 'down');
  assert.equal(normalizeStatus('maintenance'), 'maintenance');
  assert.equal(normalizeStatus('???'), 'unknown');
  assert.equal(decodeEntities('Let&#8217;s &amp; &#x2014; &bogus;'), 'Let’s & — &bogus;');
});

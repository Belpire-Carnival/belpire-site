import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRACKED_REPOS } from '../star-citizen.js';

const tools = JSON.parse(readFileSync(new URL('../../site/star-citizen/tools.json', import.meta.url), 'utf8'));
const KINDS = ['web', 'app', 'overlay', 'extension', 'game-file'];

test('every tool has a name, an https link, a known kind and a description', () => {
  let count = 0;
  for (const cat of tools.categories) {
    assert.ok(cat.name, 'category name');
    for (const t of cat.tools) {
      count++;
      assert.ok(t.name, 'tool name');
      assert.equal(new URL(t.url).protocol, 'https:', `${t.name} url must be https`);
      assert.ok(KINDS.includes(t.kind), `${t.name} kind "${t.kind}"`);
      assert.ok(t.description && t.description.length <= 220, `${t.name} description length`);
    }
  }
  assert.ok(count >= 10);
});

test('tools that show releases are tracked by the Worker', () => {
  for (const cat of tools.categories)
    for (const t of cat.tools)
      if (t.releases) assert.ok(TRACKED_REPOS.includes(t.releases.repo), `${t.releases.repo} must be in TRACKED_REPOS`);
});

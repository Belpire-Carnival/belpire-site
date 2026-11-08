// Guards for the Star Citizen companion page (site/bureau/rsi1/companion/): it must obey the site's strict CSP
// and rules (no inline script or style, no third-party origins, no innerHTML with data).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../../site/bureau/rsi1/companion/${f}`, import.meta.url), 'utf8');
const html = read('index.html');
const app = read('app.js');
const core = read('core.js');
const sync = read('sync.js');

test('the page has no inline scripts, styles or event handlers', () => {
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, 'inline <script>');
  assert.doesNotMatch(html, /\sstyle\s*=/i, 'style attribute');
  assert.doesNotMatch(html, /<style[\s>]/i, '<style> block');
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'inline event handler');
  assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com/);
});

test('scripts never call a third-party origin: only our own /api paths', () => {
  const urls = [...app.matchAll(/fetch\(\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2]);
  assert.ok(urls.length >= 3);
  for (const u of urls) assert.match(u, /^\/api\//, `fetch to ${u}`);
  assert.doesNotMatch(app + core, /XMLHttpRequest|WebSocket|sendBeacon|eval\(|new Function/);
});

test('innerHTML is limited to the fixed checklist strings, and style is never set as an attribute', () => {
  assert.equal((app.match(/innerHTML/g) || []).length, 1);
  assert.match(app, /t\.innerHTML = html;/);
  assert.match(app, /inline styles are not allowed/);
  assert.doesNotMatch(app, /setAttribute\(\s*['"]style['"]/);
});

test('links from the page are https or relative', () => {
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) assert.match(href, /^(https:\/\/|\.\.?\/|#|\/|companion\.css$)/, href);
  for (const [, u] of app.matchAll(/href="(https?:[^"]+)"/g)) assert.match(u, /^https:/, u);
});

test('the page carries the unofficial-fan-site disclaimer and credits its data sources', () => {
  assert.match(html, /unofficial Star Citizen fan tool/);
  assert.match(html, /UEX/);
  assert.match(html, /api\.star-citizen\.wiki/);
});

test('the sign-in and sync script only talks to our own profile API and sign-out, and builds its page with text', () => {
  assert.match(sync, /const API = '\/api\/companion\/profile';/);
  const urls = [...sync.matchAll(/fetch\(\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2]);
  assert.deepEqual(urls, ['/auth/logout']);
  assert.doesNotMatch(sync, /innerHTML|insertAdjacentHTML|XMLHttpRequest|WebSocket|sendBeacon|eval\(|new Function|setAttribute\(\s*['"]style['"]|\.style\./);
  assert.doesNotMatch(sync, /https?:\/\//);
  assert.match(html, /id="acct"/);
});

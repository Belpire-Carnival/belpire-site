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
const builder = read('builder.js');
const builderCore = read('builder-core.js');
const viz = read('viz.js');
const art = read('art.js');

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
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) assert.match(href, /^(https:\/\/|\.\.?\/|#|\/|companion\.css$|omniglass\.svg$)/, href);
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

test('the ship builder only reads our own /api/sc-builder, builds its page with text, and is credited', () => {
  const urls = [...builder.matchAll(/fetch\(\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2]);
  assert.deepEqual(urls, []); // the endpoint is a named constant, checked below
  assert.match(builder, /const API = '\/api\/sc-builder';/);
  assert.match(builder, /fetch\(API,/);
  assert.match(builder, /const SHOP_API = '\/api\/sc-shop';/);
  assert.match(builder, /fetch\(SHOP_API,/);
  assert.doesNotMatch(builder + builderCore, /innerHTML|insertAdjacentHTML|XMLHttpRequest|WebSocket|sendBeacon|eval\(|new Function|setAttribute\(\s*['"]style['"]|\.style\./);
  assert.doesNotMatch(builder + builderCore, /https?:\/\//);
  assert.match(html, /id="builder"/);
  assert.match(builder, /Star Citizen Wiki API/);
});

test('the drawing helpers build SVG with attributes only and reach no other origin', () => {
  assert.doesNotMatch(viz + art, /innerHTML|insertAdjacentHTML|XMLHttpRequest|WebSocket|sendBeacon|eval\(|new Function|setAttribute\(\s*['"]style['"]|\.style\.|fetch\(/);
  assert.doesNotMatch(viz + art, /https?:\/\/(?!www\.w3\.org\/2000\/svg|media\.starcitizen\.tools\/)/);
  assert.doesNotMatch(builder, /\bhref\s*=|<img|src\s*=/);
});

test('the page has a left rail, a calculator view, and a banner for every view', () => {
  assert.match(html, /<header class="top">[\s\S]*<nav id="nav"/);
  assert.match(html, /id="v-calc"/);
  const views = [...html.matchAll(/<section class="view" id="v-([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(views.includes('calc'));
  for (const v of views) assert.match(html, new RegExp(`id="h-${v}"`), v);
  assert.equal((html.match(/class="hero"/g) || []).length, views.length);
});

test('every navigation item has an icon and a view', () => {
  const nav = [...app.matchAll(/\['([a-z]+)', '[^']+'\]/g)].map((m) => m[1]);
  const icons = [...viz.matchAll(/^\s{2}([a-z]+):\s*\[/gm)].map((m) => m[1]);
  const views = [...html.matchAll(/<section class="view" id="v-([a-z]+)"/g)].map((m) => m[1]);
  for (const v of views) { assert.ok(icons.includes(v), `icon for ${v}`); assert.ok(nav.includes(v), `nav for ${v}`); }
});

test('six hubs hold every view once, and each hub keeps old links working', () => {
  const hubs = [...app.matchAll(/\{ id: '([a-z]+)', label: '[^']+', icon: '([a-z]+)', blurb: '[^']+', panes: \[(.*?)\] \}/g)];
  assert.equal(hubs.length, 6);
  const panes = hubs.flatMap((m) => [...m[3].matchAll(/\['([a-z]+)', '[^']+'\]/g)].map((x) => x[1]));
  const views = [...html.matchAll(/<section class="view" id="v-([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...panes].sort(), [...views].sort());
  assert.equal(new Set(panes).size, panes.length);
  for (const [, , icon] of hubs) assert.match(viz, new RegExp(`^\\s{2}${icon}:\\s*\\[`, 'm'), icon);
  assert.match(html, /id="subtabs"/);
  assert.match(html, /id="v-guide"/);
  assert.match(html, /id="opsMap"/);
  assert.match(app, /document\.body\.dataset\.v = pane/);
});

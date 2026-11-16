// belpire-site: the companion inside the OmniGlass desktop app (?embed=desktop), and wording for the System upkeep tools.
import fs from 'node:fs';
import path from 'node:path';
const dir = 'site/bureau/rsi1/companion/';
function edit(file, fn) {
  const raw = fs.readFileSync(file, 'utf8'); const crlf = raw.includes('\r\n');
  const s = fn(raw.replace(/\r\n/g, '\n'));
  fs.writeFileSync(file, crlf ? s.replace(/\n/g, '\r\n') : s);
}
function sub(s, from, to) { const n = s.split(from).length - 1; if (n !== 1) throw new Error(`${from.slice(0, 70)}: expected 1 match, found ${n}`); return s.replace(from, () => to); }

edit(dir + 'app.js', (s) => sub(s, "import { learnZones } from './risk.js';\n",
`import { learnZones } from './risk.js';

// Inside the OmniGlass desktop app the page is told so before it runs (window.__OMNIGLASS_OS__) and by ?embed=desktop. The CSS then drops the
// site's own brand and the download card, because the app draws its own header and the page is already installed.
if (new URLSearchParams(location.search).get('embed') === 'desktop' || window.__OMNIGLASS_OS__?.embed === 'desktop') document.documentElement.classList.add('embed-desktop');
`));

edit(dir + 'companion.css', (s) => s.replace(/\n*$/, '\n') + `
/* ================= inside the OmniGlass desktop app (?embed=desktop) ================= */
.embed-desktop .brand .id,.embed-desktop .brand::after,.embed-desktop #desktopDownload{display:none}
.embed-desktop header.top{min-height:0;padding-top:2px;padding-bottom:2px}
`);

edit(dir + 'index.html', (s) => {
  s = sub(s, 'It only changes game files if you switch on the optional Field Notes, and that can be rolled back.',
    'It only changes game files if you switch on an optional tool: Field Notes (two text files, with a roll back) or System upkeep (two borderless lines in user.cfg, which can be put back, and clearing the shader cache, which cannot be undone).');
  s = sub(s, '<b>The one optional feature that writes</b> is <i>Field Notes</i>. It is off until you switch it on in Settings.',
    '<b>The only optional features that write</b> are <i>Field Notes</i> and <i>System upkeep</i>. <i>Field Notes</i> is off until you switch it on in Settings.');
  s = sub(s, 'so it is your choice.</p>',
    `so it is your choice.</p>
      <p class="small"><i>System upkeep</i> (Settings) does nothing until you press its buttons. <i>Borderless</i> sets two lines in user.cfg (r_Fullscreen and r_FullscreenWindow) after saving your file, and <i>Put back</i> restores just those two lines. <i>Shader cache</i> lists the game's cached shader folders and deletes one only after a second click. That cannot be undone, and the next game start is slow while the game rebuilds it, so use it only when performance is very poor. Both refuse while the game is running.</p>`);
  return s;
});

fs.writeFileSync('scripts/embed-desktop.test.mjs', `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const d = new URL('../site/bureau/rsi1/companion/', import.meta.url);
const css = readFileSync(new URL('companion.css', d), 'utf8'), js = readFileSync(new URL('app.js', d), 'utf8'), html = readFileSync(new URL('index.html', d), 'utf8');

test('the page marks itself as embedded only for ?embed=desktop or the app flag', () => {
  assert.match(js, /get\\('embed'\\) === 'desktop' \\|\\| window\\.__OMNIGLASS_OS__\\?\\.embed === 'desktop'/);
  assert.match(js, /classList\\.add\\('embed-desktop'\\)/);
});
test('embedded: the site brand and the download card are hidden, nothing else is removed', () => {
  assert.match(css, /\\.embed-desktop \\.brand \\.id,\\.embed-desktop \\.brand::after,\\.embed-desktop #desktopDownload\\{display:none\\}/);
  assert.match(html, /id="desktopDownload"/); assert.ok(!/\\.embed-desktop[^{]*\\{[^}]*(nav|dock)[^}]*display:none/.test(css), 'the dock stays');
});
test('the Desktop page says what System upkeep writes, and that the shader cache cannot be undone', () => {
  assert.match(html, /The only optional features that write<\\/b> are <i>Field Notes<\\/i> and <i>System upkeep<\\/i>/);
  assert.match(html, /r_Fullscreen and r_FullscreenWindow/); assert.match(html, /cannot be undone/); assert.match(html, /refuse while the game is running/);
});
`);
console.log('s1 applied: embed styles and System upkeep wording. Run: npm run check && npm test');

// PR 2: Hangar Command. The hangar takes a ship from the list and fills its numbers from the ship data itself;
// the hand-typed Role/SCM/NAV/rotation/accel boxes, the stats scanner and the wiki look-up button go.
import { readFileSync, writeFileSync } from 'node:fs';
const dir = 'site/bureau/rsi1/companion/';
const need = (s, x, what) => { if (!s.includes(x)) { console.error('Not found: ' + what); process.exit(1); } };
const cut = (s, start, end, what) => {
  const a = s.indexOf(start); if (a < 0) { console.error('Not found: ' + what); process.exit(1); }
  const b = s.indexOf(end, a); if (b < 0) { console.error('Not found (end): ' + what); process.exit(1); }
  return s.slice(0, a) + s.slice(b + end.length);
};

// ---- index.html
let h = readFileSync(dir + 'index.html', 'utf8');
const p = h.match(/<p class="small muted">Type a ship name and press Look up[\s\S]*?<\/p>/);
if (!p) { console.error('Not found: hangar intro'); process.exit(1); }
h = h.replace(p[0], () => '<p class="small muted">Search for a ship and save it to your hangar. Its speed, handling, damage, shields and hull come from the ship data and feed the comparison graph.</p>');
need(h, '      <div id="scan-ship"></div>\n', 'scan-ship div');
h = h.replace('      <div id="scan-ship"></div>\n', '');
const btn = '<button class="ghost" id="flLookup">Look up SCM / NAV / rotation</button>';
need(h, btn, 'look up button');
h = h.replace(btn, '');
writeFileSync(dir + 'index.html', h);

// ---- catalog.js
let c = readFileSync(dir + 'catalog.js', 'utf8');
need(c, 'export const shipNames = async', 'shipNames');
c = c.replace('export const shipNames = async', () => `// One ship's record from the ship data (null when the data is unavailable or the name is not in it).
export const shipRecord = async (name) => (await builder()).ships.find((s) => s.name === name) || null;
export const shipNames = async`);
writeFileSync(dir + 'catalog.js', c);

// ---- app.js
let a = readFileSync(dir + 'app.js', 'utf8');
need(a, "import { builderSchema } from './catalog.js';", 'catalog import');
a = a.replace("import { builderSchema } from './catalog.js';", () => "import { builderSchema, shipNames, shipRecord } from './catalog.js';\nimport { strictPick } from './pick-ui.js';");

a = cut(a, "$('#flLookup').addEventListener('click', async () => {", "toast('Could not reach the ship database'); }\n});\n", 'flLookup handler');
a = cut(a, "// Ship stats\nscanner('#scan-ship'", "}, 'Fill the form (then Save ship)') });\n", 'ship stats scanner');

const f0 = a.indexOf("fields($('#flFields'), [{ k: 'name'");
const f1 = a.indexOf("// Axes of the flight and combat envelope.");
if (f0 < 0 || f1 < 0 || f1 < f0) { console.error('Not found: fleet form block'); process.exit(1); }
a = a.slice(0, f0) + `fields($('#flFields'), [{ k: 'name', label: 'Ship', type: 'text', ph: 'Search for a ship' }], fl, () => {});
const flPick = strictPick($('#flFields input'), { onChange: (ok) => { $('#flAdd').disabled = !ok; } });
flPick.setSource({ get: shipNames });
$('#flAdd').addEventListener('click', async () => {
  const name = flPick.value();
  if (!name) return toast('Pick a ship from the list');
  if (S.fleet.some((s) => s.name === name)) return toast(name + ' is already in your hangar');
  let r = null;
  try { r = await shipRecord(name); } catch { /* ship data unavailable: the ship is still saved by name */ }
  const ag = r?.stats?.agility || {}, dps = (Number(r?.api?.pilotDps) || 0) + (Number(r?.api?.turretDps) || 0);
  const ship = { name: name.slice(0, 60), role: String(r?.role || '').slice(0, 40), img: cleanImg(r?.img || ''),
    scm: C.nOrNull(r?.scm), nav: C.nOrNull(r?.max), pitch: C.nOrNull(ag.pitch), yaw: C.nOrNull(ag.yaw), roll: C.nOrNull(ag.roll),
    cargo: C.nOrNull(r?.cargo), hull: C.nOrNull(r?.stats?.hull), shieldHp: C.nOrNull(r?.api?.shieldHp), burst: dps > 0 ? dps : null, qtRange: C.nOrNull(r?.stats?.quantum?.range) };
  S.fleet = [...S.fleet, ship].slice(0, 60);
  Store.saveFleet(); renderFleet(); flPick.reset(); toast(r ? 'Ship saved' : 'Ship saved without stats (the ship data is unavailable right now)');
});
` + a.slice(f1);
writeFileSync(dir + 'app.js', a);
console.log('ok');

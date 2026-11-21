// Read-only check: for each ship name given, fetch its wiki record, run it through the builder's own slimShip, and print what it found.
// Usage (from the belpire-site folder):  node ship-diag.mjs "Apollo Medivac" "Constellation Mk V Centaurus"
import { slimShip, WIKI_API } from './worker/sc-builder.js';

const names = process.argv.slice(2);
if (!names.length) { console.error('Give at least one ship name.'); process.exit(1); }
const get = async (p) => { const r = await fetch(WIKI_API + p, { headers: { Accept: 'application/json', 'User-Agent': 'BelpireCarnival/1.0 (diag)' } }); if (!r.ok) throw new Error(`HTTP ${r.status} ${p}`); return r.json(); };
const walk = (ports, depth = 0, out = []) => { for (const p of Array.isArray(ports) ? ports : []) { out.push({ depth, name: p.name, type: p.type, editable: p.editable, min: p.sizes?.min, max: p.sizes?.max, kids: Array.isArray(p.ports) ? p.ports.length : 0 }); walk(p.ports, depth + 1, out); } return out; };

for (const name of names) {
  console.log('\n=== ' + name);
  let list; try { list = (await get(`/vehicles?filter%5Bname%5D=${encodeURIComponent(name)}&page%5Bsize%5D=5`)).data || []; } catch (e) { console.log('lookup failed:', e.message); continue; }
  const v = list.find((x) => x.name === name) || list[0];
  if (!v) { console.log('not found in the wiki API'); continue; }
  const s = slimShip(v);
  const kinds = {}; for (const x of s.slots) kinds[x.type] = (kinds[x.type] || 0) + 1;
  console.log('uuid', v.uuid, '| slug', v.slug);
  console.log('slots built:', s.slots.length, JSON.stringify(kinds));
  console.log('img path:', s.img || '(none)', '| ship-images override:', 'check worker/ship-images.json for the uuid above');
  console.log('armament summary:', JSON.stringify(s.arm));
  console.log('wiki weaponry keys:', Object.keys(v.weaponry || {}).join(', ') || '(none)');
  console.log('wiki fixed_weapons:', JSON.stringify((v.weaponry?.fixed_weapons?.weapons || []).map((w) => w.name)));
  console.log('wiki turrets keys:', Object.keys(v.turrets || {}).map((k) => `${k}:${(v.turrets[k] || []).length}`).join(', ') || '(none)');
  console.log('wiki ports that look like guns or turrets:');
  for (const p of walk(v.ports).filter((p) => /turret|weapon|gun|missile/i.test(`${p.type} ${p.name}`))) console.log('  ' + ' '.repeat(p.depth * 2) + `${p.name} [${p.type}] editable=${p.editable} size ${p.min}-${p.max} children=${p.kids}`);
}

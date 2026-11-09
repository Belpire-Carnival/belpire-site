// One-off helper: finds a picture on the Star Citizen wiki for every ship the API has none for, and writes the
// result to worker/ship-images.json (ship id -> media path), which the worker merges into /api/sc-builder.
//
//   node scripts/find-ship-images.mjs [snapshot-url]      (run from the repo root; commit the changed JSON afterwards)
//
// It only adds pictures: entries already in the file are kept, and ships that already have one are skipped.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { IMG_PATH, MEDIA_HOST } from '../worker/sc-builder.js';

const WIKI = 'https://starcitizen.tools/api.php';
const OUT = fileURLToPath(new URL('../worker/ship-images.json', import.meta.url));
const SNAPSHOT = 'https://bureau.belpire.com/api/sc-builder';
const CONCURRENCY = 4;

// Wiki page titles do not follow "Maker Name" ("Corsair", "100i", "A2 Hercules Starlifter"), so try the full name,
// then the name without its maker, then the name with trailing words dropped one at a time.
export function candidateTitles(name, mfr = '') {
  const full = String(name || '').replace(/\s+/g, ' ').trim();
  const out = [];
  const add = (t) => {
    t = t.trim();
    if (t.length >= 2 && !out.includes(t)) out.push(t);
  };
  add(full);
  const words = full.split(' ');
  const maker = String(mfr || '').trim().toLowerCase();
  let rest = words;
  for (let n = Math.min(3, words.length - 1); n >= 1; n--) {
    const head = words.slice(0, n).join(' ').toLowerCase();
    if (maker && (maker.startsWith(head) || head === maker.split(' ')[0])) {
      rest = words.slice(n);
      break;
    }
  }
  if (rest !== words) add(rest.join(' '));
  for (let n = rest.length - 1; n >= 2; n--) add(rest.slice(0, n).join(' '));
  return out.slice(0, 5);
}

// The media paths of the images in a rendered wiki page, in page order, without placeholders and duplicates.
export function thumbPaths(html) {
  const seen = new Set();
  const out = [];
  const re = /(?:https:)?\/\/media\.starcitizen\.tools\/([^\s"'<>),]+)/g;
  for (const m of String(html || '').matchAll(re)) {
    const path = m[1];
    if (/placeholder/i.test(path) || !IMG_PATH.test(path) || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

// Prefer an image whose file name mentions the ship; otherwise the first one on the page.
export function pickThumb(html, name = '') {
  const paths = thumbPaths(html);
  const tokens = String(name).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const hit = paths.find((p) => tokens.some((t) => p.toLowerCase().includes(t)));
  return hit || paths[0] || '';
}

async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'belpire-companion-image-seed/1.0' } });
      if (res.ok) return await res.json();
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  return null;
}

async function findPicture(ship) {
  for (const title of candidateTitles(ship.name, ship.mfr)) {
    const s = await getJson(`${WIKI}?action=query&list=search&srsearch=${encodeURIComponent(title)}&srlimit=2&format=json`);
    const hit = s?.query?.search?.[0]?.title;
    if (!hit) continue;
    const p = await getJson(`${WIKI}?action=parse&page=${encodeURIComponent(hit)}&prop=text&format=json&disablelimitreport=1`);
    const path = pickThumb(p?.parse?.text?.['*'], ship.name);
    if (path) return path;
  }
  return '';
}

async function main() {
  const url = process.argv[2] || SNAPSHOT;
  const snap = await (await fetch(url)).json();
  const current = JSON.parse(await readFile(OUT, 'utf8'));
  const todo = (snap.ships || []).filter((s) => !s.img && !current[s.id]);
  console.log(`${snap.ships?.length ?? 0} ships, ${todo.length} without a picture (${MEDIA_HOST})`);
  let next = 0;
  let found = 0;
  const missing = [];
  async function worker() {
    while (next < todo.length) {
      const ship = todo[next++];
      const path = await findPicture(ship);
      if (path) {
        current[ship.id] = path;
        found++;
      } else missing.push(ship.name);
      process.stdout.write(`\r${next}/${todo.length} found ${found}   `);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await writeFile(OUT, JSON.stringify(current, null, 2) + '\n');
  console.log(`\nWrote ${Object.keys(current).length} pictures to worker/ship-images.json`);
  if (missing.length) console.log(`No picture found for: ${missing.join(', ')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();

// Original line art for the companion: a banner picture for each page, a top-down silhouette for each ship class,
// and a small glyph for each kind of ship part. Nothing here is taken from the game or from any other site.
import { svgEl } from './viz.js';

const P = (d, cls) => svgEl('path', { d, class: cls });
const C = (cx, cy, r, cls) => svgEl('circle', { cx, cy, r, class: cls });
const L = (x1, y1, x2, y2, cls) => svgEl('line', { x1, y1, x2, y2, class: cls });
const R = (x, y, w, h, cls) => svgEl('rect', { x, y, width: w, height: h, class: cls });
const art = (w, h, cls = 'art') => svgEl('svg', { viewBox: `0 0 ${w} ${h}`, class: cls, role: 'img', 'aria-hidden': 'true', focusable: 'false' });
const add = (svg, ...kids) => { for (const k of kids) svg.append(k); return svg; };

// ---------------------------------------------------------------- page banners (150×96)
const HERO = {
  ops: (s) => add(s, C(75, 48, 40, 'l2'), C(75, 48, 26, 'l2'), C(75, 48, 12, 'l2'), L(75, 48, 108, 22, 'l1'), P('M75 48 108 22A42 42 0 0 1 117 48Z', 'f2'), C(98, 62, 2.5, 'dot'), C(58, 30, 2.5, 'dot'), C(62, 70, 2, 'dot')),
  contracts: (s) => add(s, P('M44 10h46l16 16v60H44Z', 'f1'), P('M90 10v16h16', 'l1'), L(54, 42, 96, 42, 'l2'), L(54, 52, 96, 52, 'l2'), L(54, 62, 84, 62, 'l2'), C(92, 76, 8, 'l1'), P('M88 76l3 3 5-6', 'l1')),
  salvage: (s) => add(s, P('M18 62 46 38l28 4 20 16-12 22-34 2Z', 'f1'), L(46, 38, 40, 70, 'l2'), L(74, 42, 60, 80, 'l2'), P('M104 20l20 22', 'l1'), P('M96 26l-14 14', 'l2'), C(124, 42, 5, 'l1'), P('M96 26 82 40', 'l1')),
  mining: (s) => add(s, P('M70 30l22-8 24 10 8 24-10 22-26 6-20-12-8-22Z', 'f1'), L(80, 42, 92, 58, 'l2'), L(100, 36, 94, 52, 'l2'), P('M18 18 74 46', 'l1'), P('M18 18l8 2M18 18l2 8', 'l1'), C(82, 50, 4, 'dot')),
  trade: (s) => add(s, R(14, 38, 26, 26, 'f1'), R(110, 38, 26, 26, 'f1'), L(27, 38, 27, 26, 'l1'), L(123, 38, 123, 26, 'l1'), P('M44 46h58l-8-8M106 56H48l8 8', 'l1'), C(75, 22, 3, 'dot'), L(14, 76, 136, 76, 'l2')),
  cargo: (s) => add(s, P('M40 40l22-10 22 10-22 10Z', 'f1'), P('M40 40v22l22 10V50', 'l1'), P('M84 40v22L62 72', 'l1'), P('M84 50l22-10 22 10-22 10Z', 'f1'), P('M84 50v22l22 10V60', 'l1'), P('M128 50v22l-22 10', 'l1'), P('M62 22l22-10 22 10-22 10Z', 'f2')),
  combat: (s) => add(s, C(75, 48, 34, 'l1'), C(75, 48, 18, 'l2'), L(75, 6, 75, 30, 'l1'), L(75, 66, 75, 90, 'l1'), L(30, 48, 52, 48, 'l1'), L(98, 48, 120, 48, 'l1'), C(75, 48, 2.5, 'dot'), P('M60 56l30-16', 'l2')),
  calc: (s) => add(s, P('M20 20h110M20 38h110M20 56h110M20 74h110', 'l2'), P('M40 12v72M75 12v72M110 12v72', 'l2'), P('M52 62 75 24l23 38-23-8Z', 'f1'), L(75, 24, 75, 54, 'l2'), C(75, 54, 2.5, 'dot'), P('M30 84h90', 'l1'), P('M30 80v8M120 80v8', 'l1')),
  fleet: (s) => add(s, P('M75 12l12 28-12-6-12 6Z', 'f1'), P('M38 40l12 28-12-6-12 6Z', 'f1'), P('M112 40l12 28-12-6-12 6Z', 'f1'), L(75, 46, 75, 84, 'l2'), L(38, 74, 38, 90, 'l2'), L(112, 74, 112, 90, 'l2')),
  manual: (s) => add(s, P('M20 22h50a6 6 0 0 1 5 3v56a6 6 0 0 0-5-3H20Z', 'f1'), P('M130 22H80a6 6 0 0 0-5 3v56a6 6 0 0 1 5-3h50Z', 'f1'), L(30, 38, 62, 38, 'l2'), L(30, 48, 62, 48, 'l2'), L(88, 38, 120, 38, 'l2'), L(88, 48, 114, 48, 'l2'), C(75, 12, 5, 'l1')),
  log: (s) => add(s, L(20, 80, 130, 80, 'l1'), R(26, 52, 14, 28, 'f1'), R(48, 34, 14, 46, 'f1'), R(70, 44, 14, 36, 'f1'), R(92, 20, 14, 60, 'f1'), P('M26 40 55 24 77 32 99 12', 'l1'), C(99, 12, 3, 'dot'))
};

export function heroArt(name) {
  const s = art(150, 96);
  (HERO[name] || HERO.ops)(s);
  return s;
}

// ---------------------------------------------------------------- ship silhouettes (200×110, nose to the right)
const hash = (str) => [...String(str || '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

// Which silhouette suits a ship, from the role and career words the wiki gives it.
export function shipKind(ship) {
  const t = `${ship?.role || ''} ${ship?.career || ''} ${ship?.name || ''}`.toLowerCase();
  if (/mining|miner/.test(t)) return 'tool';
  if (/salvage/.test(t)) return 'tool';
  if (/freight|cargo|transport|hauler|industrial|starter/.test(t) && !/light fighter/.test(t)) return /heavy|capital/.test(t) ? 'capital' : 'hauler';
  if (/explor|pathfinder|expedition/.test(t)) return 'explorer';
  if (/bomber|torpedo|gunship|heavy fighter/.test(t)) return 'wide';
  if (/capital|carrier|frigate|corvette|destroyer/.test(t)) return 'capital';
  if (/fighter|interdiction|racing|interceptor|stealth|combat|multi/.test(t)) return 'fighter';
  return (ship?.size || 1) >= 4 ? 'hauler' : 'fighter';
}

const KINDS = {
  fighter: (k) => [P('M24 55 78 47 170 55 78 63Z', 'f1'), P(`M70 47 ${46 - k} 20 ${96 - k} 44Z`, 'f2'), P(`M70 63 ${46 - k} 90 ${96 - k} 66Z`, 'f2'), P('M120 51l30 4-30 4', 'l1'), R(14, 50, 12, 10, 'l1'), L(150, 55, 178, 55, 'l2')],
  hauler: (k) => [R(34, 36, 100, 38, 'f1'), P('M134 42 176 50v10l-42 8Z', 'f1'), R(18, 44, 18, 22, 'l1'), L(60, 36, 60, 74, 'l2'), L(86, 36, 86, 74, 'l2'), L(112, 36, 112, 74, 'l2'), P(`M50 36 ${40 + k} 18H78L84 36`, 'f2'), P(`M50 74 ${40 + k} 92H78L84 74`, 'f2')],
  wide: (k) => [P('M20 55 60 46 160 55 60 64Z', 'f1'), P(`M110 49 ${70 - k} 12 ${54 - k} 14 74 49Z`, 'f2'), P(`M110 61 ${70 - k} 98 ${54 - k} 96 74 61Z`, 'f2'), R(10, 46, 12, 18, 'l1'), P('M160 55 184 55', 'l2'), C(130, 55, 5, 'l1')],
  explorer: (k) => [P('M18 48h96l38 7-38 7H18Z', 'f1'), C(70, 55, 20 + k % 4, 'f2'), P('M40 48 28 28h28l8 20', 'f2'), P('M40 62 28 82h28l8-20', 'f2'), L(112, 55, 168, 55, 'l2'), R(8, 49, 12, 12, 'l1')],
  tool: (k) => [R(34, 40, 76, 30, 'f1'), P('M110 46 144 50v10l-34 4Z', 'f1'), P('M144 55H190', 'l1'), C(190, 55, 3, 'dot'), R(16, 44, 20, 22, 'l1'), P(`M60 40 ${54 + k} 22 90 22 94 40`, 'f2'), P(`M60 70 ${54 + k} 88 90 88 94 70`, 'f2')],
  capital: (k) => [P('M10 46 120 40 188 55 120 70 10 64Z', 'f1'), L(30, 55, 150, 55, 'l2'), R(44, 34, 30, 12, 'f2'), R(44, 64, 30, 12, 'f2'), R(90, 32 - k % 3, 24, 10, 'f2'), R(90, 68, 24, 10, 'f2'), C(140, 55, 6, 'l1'), R(2, 44, 10, 22, 'l1')]
};

export function shipArt(ship, cls = 'art') {
  const s = art(200, 110, cls);
  add(s, L(8, 100, 192, 100, 'l2'));
  const k = hash(ship?.name) % 12;
  for (const n of KINDS[shipKind(ship)](k)) s.append(n);
  return s;
}

// ---------------------------------------------------------------- part glyphs (84×40), used beside parts and guns
const PART = {
  Shield: (s) => add(s, P('M42 4 66 12v14c0 8-10 12-24 16C28 38 18 34 18 26V12Z', 'f2'), P('M42 12v22', 'l2')),
  PowerPlant: (s) => add(s, C(42, 20, 14, 'f1'), P('M44 8 36 22h8l-4 12', 'l1')),
  Cooler: (s) => add(s, C(42, 20, 14, 'f2'), P('M42 6v28M30 13l24 14M30 27l24-14', 'l1')),
  QuantumDrive: (s) => add(s, C(42, 20, 6, 'f1'), P('M16 20h16M52 20h16', 'l1'), C(42, 20, 14, 'l2')),
  JumpDrive: (s) => add(s, C(42, 20, 14, 'l2'), C(42, 20, 7, 'f1'), P('M42 3v8M42 29v8', 'l1')),
  Radar: (s) => add(s, P('M42 34 42 20', 'l1'), P('M24 20a18 18 0 0 1 36 0', 'l1'), P('M31 20a11 11 0 0 1 22 0', 'l2'), C(42, 20, 2.5, 'dot')),
  MissileLauncher: (s) => add(s, R(16, 10, 52, 20, 'f1'), L(28, 10, 28, 30, 'l2'), L(42, 10, 42, 30, 'l2'), L(56, 10, 56, 30, 'l2'), P('M68 20h10', 'l1')),
  WeaponGun: (s) => add(s, R(14, 17, 40, 8, 'f1'), P('M54 19h24v4H54Z', 'l1'), R(24, 25, 10, 8, 'l1'), L(78, 21, 82, 21, 'l2'))
};

export function partArt(type) {
  const s = art(84, 40, 'art thumb');
  (PART[type] || PART.WeaponGun)(s);
  return s;
}

// A picture served through this site's own image route (/api/sc-img), with the drawn art as the fallback
// when there is no picture or it fails to load.
export function photo(path, alt, fallback, cls = 'photo') {
  if (!path || typeof path !== 'string' || path.length > 220) return fallback;
  const img = document.createElement('img');
  img.className = cls;
  img.alt = alt || '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.src = `/api/sc-img?p=${encodeURIComponent(path)}`;
  img.addEventListener('error', () => { if (fallback && img.parentNode) img.replaceWith(fallback); else img.remove(); }, { once: true });
  return img;
}

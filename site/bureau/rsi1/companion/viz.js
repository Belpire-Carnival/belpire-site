// Small drawing helpers for the companion: icons, meters, rings and charts. Everything is built with
// createElementNS and attributes only (no markup strings, no inline style), so it passes the page's strict CSP.
const NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v);
  for (const k of kids) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}

// 24×24 line icons, drawn for this page.
const ICONS = {
  ops: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 12 18 6', 'M12 7.5a4.5 4.5 0 0 1 4.5 4.5'],
  contracts: ['M6 3h9l4 4v14H6Z', 'M15 3v4h4', 'M9 12h7M9 16h5'],
  log: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M21 20H3'],
  salvage: ['M4 15l4-9 5 3 7-2-2 9-7 4Z', 'M9 9l2 5', 'M15 7l-1 5'],
  mining: ['M12 3l7 5v8l-7 5-7-5V8Z', 'M12 3v18', 'M5 8l14 8M19 8 5 16'],
  trade: ['M4 8h13l-3-3', 'M20 16H7l3 3', 'M4 8v0', 'M20 16v0'],
  cargo: ['M3 8l9-5 9 5v8l-9 5-9-5Z', 'M3 8l9 5 9-5', 'M12 13v8'],
  calc: ['M5 4h14v16H5Z', 'M8 8h8', 'M8 12h2M12 12h2M16 12h0', 'M8 16h2M12 16h4'],
  combat: ['M5 19 19 5', 'M14 4h6v6', 'M5 5l5 5', 'M4 15l5 5'],
  fleet: ['M12 3l3 7h5l-4 3 1 8-5-4-5 4 1-8-4-3h5Z'],
  waypoint: ['M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11Z', 'M12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z'],
  inventory: ['M4 9h16v11H4Z', 'M3 5h18v4H3Z', 'M10 13h4'],
  items: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z', 'M16 16l5 5', 'M8 11h6'],
  fleetmgr: ['M12 3l3 6h-6Z', 'M5 12l3 6H2Z', 'M19 12l3 6h-6Z', 'M12 9v4', 'M5 12h14'],
  dash: ['M3 3h8v8H3Z', 'M13 3h8v5h-8Z', 'M13 10h8v11h-8Z', 'M3 13h8v8H3Z'],
  desktop: ['M3 5h18v11H3Z', 'M8 20h8', 'M12 16v4', 'M7 9l2 2-2 2', 'M12 13h4'],
  manual: ['M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Z', 'M5 17a3 3 0 0 1 3-3h11', 'M9 8h6'],
  plan: ['M5 4h14v16H5Z', 'M8 9l1.5 1.5L12 8', 'M14 9.5h2.5', 'M8 15l1.5 1.5L12 14', 'M14 15.5h2.5'],
  wishlist: ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z'],
  fabricator: ['M4 20h16', 'M6 20V9l6-5 6 5v11', 'M10 20v-6h4v6', 'M12 4V2'],
  objectives: ['M6 21V4','M6 5h11l-2 3.5 2 3.5H6','M10 17h8'],
  blueprints: ['M4 5h16v14H4Z', 'M4 9h16', 'M9 9v10', 'M12.5 13h4M12.5 16h3'],
  hubops: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z'],
  hubplan: ['M12 2l8 4.5v9L12 20l-8-4.5v-9Z'],
  hubarmory: ['M12 2l8 3.5-1 8L12 21l-7-7.5-1-8Z'],
  hubearn: ['M4 4h7v7H4Z','M13 4h7v7h-7Z','M4 13h7v7H4Z'],
  wardrobe: ['M9 3 4 6l2 4 2-1v11h8V9l2 1 2-4-5-3c-.5 1.6-1.6 2.5-3 2.5S9.5 4.6 9 3Z'],
  loadouts: ['M5 8h14v11H5Z','M9 8V5h6v3','M5 13h14','M11 13v2h2v-2'],
  howto: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z','M12 7v5l3 2'],
  guide: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7', 'M12 17v.01']
};

// Module icons (48×48), supplied as OmniGlass vector art. Drawn from data so the page needs no markup strings.
const ART = {"ops":[["circle",{"cx":"24","cy":"24","r":"10","stroke-width":"1.5","stroke-dasharray":"2 3"}],["ellipse",{"cx":"24","cy":"24","rx":"20","ry":"7","transform":"rotate(-30 24 24)","stroke-width":"1.5"}],["ellipse",{"cx":"24","cy":"24","rx":"20","ry":"7","transform":"rotate(30 24 24)","stroke-width":"0.75","opacity":"0.5"}],["path",{"d":"M24 4v6M24 38v6M4 24h6M38 24h6","stroke-width":"1.5"}],["circle",{"cx":"24","cy":"24","r":"3","fill":"currentColor"}]],"contracts":[["rect",{"x":"8","y":"6","width":"26","height":"36","rx":"2","stroke-width":"1.5"}],["path",{"d":"M34 16h8v26a2 2 0 0 1-2 2H16v-8","stroke-width":"1.5","opacity":"0.3"}],["path",{"d":"M14 14h14M14 20h10M14 26h14","stroke-width":"1.5","stroke-linecap":"round"}],["circle",{"cx":"24","cy":"34","r":"4","stroke-width":"1.5"}],["circle",{"cx":"24","cy":"34","r":"1.5","fill":"currentColor"}]],"log":[["path",{"d":"M8 8h32v32H8z","stroke-width":"0.75","opacity":"0.3"}],["path",{"d":"M8 18h32M8 28h32","stroke-width":"0.75","stroke-dasharray":"1 3","opacity":"0.2"}],["path",{"d":"M8 32l10-12 8 6 14-16v30H8z","fill":"rgba(232, 139, 46, 0.1)","stroke":"none"}],["path",{"d":"M8 32l10-12 8 6 14-16","stroke-width":"2"}],["circle",{"cx":"18","cy":"20","r":"2","fill":"currentColor"}],["circle",{"cx":"40","cy":"10","r":"2","fill":"currentColor"}],["path",{"d":"M4 40h40","stroke-width":"1.5"}]],"salvage":[["path",{"d":"M6 38l36-10v8l-36 10z","stroke-width":"1.5","fill":"rgba(90, 140, 190, 0.15)"}],["path",{"d":"M18 36l4-2 2 4M30 33l2 4","stroke-width":"1"}],["path",{"d":"M14 10v6l4 8M34 10v6l-4 8","stroke-width":"1.5"}],["path",{"d":"M11 10h6M31 10h6","stroke-width":"2"}],["path",{"d":"M18 24l4 9M30 24l-4 9","stroke-width":"1.5","stroke-dasharray":"3 4","stroke-linecap":"round"}]],"mining":[["path",{"d":"M24 4l12 10v18l-12 12L12 32V14z","stroke-width":"1.5"}],["path",{"d":"M24 4v16M12 14l12 6 12-6M12 32l12-12 12 12","stroke-width":"1.5"}],["path",{"d":"M24 20l12-6M24 20v12","stroke-width":"0.75","opacity":"0.5"}],["circle",{"cx":"24","cy":"20","r":"2","fill":"currentColor"}],["circle",{"cx":"24","cy":"20","r":"7","stroke-width":"0.75","stroke-dasharray":"2 3"}]],"trade":[["circle",{"cx":"24","cy":"24","r":"16","stroke-width":"0.75","stroke-dasharray":"2 4","opacity":"0.4"}],["circle",{"cx":"10","cy":"34","r":"3.5","stroke-width":"1.5"}],["circle",{"cx":"24","cy":"14","r":"3.5","stroke-width":"1.5"}],["circle",{"cx":"40","cy":"26","r":"3.5","stroke-width":"1.5"}],["path",{"d":"M12 31.5L22 16.5M26.5 15.5L38 23.5","stroke-width":"2"}],["path",{"d":"M14 34h16l8-5","stroke-width":"1.25","stroke-dasharray":"3 3","opacity":"0.6"}],["circle",{"cx":"24","cy":"14","r":"1.5","fill":"currentColor"}]],"cargo":[["path",{"d":"M24 6l16 8v18L24 40 8 32V14z","stroke-width":"1.5"}],["path",{"d":"M24 6v18M40 14l-16 8-16-8M24 24v16","stroke-width":"1.5"}],["path",{"d":"M16 10l16 8M12 12l16 8","stroke-width":"0.75","opacity":"0.4"}],["path",{"d":"M8 20l16 8v12","stroke-width":"0.75","opacity":"0.4"}],["path",{"d":"M40 20l-16 8v12","stroke-width":"0.75","opacity":"0.4"}]],"calc":[["circle",{"cx":"24","cy":"24","r":"20","stroke-width":"1.5"}],["circle",{"cx":"24","cy":"24","r":"16","stroke-width":"0.75","stroke-dasharray":"2 4","opacity":"0.4"}],["path",{"d":"M6 24h10l2 6h12l2-6h10","stroke-width":"1.5"}],["path",{"d":"M16 24l2 6h12l2-6z","fill":"rgba(0, 240, 255, 0.1)","stroke":"none"}],["path",{"d":"M18 14h12M20 34h8","stroke-width":"1.5"}],["path",{"d":"M24 8v4M24 36v4","stroke-width":"1.5","opacity":"0.6"}],["circle",{"cx":"24","cy":"24","r":"2.5","fill":"currentColor"}]],"combat":[["circle",{"cx":"24","cy":"24","r":"18","stroke-width":"1.5"}],["circle",{"cx":"24","cy":"24","r":"14","stroke-width":"0.75","stroke-dasharray":"4 6","opacity":"0.6"}],["path",{"d":"M24 2v6M24 40v6M2 24h6M40 24h6","stroke-width":"1.5"}],["path",{"d":"M12 36L36 12","stroke-width":"2.5"}],["path",{"d":"M30 18l4-4-4-4","stroke-width":"1.5"}],["circle",{"cx":"24","cy":"24","r":"3","fill":"currentColor"}]],"fleet":[["path",{"d":"M24 10l8 16-8-4-8 4z","stroke-width":"1.5","fill":"rgba(232, 139, 46, 0.15)"}],["path",{"d":"M24 28v8","stroke-width":"1.5","stroke-dasharray":"2 3"}],["path",{"d":"M11 24l5 10-5-2-5 2z","stroke-width":"1.5"}],["path",{"d":"M37 24l5 10-5-2-5 2z","stroke-width":"1.5"}],["path",{"d":"M14 14 a20 20 0 0 1 20 0","stroke-width":"0.75","opacity":"0.6"}],["path",{"d":"M10 20 a26 26 0 0 1 28 0","stroke-width":"0.75","stroke-dasharray":"2 4","opacity":"0.3"}]],"manual":[["rect",{"x":"8","y":"4","width":"32","height":"40","rx":"3","stroke-width":"1.5","fill":"rgba(90, 140, 190, 0.05)"}],["path",{"d":"M8 14h32","stroke-width":"1.5"}],["circle",{"cx":"24","cy":"9","r":"1.5","fill":"currentColor"}],["path",{"d":"M14 22h10M14 28h20M14 34h16","stroke-width":"1.5"}],["polygon",{"points":"34,18 38,20 38,24 34,26 30,24 30,20","stroke-width":"1.25","stroke-dasharray":"4 2","opacity":"0.8"}],["circle",{"cx":"34","cy":"22","r":"1.5","fill":"currentColor"}]]};

// Hub icons: two-tone line art (white structure, amber accent). Same drawing format as ART above.
const A = '#f59e0b';
Object.assign(ART, {
  hubops: [['ellipse', { cx: '24', cy: '24', rx: '19', ry: '8.5', transform: 'rotate(-28 24 24)', 'stroke-width': '2.4' }], ['ellipse', { cx: '24', cy: '24', rx: '19', ry: '8.5', transform: 'rotate(28 24 24)', 'stroke-width': '2.4', 'stroke-dasharray': '5 4', opacity: '.8' }], ['circle', { cx: '35', cy: '15.5', r: '3', fill: A, stroke: A }]],
  hubplan: [['path', { d: 'M24 3.5 42.5 14v20L24 44.5 5.5 34V14Z', 'stroke-width': '2.4' }], ['path', { d: 'M24 25 7 15M24 25l17-10M24 25v19', stroke: A, 'stroke-width': '3.4', 'stroke-linecap': 'butt' }], ['circle', { cx: '24', cy: '25', r: '3', fill: A, stroke: A }]],
  hubarmory: [['path', { d: 'M24 3.5 43 12l-3 19.5L24 44.5 8 31.5 5 12Z', 'stroke-width': '2.4' }], ['circle', { cx: '24', cy: '23', r: '8.5', stroke: A, 'stroke-width': '3' }], ['path', { d: 'M24 9v6M24 31v6M10 23h6M32 23h6', stroke: A, 'stroke-width': '3', 'stroke-linecap': 'butt' }]],
  hubearn: [['rect', { x: '5', y: '5', width: '16', height: '16', 'stroke-width': '2.4' }], ['rect', { x: '27', y: '5', width: '16', height: '16', stroke: A, 'stroke-width': '3.4' }], ['rect', { x: '5', y: '27', width: '16', height: '16', 'stroke-width': '2.4' }], ['path', { d: 'M27 37h15M35 29.5 42.5 37 35 44.5', stroke: A, 'stroke-width': '3.4', 'stroke-linecap': 'butt' }]]
});

export function icon(name, cls = 'ico') {
  if (ART[name]) {
    const s = svgEl('svg', { viewBox: '0 0 48 48', class: cls, 'aria-hidden': 'true', focusable: 'false' });
    for (const [tag, attrs] of ART[name]) s.append(svgEl(tag, attrs));
    return s;
  }
  const svg = svgEl('svg', { viewBox: '0 0 24 24', class: cls, 'aria-hidden': 'true', focusable: 'false' });
  for (const d of ICONS[name] || ICONS.ops) svg.append(svgEl('path', { d }));
  return svg;
}

const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));

// A thin horizontal gauge. `pct` is 0–100 (values past 100 are drawn as full and flagged by the class).
export function meter(pct, cls = '') {
  const p = clamp(Number(pct) || 0);
  const svg = svgEl('svg', { viewBox: '0 0 100 6', preserveAspectRatio: 'none', class: `meter ${cls}`.trim(), role: 'img', 'aria-label': `${Math.round(Number(pct) || 0)} percent` });
  svg.append(svgEl('rect', { x: 0, y: 0, width: 100, height: 6, class: 'mt' }), svgEl('rect', { x: 0, y: 0, width: p, height: 6, class: 'mf' }));
  return svg;
}

// A circular gauge with the value in the middle.
export function ring(pct, label, cls = '') {
  const p = clamp(Number(pct) || 0), r = 26, c = 2 * Math.PI * r;
  const svg = svgEl('svg', { viewBox: '0 0 64 64', class: `ring ${cls}`.trim(), role: 'img', 'aria-label': `${label}: ${Math.round(Number(pct) || 0)} percent` });
  svg.append(
    svgEl('circle', { cx: 32, cy: 32, r, class: 'rt' }),
    svgEl('circle', { cx: 32, cy: 32, r, class: 'rf', 'stroke-dasharray': `${(c * p / 100).toFixed(1)} ${c.toFixed(1)}`, transform: 'rotate(-90 32 32)' }),
    svgEl('text', { x: 32, y: 36, 'text-anchor': 'middle', class: 'rv' }, `${Math.round(Number(pct) || 0)}%`)
  );
  return svg;
}

// Row of pips, `on` of `total` lit (power segments, shield faces, and so on).
export function pips(on, total, cls = '') {
  const t = Math.max(0, Math.min(40, Math.round(total) || 0));
  const o = Math.max(0, Math.min(t, Math.round(on) || 0));
  const w = 6, g = 2;
  const svg = svgEl('svg', { viewBox: `0 0 ${Math.max(1, t) * (w + g)} 8`, class: `pips ${cls}`.trim(), role: 'img', 'aria-label': `${o} of ${t}` });
  for (let i = 0; i < t; i++) svg.append(svgEl('rect', { x: i * (w + g), y: 0, width: w, height: 8, class: i < o ? 'on' : 'off' }));
  return svg;
}

// Vertical bar chart. items: [{ label, value, cls? }]. Draws a baseline, value labels and a label under each bar.
export function bars(items, { w = 420, h = 140, fmt = (v) => String(v), empty = 'Nothing logged yet' } = {}) {
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img', 'aria-label': 'Bar chart' });
  const max = Math.max(0, ...items.map((i) => Number(i.value) || 0));
  if (!items.length || !max) {
    svg.append(svgEl('text', { x: w / 2, y: h / 2, 'text-anchor': 'middle', class: 'cl' }, empty));
    return svg;
  }
  const pad = 22, top = 16, base = h - pad, gap = 6, bw = (w - gap * (items.length + 1)) / items.length;
  svg.append(svgEl('line', { x1: 0, y1: base, x2: w, y2: base, class: 'ax' }));
  items.forEach((it, i) => {
    const v = Math.max(0, Number(it.value) || 0), bh = Math.max(v ? 2 : 0, (v / max) * (base - top));
    const x = gap + i * (bw + gap);
    svg.append(svgEl('rect', { x: x.toFixed(1), y: (base - bh).toFixed(1), width: bw.toFixed(1), height: bh.toFixed(1), class: `bar ${it.cls || ''}`.trim() }));
    if (v) svg.append(svgEl('text', { x: (x + bw / 2).toFixed(1), y: (base - bh - 4).toFixed(1), 'text-anchor': 'middle', class: 'cv' }, fmt(v)));
    svg.append(svgEl('text', { x: (x + bw / 2).toFixed(1), y: h - 6, 'text-anchor': 'middle', class: 'cl' }, it.label));
  });
  return svg;
}

// Compare-bar: two values drawn as stacked thin bars scaled to the larger one (stock vs build).
export function duo(a, b, cls = '') {
  const max = Math.max(Number(a) || 0, Number(b) || 0, 1e-9);
  const svg = svgEl('svg', { viewBox: '0 0 100 10', preserveAspectRatio: 'none', class: `duo ${cls}`.trim(), role: 'img', 'aria-label': 'Stock compared with your build' });
  svg.append(
    svgEl('rect', { x: 0, y: 0, width: ((Number(a) || 0) / max * 100).toFixed(1), height: 4, class: 'da' }),
    svgEl('rect', { x: 0, y: 6, width: ((Number(b) || 0) / max * 100).toFixed(1), height: 4, class: 'db' })
  );
  return svg;
}

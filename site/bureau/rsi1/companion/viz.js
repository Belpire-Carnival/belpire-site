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
  manual: ['M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Z', 'M5 17a3 3 0 0 1 3-3h11', 'M9 8h6']
};

export function icon(name, cls = 'ico') {
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

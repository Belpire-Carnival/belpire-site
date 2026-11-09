// A small WebGL viewer for the Armory mannequin: a holographic wireframe you can drag to rotate and wheel to zoom.
// No libraries. It reads the binary glTF files in ./models/ (positions + triangle indices, one node per body part)
// and draws each part's edges, so a part can be tinted on its own when its armor slot is filled.

// ---------------------------------------------------------------- glTF binary (pure, testable)
export function parseGlb(buf) {
  const dv = new DataView(buf);
  if (dv.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a glb');
  const jl = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
  const binStart = 20 + jl + 8;
  const parts = {};
  for (const n of json.nodes || []) {
    if (n.mesh == null) continue;
    const prim = json.meshes[n.mesh].primitives[0];
    const pa = json.accessors[prim.attributes.POSITION], pb = json.bufferViews[pa.bufferView];
    const ia = json.accessors[prim.indices], ib = json.bufferViews[ia.bufferView];
    const pos = new Float32Array(buf.slice(binStart + (pb.byteOffset || 0), binStart + (pb.byteOffset || 0) + pa.count * 12));
    const idx = new Uint16Array(buf.slice(binStart + (ib.byteOffset || 0), binStart + (ib.byteOffset || 0) + ia.count * 2));
    parts[n.name || `part${Object.keys(parts).length}`] = { pos, idx };
  }
  return parts;
}

// Unique triangle edges as index pairs.
export function edgesOf(idx) {
  const seen = new Set(), out = [];
  for (let i = 0; i + 2 < idx.length; i += 3) {
    for (const [a, b] of [[idx[i], idx[i + 1]], [idx[i + 1], idx[i + 2]], [idx[i + 2], idx[i]]]) {
      const k = a < b ? a * 65536 + b : b * 65536 + a;
      if (!seen.has(k)) { seen.add(k); out.push(a, b); }
    }
  }
  return new Uint16Array(out);
}

// A box drawn as part of the mannequin (the backpack), in the same shape as a parsed part.
export function boxPart(x0, y0, z0, x1, y1, z1) {
  const pos = new Float32Array([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]);
  const idx = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2]);
  return { pos, idx };
}

// 4×4 column-major helpers
export const perspective = (fov, asp, n, f) => { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]; };
export function orbit(yaw, pitch, dist, target) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // view = T(0,0,-dist) · Rx(pitch) · Ry(yaw) · T(-target)
  const r = [cy, sp * sy, -cp * sy, 0, 0, cp, sp, 0, sy, -sp * cy, cp * cy, 0, 0, 0, 0, 1];
  const tx = -(r[0] * target[0] + r[4] * target[1] + r[8] * target[2]);
  const ty = -(r[1] * target[0] + r[5] * target[1] + r[9] * target[2]);
  const tz = -(r[2] * target[0] + r[6] * target[1] + r[10] * target[2]) - dist;
  r[12] = tx; r[13] = ty; r[14] = tz;
  return r;
}
export function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

// ---------------------------------------------------------------- the viewer
const VS = 'attribute vec3 p;uniform mat4 m;void main(){gl_Position=m*vec4(p,1.0);}';
const FS = 'precision mediump float;uniform vec4 c;void main(){gl_FragColor=c;}';
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
export const COLORS = { idle: '#00f0ff', active: '#e88b2e' };

export function createViewer(canvas) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: true });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const aP = gl.getAttribLocation(prog, 'p'), uM = gl.getUniformLocation(prog, 'm'), uC = gl.getUniformLocation(prog, 'c');
  gl.enableVertexAttribArray(aP);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let parts = {}, active = new Set(), gen = 0, alive = true;
  let yaw = 0.5, pitch = 0.08, dist = 3.7, held = 0, idleAt = 0, last = 0;
  const target = [0, 0.88, 0];

  const upload = (p) => {
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, p.pos, gl.STATIC_DRAW);
    const e = edgesOf(p.idx), eb = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eb); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, e, gl.STATIC_DRAW);
    const tb = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, tb); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, p.idx, gl.STATIC_DRAW);
    return { vb, eb, tb, ne: e.length, nt: p.idx.length };
  };
  const free = () => { for (const p of Object.values(parts)) { gl.deleteBuffer(p.vb); gl.deleteBuffer(p.eb); gl.deleteBuffer(p.tb); } parts = {}; };

  async function load(url, extra = {}) {
    const my = ++gen;
    const res = await fetch(url);
    if (!res.ok) throw new Error('model ' + res.status);
    const src = parseGlb(await res.arrayBuffer());
    if (my !== gen || !alive) return;
    free();
    for (const [name, p] of Object.entries({ ...src, ...extra })) parts[name] = upload(p);
  }

  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
  }

  function frame(t) {
    if (!alive) return;
    if (!canvas.isConnected) return destroy();
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (t - last) / 1000 || 0); last = t;
    if (!reduce && !held && t > idleAt) yaw += dt * 0.45;
    size();
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const mvp = mul(perspective(0.55, canvas.width / canvas.height, 0.1, 20), orbit(yaw, pitch, dist, target));
    gl.uniformMatrix4fv(uM, false, mvp);
    for (const [name, p] of Object.entries(parts)) {
      const on = active.has(name); if (name === 'Pack' && !on) continue;
      const col = hexRgb(on ? COLORS.active : COLORS.idle);
      gl.bindBuffer(gl.ARRAY_BUFFER, p.vb); gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 0, 0);
      gl.uniform4f(uC, col[0], col[1], col[2], on ? 0.11 : 0.035);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.tb); gl.drawElements(gl.TRIANGLES, p.nt, gl.UNSIGNED_SHORT, 0);
      gl.uniform4f(uC, col[0], col[1], col[2], on ? 0.95 : 0.38);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.eb); gl.drawElements(gl.LINES, p.ne, gl.UNSIGNED_SHORT, 0);
    }
  }

  // drag to orbit, wheel or pinch to zoom
  const ptrs = new Map();
  let pinch = 0;
  const touch = () => { idleAt = performance.now() + 3000; };
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); held = ptrs.size; });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    if (ptrs.size === 1) { yaw += (e.clientX - p[0]) * 0.008; pitch = Math.max(-0.7, Math.min(0.7, pitch + (e.clientY - p[1]) * 0.006)); }
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) dist = Math.max(1.6, Math.min(6, dist * (pinch / d))); pinch = d; }
  });
  const up = (e) => { ptrs.delete(e.pointerId); held = ptrs.size; pinch = 0; touch(); };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); dist = Math.max(1.6, Math.min(6, dist * (1 + Math.sign(e.deltaY) * 0.08))); touch(); }, { passive: false });
  canvas.addEventListener('dblclick', () => { yaw = 0.5; pitch = 0.08; dist = 3.7; touch(); });

  function destroy() { alive = false; free(); }
  requestAnimationFrame(frame);
  return { load, setActive(names) { active = new Set(names); }, destroy };
}

// Pure helpers for the Midway's 3D booths: easing, arcs, seeded shuffles and where things land.
// No Three.js and no DOM, so the tests (worker/test/midway-stage.test.mjs) run them directly.
// Everything here only decides how a result *looks*; the result itself always comes from the server.

export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOut = (t) => 1 - (1 - t) ** 3;
export const easeIn = (t) => t * t * t;
// Overshoots a little and settles: for things that land with a bounce.
export const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

// Same generator as the rotation; seeded from the server's visual seed so a replay looks the same.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A point on a ballistic-looking arc from `a` to `b` ([x, y, z]) peaking `height` above the higher end.
export function arcPoint(a, b, height, t) {
  const top = Math.max(a[1], b[1]) + height;
  // a parabola through a (t=0), b (t=1) whose peak is `top`
  const y0 = a[1];
  const y1 = b[1];
  const k = 2 * (top - y0) + 2 * Math.sqrt(Math.max(0, (top - y0) * (top - y1)));
  const y = y0 + (k) * t - (k - (y1 - y0)) * t * t;
  return [lerp(a[0], b[0], t), y, lerp(a[2], b[2], t)];
}

// Find the Pea: the barker's swaps (pairs of slots) for one shuffle. Never swaps a slot with itself.
export function shellSwaps(seed, count = 6, slots = 3) {
  const rand = mulberry32(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = Math.floor(rand() * slots);
    const b = (a + 1 + Math.floor(rand() * (slots - 1))) % slots;
    out.push([a, b]);
  }
  return out;
}

// Applies swaps to "which shell sits in each slot"; returns the new order.
export function applySwaps(order, swaps) {
  const o = [...order];
  for (const [a, b] of swaps) [o[a], o[b]] = [o[b], o[a]];
  return o;
}

// Where a shell travels while swapping slots: around the outside of a half circle (x, z offset).
export function swapPath(fromX, toX, t, side = 1, depth = 0.22) {
  return [lerp(fromX, toX, t), Math.sin(Math.PI * t) * depth * side];
}

// High Striker: the puck's height on the rail for a reading of 1–10 (10 touches the bell).
export function puckY(height, bottom, top) {
  return lerp(bottom, top, clamp(height / 10));
}

// A small decaying shake for the camera when the bell rings: offset [x, y] at time t (0–1).
export function shake(t, amount = 0.04, rand = Math.random) {
  const k = amount * (1 - clamp(t)) ** 2;
  return [(rand() - 0.5) * 2 * k, (rand() - 0.5) * 2 * k];
}

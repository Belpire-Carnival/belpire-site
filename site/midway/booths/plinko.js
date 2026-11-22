// Plinko: an upright walnut board with brass pins and lit slots. Pick a drop lane (or let the barker pick);
// the heavy brass token clatters down peg by peg into the slot the server rolled.
import { THREE } from '../kit.js';
import { plinkoPath, nearestSlot } from '../choreo.js';
import { room, bulbs, meshy, particles, v3 } from './common.js';

export const SLOT_VALUES = [0, 4, 10, 50, 10, 4, 0];
export const ROWS = 10;
const COL_W = 0.065; // half a peg spacing
const MAX_COL = 12;
const TOP_Y = 2.05;
const ROW_H = 0.11;
const Z = -0.4;
export const colX = (c) => (c - MAX_COL / 2) * COL_W;
export const laneCol = (lane) => lane * 2; // lanes 1–5 sit above columns 2, 4 … 10
const rowY = (i) => TOP_Y - i * ROW_H;

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.1 });
  bulbs(ctx, { y: 2.55, z: -0.7, x0: -0.7, x1: 0.7, n: 9 });
  const board = kit.mesh(new THREE.BoxGeometry(0.98, 1.55, 0.05), mats.walnut);
  board.position.set(0, 1.45, Z - 0.05);
  scene.add(board);
  meshy(ctx, 'plinko/board', { size: 1.75, axis: 'y', anchor: 'base' }, board, (m) => { m.position.set(0, 0.62, Z - 0.2); scene.add(m); });
  // pins: staggered rows
  const pinGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.07, 10);
  const pinCap = new THREE.SphereGeometry(0.016, 10, 8);
  for (let i = 1; i <= ROWS; i++) {
    for (let c = i % 2; c <= MAX_COL; c += 2) {
      const p = kit.mesh(pinGeo, mats.brightBrass, { cast: false });
      p.rotation.x = Math.PI / 2;
      p.position.set(colX(c), rowY(i) + ROW_H / 2, Z);
      const cap = kit.mesh(pinCap, mats.brightBrass, { cast: false });
      cap.position.set(colX(c), rowY(i) + ROW_H / 2, Z + 0.035);
      scene.add(p, cap);
    }
  }
  // slots with lit values
  const slots = SLOT_VALUES.map((v, i) => {
    const x = colX(i * 2);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(COL_W * 1.8, 0.12), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: v === 50 ? 0xffd36b : v ? 0xffb46b : 0x5a2a20, emissiveIntensity: 0.35 }));
    glow.position.set(x, rowY(ROWS) - 0.1, Z - 0.02);
    scene.add(glow);
    if (i) {
      const div = kit.mesh(new THREE.BoxGeometry(0.008, 0.14, 0.06), mats.brass);
      div.position.set(x - COL_W, rowY(ROWS) - 0.1, Z);
      scene.add(div);
    }
    return glow;
  });
  // lane markers at the top
  const lanes = [1, 2, 3, 4, 5].map((lane) => {
    const m = kit.mesh(new THREE.ConeGeometry(0.02, 0.05, 12), mats.brass);
    m.rotation.x = Math.PI;
    m.position.set(colX(laneCol(lane)), TOP_Y + 0.12, Z);
    m.userData.choice = String(lane);
    scene.add(m);
    return m;
  });
  const token = new THREE.Group();
  const disc = kit.mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.018, 24), mats.brightBrass);
  disc.rotation.x = Math.PI / 2;
  token.add(disc);
  token.position.set(colX(6), TOP_Y + 0.1, Z + 0.06);
  scene.add(token);
  meshy(ctx, 'plinko/puck', { size: 0.1 }, disc, (m) => token.add(m));
  const sparks = particles(ctx);
  let path = null;
  let slot = -1;

  return {
    camera: { pos: [0, 1.5, 1.45], target: [0, 1.45, -0.4], fov: 46, fovPortrait: 68, dolly: 1.1 },
    controls: [1, 2, 3, 4, 5].map((l) => ({ label: `Lane ${l}`, choice: String(l) })).concat([{ label: 'Any lane', choice: null, primary: true }]),
    pickables: lanes,
    waiting: 'The token teeters…',
    winPoint: () => (slot >= 0 ? v3(colX(slot * 2), rowY(ROWS), Z) : null),
    intro() { ctx.setHint('Pick a lane to drop from. The 50 in the middle is the prize slot.'); },
    hover(choice) { lanes.forEach((l) => l.scale.setScalar(l.userData.choice === choice ? 1.4 : 1)); },
    async play(choice, pending) {
      const r = await pending;
      const v = r.visualParams;
      const start = laneCol(v.lane);
      slot = nearestSlot(SLOT_VALUES, v.slot, start);
      path = plinkoPath(start, slot * 2, ROWS, MAX_COL, ctx.rand);
      token.position.set(colX(start), TOP_Y + 0.1, Z + 0.06);
      await tween(200, (t) => { token.position.y = TOP_Y + 0.1 - 0.1 * t; }, (t) => t * t);
      for (let i = 1; i < path.length; i++) {
        const x0 = colX(path[i - 1]);
        const x1 = colX(path[i]);
        const y0 = rowY(i - 1);
        const y1 = rowY(i);
        await tween(110 + i * 4, (t) => {
          token.position.x = x0 + (x1 - x0) * t;
          token.position.y = y0 + (y1 - y0) * t + Math.sin(Math.PI * t) * 0.025;
          token.rotation.z += (x1 > x0 ? -0.35 : 0.35);
        }, (t) => t);
        audio.clink(1.6 + (i % 3) * 0.1);
      }
      await tween(160, (t) => { token.position.y = rowY(ROWS) - 0.08 * t; }, (t) => t * t);
      audio.knock(0.6);
      sparks.fire(token.position, { count: v.slot >= 10 ? 50 : 14, speed: 0.8, up: 1, seconds: 0.7 });
      await tween(500, (t) => { slots[slot].material.emissiveIntensity = 0.35 + 2 * Math.sin(Math.PI * t); });
      return r;
    },
    async reset() {
      await sleep(250);
      token.position.set(colX(6), TOP_Y + 0.1, Z + 0.06);
      token.rotation.set(0, 0, 0);
      path = null;
      slot = -1;
    },
    update(dt) { sparks.update(dt); },
    _state: () => ({ path: path && [...path], slot, value: slot >= 0 ? SLOT_VALUES[slot] : null, tokenX: token.position.x })
  };
}

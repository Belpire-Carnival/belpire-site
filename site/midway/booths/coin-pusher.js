// Coin Pusher: a brass-and-mahogany cabinet with a reciprocating shelf packed with Sliver coins.
// Pick a drop slot; your coin lands on the moving shelf and the chain reaction tips over as many coins as the
// server rolled (none, a trickle, a cascade or an avalanche).
import { THREE } from '../kit.js';
import { coinsForTier } from '../choreo.js';
import { room, bulbs, meshy, particles, v3 } from './common.js';

const SHELF_Y = 1.0;
const EDGE_Z = 0.05; // the drop-off edge of the lower shelf
const SLOT_X = [-0.22, 0, 0.22];
const TRAY_Y = 0.62;

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.3 });
  bulbs(ctx, { y: 2.35, z: -0.9, x0: -0.7, x1: 0.7, n: 9 });
  const cabinet = new THREE.Group();
  const frame = kit.mesh(new THREE.BoxGeometry(0.8, 1.7, 0.7), mats.walnut);
  frame.position.set(0, 0.85, -0.32);
  frame.material = mats.walnut.clone();
  frame.material.side = THREE.BackSide;
  cabinet.add(frame);
  scene.add(cabinet);
  meshy(ctx, 'coin-pusher/cabinet', { size: 2.0, axis: 'y', anchor: 'base' }, frame, (m) => { m.position.z = -0.95; scene.add(m); });
  const lower = kit.mesh(new THREE.BoxGeometry(0.66, 0.03, 0.6), mats.brass);
  lower.position.set(0, SHELF_Y - 0.02, EDGE_Z - 0.3);
  const pusher = kit.mesh(new THREE.BoxGeometry(0.66, 0.08, 0.3), mats.brass);
  pusher.position.set(0, SHELF_Y + 0.04, -0.5);
  const tray = kit.mesh(new THREE.BoxGeometry(0.66, 0.04, 0.2), mats.iron);
  tray.position.set(0, TRAY_Y, EDGE_Z + 0.12);
  const slots = SLOT_X.map((x, i) => {
    const s = kit.mesh(new THREE.BoxGeometry(0.08, 0.02, 0.02), mats.brightBrass);
    s.position.set(x, SHELF_Y + 0.82, EDGE_Z);
    s.userData.choice = String(i + 1);
    return s;
  });
  scene.add(lower, pusher, tray, ...slots);

  // the coins on the shelf: plain discs until the Meshy coin loads
  const coinGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.008, 20);
  const coins = [];
  for (let i = 0; i < 36; i++) {
    const g = new THREE.Group();
    const d = kit.mesh(coinGeo, mats.brightBrass);
    g.add(d);
    const row = Math.floor(i / 9);
    g.userData = { stand: d, home: v3(-0.28 + (i % 9) * 0.07 + (row % 2) * 0.03, SHELF_Y + 0.006 + (i % 3 === 0 ? 0.008 : 0), EDGE_Z - 0.04 - row * 0.07), front: row === 0 };
    g.position.copy(g.userData.home);
    g.rotation.y = i;
    scene.add(g);
    coins.push(g);
  }
  meshy(ctx, 'shared/sliver-coin', { size: 0.07 }, coins.map((c) => c.userData.stand), (m) => {
    coins.forEach((c, i) => { const k = i ? m.clone(true) : m; k.rotation.x = Math.PI / 2; c.add(k); });
  });
  const drop = new THREE.Group();
  const dropDisc = kit.mesh(coinGeo, mats.gold);
  drop.add(dropDisc);
  drop.visible = false;
  scene.add(drop);
  const sparks = particles(ctx);
  let fell = 0;
  let time = 0;

  return {
    camera: { pos: [0, 1.5, 1.5], target: [0, 1.05, -0.25], fov: 44, fovPortrait: 64, dolly: 1.2 },
    controls: [1, 2, 3].map((n) => ({ label: `Slot ${n}`, choice: String(n) })).concat([{ label: 'Drop a coin', choice: null, primary: true }]),
    pickables: slots,
    waiting: 'Your coin rattles down…',
    winPoint: () => (fell ? v3(0, TRAY_Y + 0.1, EDGE_Z + 0.12) : null),
    intro() { ctx.setHint('Pick a slot and drop a Sliver. Watch the edge.'); },
    async play(choice, pending) {
      const r = await pending;
      const x = SLOT_X[r.visualParams.slot - 1];
      drop.visible = true;
      drop.position.set(x, SHELF_Y + 0.8, EDGE_Z - 0.1);
      await tween(520, (t) => { drop.position.y = SHELF_Y + 0.8 - 0.78 * t * t; drop.rotation.x = t * 12; }, (t) => t);
      audio.clink(1.3);
      drop.rotation.set(0, 0, 0);
      fell = coinsForTier(r.outcomeTier, ctx.rand);
      // the front row (and then the next) tips over the edge, nearest the drop first
      const order = coins.slice().sort((a, b) => (b.userData.home.z - a.userData.home.z) * 10 + Math.abs(a.userData.home.x - x) - Math.abs(b.userData.home.x - x));
      const falling = order.slice(0, fell);
      await tween(600, (t) => { drop.position.z = EDGE_Z - 0.1 + 0.05 * t; }, (t) => t);
      if (fell) {
        await tween(700, (t) => {
          falling.forEach((c, i) => {
            const k = Math.min(1, Math.max(0, t * 1.6 - i * 0.04));
            const h = c.userData.home;
            c.position.set(h.x, h.y - (h.y - TRAY_Y - 0.02) * k * k, h.z + (EDGE_Z + 0.1 - h.z) * k);
            c.rotation.x = k * 2.2;
          });
        }, (t) => t);
        audio.coins(Math.min(16, fell + 2));
        sparks.fire(v3(x, TRAY_Y + 0.05, EDGE_Z + 0.12), { count: 10 + fell * 4, speed: 0.6, up: 0.7, seconds: 0.7 });
      } else {
        await tween(500, (t) => coins.forEach((c) => { if (c.userData.front) c.position.z = c.userData.home.z + Math.sin(Math.PI * t) * 0.02; }));
        audio.lose();
      }
      return r;
    },
    async reset() {
      await sleep(400);
      for (const c of coins) { c.position.copy(c.userData.home); c.rotation.x = 0; }
      drop.visible = false;
      fell = 0;
    },
    update(dt) {
      sparks.update(dt);
      if (ctx.reduced) return;
      time += dt;
      pusher.position.z = -0.5 + Math.sin(time * 1.2) * 0.06;
    },
    _state: () => ({ fell, inTray: coins.filter((c) => c.position.y < SHELF_Y - 0.1).length })
  };
}

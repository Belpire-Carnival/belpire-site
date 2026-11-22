// Milk Bottle Knockdown: six weighted bottles stacked 3-2-1 on a pedestal and one stitched baseball.
// Throw (button, tap, or a flick on the canvas); exactly as many bottles tumble as the server rolled.
import { THREE } from '../kit.js';
import { fallenBottles } from '../choreo.js';
import { room, bulbs, meshy, fly, particles, v3 } from './common.js';

const PED_Y = 1.0;
const BH = 0.22; // bottle height
const BW = 0.1;
export const SLOTS = [
  [-BW, 0], [0, 0], [BW, 0], // bottom row
  [-BW / 2, 1], [BW / 2, 1], // middle
  [0, 2] // top
].map(([x, row]) => [x, PED_Y + row * BH]);
const START = [0.1, 1.0, 1.7];

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.2 });
  bulbs(ctx, { y: 2.05, z: -0.9 });
  const pedestal = kit.mesh(new THREE.CylinderGeometry(0.26, 0.3, PED_Y, 24), mats.walnut);
  pedestal.position.set(0, PED_Y / 2, -0.3);
  const top = kit.mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.02, 24), mats.brass);
  top.position.set(0, PED_Y + 0.001, -0.3);
  const counter = kit.mesh(new THREE.BoxGeometry(2.4, 0.9, 0.4), mats.walnut);
  counter.position.set(0, 0.45, 1.2);
  scene.add(pedestal, top, counter);

  const cream = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, metalness: 0.4, roughness: 0.5 });
  const bottleGeo = kit.lathe([[0, 0], [0.045, 0], [0.048, 0.02], [0.048, 0.13], [0.03, 0.18], [0.024, 0.21], [0.026, BH], [0, BH]], 20);
  const bottles = SLOTS.map(([x, y]) => {
    const g = new THREE.Group();
    const b = kit.mesh(bottleGeo, cream);
    g.add(b);
    g.position.set(x, y, -0.3);
    g.userData = { stand: b, home: [x, y, -0.3] };
    scene.add(g);
    return g;
  });
  meshy(ctx, 'milk-bottle-knockdown/bottle', { size: BH * 0.98, axis: 'y', anchor: 'base' }, bottles.map((b) => b.userData.stand), (m) => {
    bottles.forEach((b, i) => b.add(i ? m.clone(true) : m));
  });

  const ball = new THREE.Group();
  const stitched = kit.mesh(new THREE.SphereGeometry(0.037, 20, 14), new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.8 }));
  ball.add(stitched);
  ball.position.set(...START);
  scene.add(ball);
  meshy(ctx, 'milk-bottle-knockdown/ball', { size: 0.075 }, stitched, (m) => ball.add(m));
  const dust = particles(ctx);

  // flick to throw: a quick upward drag on the canvas throws (the result is still the server's)
  let down = null;
  const canvas = ctx.canvas;
  const onDown = (e) => { down = { y: e.clientY, t: performance.now() }; };
  const onUp = (e) => {
    if (down && down.y - e.clientY > 40 && performance.now() - down.t < 600) ctx.request?.(null);
    down = null;
  };
  canvas?.addEventListener('pointerdown', onDown);
  canvas?.addEventListener('pointerup', onUp);

  let fallen = [];
  return {
    camera: { pos: [0, 1.4, 2.4], target: [0, 1.15, -0.3], fov: 40, fovPortrait: 58, dolly: 1.2 },
    controls: [{ label: 'Throw the baseball', choice: null, primary: true }],
    pickables: [ball],
    waiting: 'You wind up…',
    winPoint: () => v3(0, PED_Y + 0.3, -0.3),
    intro() { ctx.setHint('Throw with the button, or flick up on the booth. Knock all six down for the top prize.'); },
    async play(choice, pending) {
      await tween(260, (t) => { ball.position.y = START[1] - 0.1 * Math.sin(Math.PI * t); });
      const r = await pending;
      const k = r.visualParams.knocked;
      fallen = fallenBottles(k);
      // aim: high for one or two (the top), into the middle of the stack for more
      const aimY = k <= 1 ? SLOTS[5][1] + 0.12 : k <= 3 ? SLOTS[3][1] + 0.1 : SLOTS[0][1] + 0.12;
      const aim = k === 0 ? [0.35, aimY + 0.25, -0.35] : [0, aimY, -0.24];
      await fly(ctx, ball, START, aim, { height: 0.18, ms: 420, spin: [10, 2, 0] });
      if (k) {
        audio.knock(1.2);
        audio.clink(0.7);
        dust.fire(v3(aim[0], aim[1], aim[2]), { count: 24, colors: [0xc8b89a], speed: 0.7, up: 0.5, seconds: 0.6, size: 0.02 });
        await tween(620, (t) => {
          fallen.forEach((i, n) => {
            const b = bottles[i];
            const [x, y, z] = b.userData.home;
            const side = x === 0 ? (n % 2 ? 1 : -1) : Math.sign(x);
            b.position.set(x + side * 0.25 * t, y + 0.12 * Math.sin(Math.PI * t) - (y + 0.0) * t * t * 0.9, z - 0.35 * t);
            b.rotation.set(-1.4 * t, 0, side * 1.2 * t);
          });
          // the ball drops behind the pedestal
          ball.position.set(aim[0], aim[1] - aim[1] * 0.8 * t * t, aim[2] - 0.4 * t);
        }, (t) => t);
        audio.knock(0.6);
      } else {
        audio.knock(0.3);
        await fly(ctx, ball, aim, [0.7, 0.05, -0.9], { height: 0.05, ms: 380 });
      }
      // the ones left standing wobble
      await tween(420, (t) => bottles.forEach((b, i) => { if (!fallen.includes(i)) b.rotation.z = Math.sin(t * Math.PI * 5) * 0.05 * (1 - t); }));
      return r;
    },
    async reset() {
      await sleep(300);
      for (const b of bottles) {
        b.position.set(...b.userData.home);
        b.rotation.set(0, 0, 0);
      }
      ball.position.set(...START);
      ball.rotation.set(0, 0, 0);
      fallen = [];
    },
    update(dt) { dust.update(dt); },
    dispose() {
      canvas?.removeEventListener('pointerdown', onDown);
      canvas?.removeEventListener('pointerup', onUp);
    },
    _state: () => ({ standing: bottles.filter((b) => b.position.y >= PED_Y - 0.01 && Math.abs(b.rotation.x) < 0.1).length })
  };
}

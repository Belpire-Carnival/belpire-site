// Knife Thrower: the Wheel of Death turns slowly, a painted volunteer and a red apple at the crown. Throw:
// a bust clatters off, an edge thuds into the rim, a shave lands a hair from the apple, and the best throw
// splits the apple clean in two.
import { THREE } from '../kit.js';
import { room, bulbs, meshy, fly, particles, v3 } from './common.js';

const HUB = [0, 1.45, -0.6];
const R = 0.62;
const START = [0.25, 1.05, 1.6];
const SPIN = 0.35; // radians a second

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.3, curtainY: 2.2 });
  bulbs(ctx, { y: 2.45, z: -1.0, x0: -1.0, x1: 1.0 });
  const wheel = new THREE.Group();
  wheel.position.set(...HUB);
  const planks = kit.mesh(new THREE.CylinderGeometry(R, R, 0.05, 48), mats.oak);
  planks.rotation.x = Math.PI / 2;
  const rim = kit.mesh(new THREE.TorusGeometry(R, 0.02, 8, 64), mats.iron);
  // the painted silhouette: a cream figure, arms out
  const paint = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.8 });
  const torso = kit.mesh(new THREE.BoxGeometry(0.16, 0.42, 0.005), paint, { cast: false });
  torso.position.set(0, -0.05, 0.03);
  const head = kit.mesh(new THREE.CircleGeometry(0.07, 20), paint, { cast: false });
  head.position.set(0, 0.25, 0.03);
  const arms = kit.mesh(new THREE.BoxGeometry(0.62, 0.06, 0.005), paint, { cast: false });
  arms.position.set(0, 0.1, 0.03);
  const legs = kit.mesh(new THREE.BoxGeometry(0.3, 0.06, 0.005), paint, { cast: false });
  legs.position.set(0, -0.32, 0.03);
  legs.rotation.z = Math.PI / 2;
  wheel.add(planks, rim, torso, head, arms, legs);
  scene.add(wheel);
  meshy(ctx, 'knife-thrower/wheel', { size: R * 2.05 }, [planks, rim], (m) => { m.position.z = -0.02; wheel.add(m); });
  // the apple at the crown (on the wheel, so it turns with it)
  const apple = new THREE.Group();
  apple.position.set(0, 0.42, 0.07);
  const appleMat = new THREE.MeshStandardMaterial({ color: 0xa8141e, roughness: 0.35 });
  const halves = [-1, 1].map((side) => {
    const h = kit.mesh(new THREE.SphereGeometry(0.045, 20, 14, side < 0 ? 0 : Math.PI, Math.PI), appleMat);
    h.userData.side = side;
    return h;
  });
  const stalk = kit.mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.03, 6), mats.walnut);
  stalk.position.y = 0.05;
  apple.add(...halves, stalk);
  wheel.add(apple);
  const stand = kit.mesh(new THREE.BoxGeometry(0.12, HUB[1], 0.12), mats.walnut);
  stand.position.set(0, HUB[1] / 2, HUB[2] - 0.1);
  const counter = kit.mesh(new THREE.BoxGeometry(2.4, 0.9, 0.4), mats.walnut);
  counter.position.set(0, 0.45, 1.3);
  scene.add(stand, counter);

  const knife = new THREE.Group();
  const blade = kit.mesh(new THREE.BoxGeometry(0.012, 0.16, 0.003), new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 1, roughness: 0.2 }));
  blade.position.y = 0.08;
  const grip = kit.mesh(new THREE.BoxGeometry(0.018, 0.09, 0.01), mats.walnut);
  grip.position.y = -0.045;
  knife.add(blade, grip);
  knife.position.set(...START);
  scene.add(knife);
  meshy(ctx, 'knife-thrower/dagger', { size: 0.26, axis: 'y' }, [blade, grip], (m) => { m.rotation.x = Math.PI; knife.add(m); });
  const chips = particles(ctx);
  let stuck = null;
  let split = false;
  let spinning = true;
  const local = new THREE.Vector3();

  // a point on the wheel (wheel-local x, y) to world, at this moment
  const toWorld = (x, y) => wheel.localToWorld(local.set(x, y, 0.06)).clone();

  return {
    camera: { pos: [0.15, 1.4, 2.4], target: [0, 1.4, -0.6], fov: 42, fovPortrait: 62, dolly: 1.2 },
    controls: [{ label: 'Throw the knife', choice: null, primary: true }],
    pickables: [wheel],
    waiting: 'You weigh the blade…',
    winPoint: () => (split ? apple.getWorldPosition(new THREE.Vector3()) : null),
    intro() { ctx.setHint('Split the apple for the top prize. Do it on all three throws today for a 50-Sliver sweep bonus.'); },
    async play(choice, pending) {
      await tween(220, (t) => { knife.position.y = START[1] + 0.06 * Math.sin(Math.PI * t); });
      const r = await pending;
      const tier = r.outcomeTier;
      spinning = false;
      // where on the wheel it goes (wheel-local), by tier
      const a = (ctx.rand() - 0.5) * 1.6;
      const spot = {
        bust: null,
        edge: [Math.sin(a + 2.4) * (R - 0.06), Math.cos(a + 2.4) * (R - 0.06)],
        shave: [0.07 * (ctx.rand() < 0.5 ? -1 : 1), 0.4],
        apple: [0, 0.42]
      }[tier];
      const to = spot ? toWorld(...spot) : toWorld(R + 0.05, 0.2);
      knife.rotation.set(0, 0, 0);
      await fly(ctx, knife, START, [to.x, to.y, to.z + 0.08], { height: 0.12, ms: 420, spin: [Math.PI * 4, 0, 0] });
      knife.rotation.set(-Math.PI / 2, 0, 0); // point first into the planks
      if (!spot) {
        audio.clink(0.5);
        await fly(ctx, knife, [to.x, to.y, to.z + 0.08], [to.x + 0.3, 0.03, to.z + 0.5], { height: 0.1, ms: 420, spin: [3, 2, 0] });
      } else {
        audio.knock(1);
        // stick it into the wheel so it turns with it
        wheel.attach(knife);
        stuck = knife;
        chips.fire(to, { count: 18, colors: [0xc8a070, 0x8a6040], speed: 0.6, up: 0.5, seconds: 0.5, size: 0.02 });
        if (tier === 'apple') {
          split = true;
          audio.slide();
          await tween(500, (t) => halves.forEach((h) => { h.position.x = h.userData.side * 0.06 * t; h.position.y = -0.1 * t * t; h.rotation.z = h.userData.side * -0.6 * t; }), (t) => t);
          chips.fire(apple.getWorldPosition(new THREE.Vector3()), { count: 30, colors: [0xf0e0b0, 0xa8141e], speed: 0.8, up: 0.8, seconds: 0.7, size: 0.02 });
        } else {
          await tween(300, (t) => { knife.rotation.z = Math.sin(t * Math.PI * 6) * 0.05 * (1 - t); });
        }
      }
      spinning = true;
      return r;
    },
    async reset() {
      await sleep(300);
      if (stuck) scene.attach(knife);
      knife.position.set(...START);
      knife.rotation.set(0, 0, 0);
      halves.forEach((h) => { h.position.set(0, 0, 0); h.rotation.set(0, 0, 0); });
      stuck = null;
      split = false;
    },
    update(dt) {
      chips.update(dt);
      if (spinning && !ctx.reduced) wheel.rotation.z += SPIN * dt;
    },
    _state: () => ({ stuck: Boolean(stuck), split, nearApple: stuck ? knife.position.distanceTo(apple.position) : null })
  };
}

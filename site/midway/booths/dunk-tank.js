// Dunk Tank: a glass tank of dark teal water, a jester dummy on the seat and a hinged bullseye on the arm.
// Throw: a miss draws heckling, a clank rattles the plate, a graze shakes the seat, a direct hit drops him in.
import { THREE } from '../kit.js';
import { room, bulbs, meshy, fly, particles, v3 } from './common.js';

const TANK = { x: 0.2, y: 0.55, z: -0.7, w: 1.0, h: 1.1, d: 0.8 };
const SEAT_Y = TANK.y + TANK.h / 2 + 0.25;
const TARGET = [-0.6, 1.35, -0.55];
const START = [0.15, 1.0, 1.7];
const HECKLES = ['"Is that all you\'ve got?"', '"My grandmother throws harder!"', '"Over here! No, HERE!"', '"Ha! Not even close!"', '"Try using your arm next time!"'];

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.6 });
  bulbs(ctx, { y: 2.4, z: -1.3, x0: -1.1, x1: 1.1 });
  const counter = kit.mesh(new THREE.BoxGeometry(2.4, 0.9, 0.4), mats.walnut);
  counter.position.set(0, 0.45, 1.25);
  scene.add(counter);

  // the tank: glass walls, iron frame, water
  const glass = ctx.low ? mats.glass(0x9fd8d0) : new THREE.MeshPhysicalMaterial({ color: 0xcfe8e4, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0 });
  const tank = new THREE.Group();
  tank.position.set(TANK.x, TANK.y, TANK.z);
  const walls = kit.mesh(new THREE.BoxGeometry(TANK.w, TANK.h, TANK.d), glass, { cast: false });
  const water = kit.mesh(new THREE.BoxGeometry(TANK.w - 0.04, TANK.h * 0.7, TANK.d - 0.04), new THREE.MeshPhysicalMaterial({ color: 0x0f4a4a, transparent: true, opacity: 0.45, roughness: 0.05, transmission: ctx.low ? 0 : 0.4 }), { cast: false });
  water.position.y = -TANK.h * 0.15;
  const frame = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => {
    const p = kit.mesh(new THREE.BoxGeometry(0.04, TANK.h + 0.5, 0.04), mats.iron);
    p.position.set(sx * TANK.w / 2, 0.25, sz * TANK.d / 2);
    return p;
  });
  tank.add(walls, water, ...frame);
  scene.add(tank);

  // the seat (hinged) and the jester
  const seat = new THREE.Group();
  seat.position.set(TANK.x - TANK.w / 2 + 0.05, SEAT_Y, TANK.z);
  const plank = kit.mesh(new THREE.BoxGeometry(0.6, 0.04, 0.3), mats.oak);
  plank.position.x = 0.3;
  seat.add(plank);
  scene.add(seat);
  const jester = new THREE.Group();
  jester.position.set(TANK.x, SEAT_Y + 0.02, TANK.z);
  const body = kit.mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.45, 12), new THREE.MeshStandardMaterial({ color: 0x5a1020, roughness: 0.8 }));
  body.position.y = 0.22;
  const head = kit.mesh(new THREE.SphereGeometry(0.08, 16, 12), new THREE.MeshStandardMaterial({ color: 0xe8d8c0, roughness: 0.6 }));
  head.position.y = 0.52;
  jester.add(body, head);
  scene.add(jester);
  meshy(ctx, 'dunk-tank/jester', { size: 0.85, axis: 'y', anchor: 'base' }, [body, head], (m) => { m.position.y = -0.05; jester.add(m); });

  // the target on its arm
  const target = new THREE.Group();
  target.position.set(...TARGET);
  const plate = new THREE.Group();
  for (const [r, mat] of [[0.17, mats.iron], [0.12, mats.velvet], [0.07, mats.brass], [0.03, mats.velvet]]) {
    const ring = kit.mesh(new THREE.CylinderGeometry(r, r, 0.02, 28), mat);
    ring.rotation.x = Math.PI / 2;
    plate.add(ring);
  }
  const arm = kit.mesh(new THREE.BoxGeometry(0.06, 0.95, 0.06), mats.iron);
  arm.position.y = -0.55;
  target.add(plate, arm);
  scene.add(target);
  meshy(ctx, 'dunk-tank/target', { size: 0.38 }, [...plate.children], (m) => { m.rotation.y = Math.PI / 2; plate.add(m); });

  const ball = kit.mesh(new THREE.SphereGeometry(0.037, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.8 }));
  ball.position.set(...START);
  scene.add(ball);
  meshy(ctx, 'milk-bottle-knockdown/ball', { size: 0.075 }, null, (m) => { ball.material.visible = false; ball.add(m); });
  const splash = particles(ctx, 220);
  let dunked = false;

  return {
    camera: { pos: [0.1, 1.45, 2.6], target: [-0.1, 1.15, -0.6], fov: 44, fovPortrait: 62, dolly: 1.2 },
    controls: [{ label: 'Throw at the target', choice: null, primary: true }],
    pickables: [target],
    waiting: 'The jester sneers…',
    winPoint: () => (dunked ? v3(TANK.x, TANK.y + 0.3, TANK.z) : null),
    intro() { ctx.setHint('Hit the bullseye to dunk him. Dunk him on all three throws today for a 50-Sliver sweep bonus.'); },
    async play(choice, pending) {
      await tween(220, (t) => { ball.position.y = START[1] - 0.08 * Math.sin(Math.PI * t); });
      const r = await pending;
      const tier = r.outcomeTier;
      const aim = {
        miss: [TARGET[0] - 0.45, TARGET[1] + 0.3, TARGET[2] - 0.2],
        clank: [TARGET[0] + 0.15, TARGET[1] + 0.12, TARGET[2] + 0.02],
        graze: [TARGET[0] + 0.08, TARGET[1] - 0.05, TARGET[2] + 0.02],
        dunk: [TARGET[0], TARGET[1], TARGET[2] + 0.02]
      }[tier];
      await fly(ctx, ball, START, aim, { height: 0.25, ms: 480, spin: [12, 3, 0] });
      if (tier === 'miss') {
        ctx.setHint(`The jester: ${HECKLES[Math.floor(ctx.rand() * HECKLES.length)]}`);
        audio.lose();
        await fly(ctx, ball, aim, [aim[0] - 0.3, 0.05, aim[2] - 0.4], { height: 0.05, ms: 400 });
        await tween(500, (t) => { jester.rotation.z = Math.sin(t * Math.PI * 4) * 0.08; });
      } else {
        audio.clink(tier === 'clank' ? 0.5 : 0.8);
        audio.knock(tier === 'dunk' ? 1.2 : 0.7);
        await tween(tier === 'dunk' ? 160 : 360, (t) => { target.rotation.y = Math.sin(t * Math.PI * (tier === 'dunk' ? 1 : 6)) * (tier === 'clank' ? 0.25 : 0.5) * (tier === 'dunk' ? 1 : 1 - t); });
        if (tier === 'graze') await tween(500, (t) => { seat.rotation.z = Math.sin(t * Math.PI * 5) * 0.06 * (1 - t); jester.position.y = SEAT_Y + 0.02 + Math.abs(Math.sin(t * Math.PI * 5)) * 0.02; });
        if (tier === 'dunk') {
          dunked = true;
          await tween(160, (t) => { seat.rotation.z = -1.3 * t; }, (t) => t);
          audio.knock(0.4);
          await tween(420, (t) => {
            jester.position.y = SEAT_Y + 0.02 - (SEAT_Y - TANK.y) * t * t;
            jester.rotation.z = 0.5 * t;
          }, (t) => t);
          splash.fire(v3(TANK.x, TANK.y + TANK.h * 0.25, TANK.z), { count: 200, colors: [0x9fe0e0, 0xffffff, 0x3a8a8a], speed: 1.6, up: 2.4, seconds: 1.3, size: 0.035 });
          audio.slide();
        }
        ball.position.set(0, -5, 0);
      }
      return r;
    },
    async reset() {
      await sleep(dunked ? 600 : 200);
      if (dunked) {
        await tween(500, (t) => { jester.position.y = TANK.y + (SEAT_Y + 0.02 - TANK.y) * t; jester.rotation.z = 0.5 * (1 - t); });
      }
      seat.rotation.z = 0;
      target.rotation.y = 0;
      jester.position.y = SEAT_Y + 0.02;
      jester.rotation.z = 0;
      ball.position.set(...START);
      dunked = false;
    },
    update(dt, t) {
      splash.update(dt);
      if (!ctx.reduced && !dunked) jester.rotation.y = Math.sin(t * 0.7) * 0.15;
    },
    _state: () => ({ dunked, jesterY: jester.position.y })
  };
}

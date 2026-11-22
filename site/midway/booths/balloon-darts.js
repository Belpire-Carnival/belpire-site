// Balloon Darts: a swaying corkboard pinned with glossy balloons and gold stars. Throw a brass-feathered dart:
// a dud sticks in bare cork, a hit pops a small or large balloon in a burst of confetti, the best throw finds a star.
import { THREE } from '../kit.js';
import { room, bulbs, meshy, fly, particles, v3 } from './common.js';

const BOARD_Z = -0.6;
const COLORS = [0x8e1b2b, 0xb5651d, 0x1f7a4a, 0x3a2a6b, 0xb8944f];
const START = [0.15, 1.05, 1.6];

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -0.9 });
  bulbs(ctx, { y: 2.25, z: -0.7, x0: -0.9, x1: 0.9, n: 9 });
  const board = new THREE.Group();
  board.position.set(0, 1.35, BOARD_Z);
  const cork = kit.mesh(new THREE.BoxGeometry(1.5, 1.1, 0.04), new THREE.MeshStandardMaterial({ color: 0x9c7a52, roughness: 0.95 }));
  const frame = kit.mesh(new THREE.BoxGeometry(1.62, 1.22, 0.03), mats.walnut);
  frame.position.z = -0.02;
  board.add(cork, frame);
  scene.add(board);
  meshy(ctx, 'balloon-darts/board', { size: 1.62 }, [cork, frame], (m) => { m.position.z = -0.01; board.add(m); });
  const counter = kit.mesh(new THREE.BoxGeometry(2.4, 0.9, 0.4), mats.walnut);
  counter.position.set(0, 0.45, 1.2);
  scene.add(counter);

  // a grid of balloons (small and large) with a few gold stars among them
  const balloons = [];
  const stars = [];
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.025 : 0.055;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    starShape[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.01, bevelEnabled: false });
  const knotGeo = new THREE.ConeGeometry(0.012, 0.02, 8);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 6; col++) {
      const x = -0.6 + col * 0.24 + (row % 2) * 0.06;
      const y = 0.38 - row * 0.25;
      if ((row + col) % 7 === 3) {
        const s = kit.mesh(starGeo, mats.gold);
        s.position.set(x, y, 0.03);
        board.add(s);
        stars.push(s);
        continue;
      }
      const large = (row * 6 + col) % 3 === 0;
      const r = large ? 0.075 : 0.05;
      const mat = new THREE.MeshPhysicalMaterial({ color: COLORS[(row + col) % COLORS.length], roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1 });
      const b = kit.mesh(new THREE.SphereGeometry(r, 20, 16), mat);
      b.scale.y = 1.15;
      b.position.set(x, y, 0.02 + r);
      const knot = kit.mesh(knotGeo, mat);
      knot.position.y = -r * 1.15;
      knot.rotation.x = Math.PI;
      b.add(knot);
      b.userData = { large, r, home: b.position.clone() };
      board.add(b);
      balloons.push(b);
    }
  }

  const dart = new THREE.Group();
  const shaft = kit.mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 8), mats.brass);
  shaft.rotation.x = Math.PI / 2;
  const tip = kit.mesh(new THREE.ConeGeometry(0.006, 0.04, 8), mats.iron);
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -0.1;
  const flight = kit.mesh(new THREE.BoxGeometry(0.05, 0.002, 0.05), new THREE.MeshStandardMaterial({ color: 0x8e1b2b }));
  flight.position.z = 0.07;
  dart.add(shaft, tip, flight);
  dart.position.set(...START);
  scene.add(dart);
  meshy(ctx, 'balloon-darts/dart', { size: 0.2 }, [shaft, tip, flight], (m) => { m.rotation.y = -Math.PI / 2; dart.add(m); });
  const confetti = particles(ctx, 200);

  let popped = null;
  const world = (o) => o.getWorldPosition(new THREE.Vector3());
  const pick = (arr) => arr[Math.floor(ctx.rand() * arr.length)];

  return {
    camera: { pos: [0, 1.4, 2.5], target: [0, 1.32, -0.6], fov: 40, fovPortrait: 60, dolly: 1.2 },
    controls: [{ label: 'Throw a dart', choice: null, primary: true }],
    pickables: [board],
    waiting: 'You take aim…',
    winPoint: () => (popped ? world(popped) : null),
    intro() { ctx.setHint('Pop a balloon for a prize. Hit a gold star for the big one.'); },
    async play(choice, pending) {
      await tween(240, (t) => { dart.position.z = START[2] + 0.08 * Math.sin(Math.PI * t); });
      const r = await pending;
      const tier = r.outcomeTier;
      let target;
      if (tier === 'star') target = pick(stars);
      else if (tier === 'small') target = pick(balloons.filter((b) => !b.userData.large && b.visible));
      else if (tier === 'large') target = pick(balloons.filter((b) => b.userData.large && b.visible));
      const to = target ? world(target).add(v3(0, 0, 0.02)) : world(board).add(v3((ctx.rand() - 0.5) * 1.2, (ctx.rand() - 0.5) * 0.9, 0.04));
      if (!target) {
        // land in a gap between balloons
        for (const b of balloons) if (world(b).distanceTo(to) < 0.1) to.x += 0.12;
      }
      await fly(ctx, dart, START, [to.x, to.y, to.z + 0.08], { height: 0.12, ms: 420 });
      popped = target;
      if (tier === 'small' || tier === 'large') {
        audio.knock(0.9);
        confetti.fire(to, { count: tier === 'large' ? 90 : 50, colors: [0x8e1b2b, 0xffd36b, 0x1f7a4a, 0xf0e2c0], speed: 1.4, up: 1.4, seconds: 1.1 });
        target.visible = false;
      } else if (tier === 'star') {
        audio.bell();
        confetti.fire(to, { count: 80, colors: [0xffd36b, 0xffffff], speed: 1.6, up: 1.6, seconds: 1.2 });
        await tween(600, (t) => { target.rotation.z = t * Math.PI * 4; target.scale.setScalar(1 + Math.sin(Math.PI * t) * 0.4); });
      } else {
        audio.knock(0.5);
        await tween(300, (t) => { dart.rotation.x = Math.sin(t * Math.PI * 6) * 0.08 * (1 - t); });
      }
      await sleep(200);
      return r;
    },
    async reset() {
      await sleep(250);
      for (const b of balloons) b.visible = true;
      for (const s of stars) { s.rotation.z = 0; s.scale.setScalar(1); }
      dart.position.set(...START);
      dart.rotation.set(0, 0, 0);
      popped = null;
    },
    update(dt, t) {
      confetti.update(dt);
      if (ctx.reduced) return;
      board.rotation.z = Math.sin(t * 0.5) * 0.008;
      for (const b of balloons) b.position.y = b.userData.home.y + Math.sin(t * 1.3 + b.userData.home.x * 7) * 0.006;
    },
    _state: () => ({
      popped: popped ? (stars.includes(popped) ? 'star' : popped.userData.large ? 'large' : 'small') : null,
      visible: balloons.filter((b) => b.visible).length,
      dart: dart.position.clone()
    })
  };
}

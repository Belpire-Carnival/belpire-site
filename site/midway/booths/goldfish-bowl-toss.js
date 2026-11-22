// Goldfish Bowl Toss: a table crowded with glass bowls and one gilded bowl in the middle. Flick a ping-pong
// ball; it clinks across the rims and either hops out, plops into a bowl, or lands in the golden one.
import { THREE } from '../kit.js';
import { arcPoint } from '../choreo.js';
import { room, bulbs, meshy, setMaterial, tint, particles, v3 } from './common.js';

const TABLE_Y = 0.8;
const BOWL_R = 0.09;
const START = [0.1, 1.05, 1.5];

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.4 });
  bulbs(ctx, { y: 1.9, z: -1.0 });
  const table = kit.mesh(new THREE.BoxGeometry(1.5, 0.06, 1.1), mats.velvet);
  table.position.set(0, TABLE_Y - 0.03, -0.3);
  const apron = kit.mesh(new THREE.BoxGeometry(1.54, TABLE_Y - 0.06, 1.14), mats.walnut);
  apron.position.set(0, (TABLE_Y - 0.06) / 2, -0.3);
  scene.add(table, apron);

  const glass = mats.glass(0xcfe8e4);
  const gold = new THREE.MeshStandardMaterial({ color: 0xffd36b, metalness: 1, roughness: 0.2, emissive: 0x3a2a08 });
  const bowlGeo = kit.lathe([[0.001, 0], [0.05, 0.005], [0.085, 0.04], [0.09, 0.08], [0.075, 0.12], [0.06, 0.13], [0.064, 0.135]], 28);
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x2a6a7a, transparent: true, opacity: 0.6, roughness: 0.05 });
  const bowls = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      const g = new THREE.Group();
      g.position.set(-0.5 + col * 0.25 + (row % 2) * 0.06, TABLE_Y, -0.65 + row * 0.24);
      const centre = row === 1 && col === 2;
      const shell = kit.mesh(bowlGeo, centre ? gold : glass, { cast: false });
      const water = kit.mesh(new THREE.CircleGeometry(0.075, 24), waterMat, { cast: false });
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.085;
      g.add(shell, water);
      g.userData = { centre, shell, water };
      scene.add(g);
      bowls.push(g);
    }
  }
  const golden = bowls.find((b) => b.userData.centre);
  meshy(ctx, 'goldfish-bowl-toss/bowl', { size: 0.19, anchor: 'base' }, bowls.map((b) => b.userData.shell), (m) => {
    bowls.forEach((b, i) => {
      const c = i ? m.clone(true) : m;
      if (b === golden) tint(c, 0xffd36b, 0x3a2a08); else setMaterial(c, glass);
      b.add(c);
    });
  });

  const ball = kit.mesh(new THREE.SphereGeometry(0.02, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf8f4ea, roughness: 0.4 }));
  ball.position.set(...START);
  scene.add(ball);
  const ripples = particles(ctx, 60);
  let landedIn = null;
  const rim = (b, side = 1) => [b.position.x + BOWL_R * 0.8 * side, TABLE_Y + 0.135, b.position.z];
  const into = (b) => [b.position.x, TABLE_Y + 0.08, b.position.z];

  return {
    camera: { pos: [0, 1.55, 1.75], target: [0, 0.85, -0.35], fov: 42, fovPortrait: 62, dolly: 1.2 },
    controls: [{ label: 'Toss the ball', choice: null, primary: true }],
    pickables: bowls,
    waiting: 'You flick the ball…',
    winPoint: () => (landedIn ? landedIn.position.clone().add(v3(0, 0.15, 0)) : null),
    intro() { ctx.setHint('Land it in any bowl for a prize; the gilded bowl in the middle pays the most.'); },
    async play(choice, pending) {
      const r = await pending;
      const tier = r.outcomeTier;
      const plain = bowls.filter((b) => b !== golden);
      // two or three rim hops on the way, chosen from bowls along the line
      const hops = [plain[Math.floor(ctx.rand() * 5) + 14], plain[Math.floor(ctx.rand() * 5) + 10]];
      let from = START;
      for (const [i, b] of hops.entries()) {
        const to = rim(b, i % 2 ? -1 : 1);
        await tween(i ? 260 : 380, (t) => ball.position.set(...arcPoint(from, to, i ? 0.08 : 0.25, t)), (t) => t);
        audio.clink(1.2 + i * 0.1);
        from = to;
      }
      if (tier === 'rim') {
        const out = [from[0] + 0.25, TABLE_Y + 0.02, from[2] + 0.35];
        await tween(320, (t) => ball.position.set(...arcPoint(from, out, 0.1, t)), (t) => t);
        audio.knock(0.3);
        await tween(500, (t) => ball.position.set(out[0] + 0.3 * t, out[1] + Math.abs(Math.sin(t * Math.PI * 3)) * 0.05 * (1 - t), out[2] + 0.3 * t));
      } else {
        landedIn = tier === 'golden' ? golden : plain[Math.floor(ctx.rand() * plain.length)];
        const r1 = rim(landedIn, -1);
        await tween(260, (t) => ball.position.set(...arcPoint(from, r1, 0.1, t)), (t) => t);
        audio.clink(1.4);
        await tween(220, (t) => ball.position.set(...arcPoint(r1, into(landedIn), 0.03, t)), (t) => t);
        audio.knock(0.25);
        ripples.fire(landedIn.position.clone().add(v3(0, 0.09, 0)), { count: tier === 'golden' ? 60 : 24, colors: tier === 'golden' ? [0xffd36b, 0xffffff] : [0xbfe8ff, 0xffffff], speed: 0.5, up: 0.6, seconds: 0.7, size: 0.02 });
        await tween(500, (t) => landedIn.userData.water.scale.setScalar(1 + Math.sin(t * Math.PI * 4) * 0.06 * (1 - t)));
      }
      return r;
    },
    async reset() {
      await sleep(250);
      ball.position.set(...START);
      landedIn = null;
    },
    update(dt) { ripples.update(dt); },
    _state: () => ({ landedIn: landedIn ? (landedIn === golden ? 'golden' : 'regular') : null, ball: ball.position.clone() })
  };
}

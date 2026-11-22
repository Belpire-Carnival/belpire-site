// Skee-Ball: a vintage wooden lane with a curved ramp and glowing scoring rings. Roll the hardwood ball; it
// runs up the lane, hops the ramp and drops into the pocket the server picked (10, 30, 50 or the 100 corner).
import { THREE } from '../kit.js';
import { arcPoint } from '../choreo.js';
import { room, bulbs, meshy, particles, v3 } from './common.js';

// pocket centres on the target board (x, y, z), by points
export const POCKETS = {
  10: [0, 1.02, -1.02],
  30: [0, 1.18, -1.1],
  50: [0, 1.33, -1.17],
  100: [0.26, 1.42, -1.2]
};
const START = [0, 0.86, 1.0];
const RAMP = [0, 0.98, -0.6];

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.8 });
  bulbs(ctx, { y: 2.1, z: -1.4, x0: -0.8, x1: 0.8, n: 9 });
  const stand = new THREE.Group();
  const lane = kit.mesh(new THREE.BoxGeometry(0.62, 0.04, 1.7), mats.oak);
  lane.position.set(0, 0.88, 0.2);
  lane.rotation.x = -0.08;
  const sides = [-0.33, 0.33].map((x) => {
    const s = kit.mesh(new THREE.BoxGeometry(0.04, 0.12, 1.7), mats.walnut);
    s.position.set(x, 0.93, 0.2);
    s.rotation.x = -0.08;
    return s;
  });
  const legs = kit.mesh(new THREE.BoxGeometry(0.66, 0.86, 2.2), mats.walnut);
  legs.position.set(0, 0.43, -0.05);
  const backboard = kit.mesh(new THREE.BoxGeometry(0.75, 0.75, 0.06), mats.walnut);
  backboard.position.set(0, 1.25, -1.25);
  backboard.rotation.x = -0.35;
  stand.add(lane, ...sides, legs, backboard);
  // the scoring rings
  const rings = {};
  for (const [pts, p] of Object.entries(POCKETS)) {
    const r = pts === '100' ? 0.05 : 0.07 + (50 - Math.min(50, Number(pts))) * 0.002;
    const ring = kit.mesh(new THREE.TorusGeometry(r, 0.012, 10, 32), mats.brass);
    ring.position.set(...p);
    ring.rotation.x = -0.35 + Math.PI / 2 - Math.PI / 2;
    const glow = new THREE.Mesh(new THREE.CircleGeometry(r * 0.9, 24), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffb46b, emissiveIntensity: 0.3 }));
    glow.position.set(p[0], p[1], p[2] - 0.02);
    glow.rotation.x = -0.35;
    rings[pts] = { ring, glow };
    stand.add(ring, glow);
  }
  scene.add(stand);
  // The Meshy lane is the whole low machine (ramp end away from the player); it sits on the legs, and the
  // tall target board with the scoring rings stays behind it.
  meshy(ctx, 'skee-ball/lane', { size: 1.6, axis: 'z', anchor: 'base' }, [lane, ...sides], (m) => {
    m.position.set(0, 0.8, -0.2);
    scene.add(m);
  });

  const ball = new THREE.Group();
  const wood = kit.mesh(new THREE.SphereGeometry(0.045, 20, 14), mats.walnut);
  ball.add(wood);
  ball.position.set(...START);
  scene.add(ball);
  meshy(ctx, 'skee-ball/ball', { size: 0.09 }, wood, (m) => ball.add(m));
  const sparks = particles(ctx);
  let landed = null;

  return {
    camera: { pos: [0.35, 1.45, 1.9], target: [0, 1.05, -0.6], fov: 42, fovPortrait: 60, dolly: 1.15 },
    controls: [{ label: 'Roll the ball', choice: null, primary: true }],
    pickables: [ball, stand],
    waiting: 'You crouch for the roll…',
    winPoint: () => (landed ? v3(...POCKETS[landed]) : null),
    intro() { ctx.setHint('Every roll scores. Sink the 100 in the corner for the top prize.'); },
    async play(choice, pending) {
      await tween(220, (t) => { ball.position.z = START[2] + 0.1 * Math.sin(Math.PI * t); });
      const r = await pending;
      const pts = r.visualParams.points;
      landed = pts;
      audio.slide();
      // up the lane, rolling
      await tween(700, (t) => {
        ball.position.set(0, START[1] + (RAMP[1] - START[1]) * t, START[2] + (RAMP[2] - START[2]) * t);
        ball.rotation.x = -t * 18;
      }, (t) => 1 - (1 - t) ** 1.6);
      audio.knock(0.4);
      // off the ramp and into the pocket
      const p = POCKETS[pts];
      await tween(420, (t) => { ball.position.set(...arcPoint(RAMP, p, 0.18 + (p[1] - RAMP[1]) * 0.3, t)); ball.rotation.x -= 0.2; }, (t) => t);
      audio.knock(0.8);
      const glow = rings[pts].glow.material;
      sparks.fire(v3(...p), { count: pts >= 50 ? 50 : 20, speed: 0.8, up: 0.9, seconds: 0.7 });
      await tween(500, (t) => { glow.emissiveIntensity = 0.3 + 2.2 * Math.sin(Math.PI * t); });
      await tween(200, (t) => { ball.position.y = p[1] - 0.12 * t; });
      return r;
    },
    async reset() {
      await sleep(200);
      ball.position.set(...START);
      ball.rotation.set(0, 0, 0);
      landed = null;
    },
    update(dt) { sparks.update(dt); },
    _state: () => ({ landed, ball: ball.position.clone() })
  };
}

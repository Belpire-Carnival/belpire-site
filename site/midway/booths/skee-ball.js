// Skee-Ball: a long oak alley running up to a cabinet with a round target face. Roll the hardwood ball; it
// runs up the lane, hops the ramp and drops into the pocket the server picked (10, 30, 50 or the 100 corner).
import { THREE } from '../kit.js';
import { arcPoint } from '../choreo.js';
import { room, bulbs, meshy, particles, v3 } from './common.js';

// The Meshy alley (largest side 1: 0.44 wide, 0.71 tall, 1 long, cabinet end at -z) is scaled by S and
// stood on the floor. Measured on the model: lane surface at y 0.249, lane end at z -0.24, the round
// target face at z -0.26 centred on y 0.59 with radius 0.125. Everything below is placed from those.
const S = 2.6;
const Z0 = -0.1;
const LANE_Y = 0.249 * S;
const FACE_Z = -0.26 * S + Z0 + 0.012;
const FACE_Y = 0.59 * S;
const FACE_R = 0.125 * S;
const BALL_R = 0.045;
// pocket centres on the target face (x, y, z), by points
export const POCKETS = {
  10: [0, FACE_Y - 0.19, FACE_Z],
  30: [0, FACE_Y - 0.015, FACE_Z],
  50: [0, FACE_Y + 0.14, FACE_Z],
  100: [0.17, FACE_Y + 0.16, FACE_Z]
};
const RING_R = { 10: 0.085, 30: 0.07, 50: 0.06, 100: 0.048 };
const START = [0, LANE_Y + BALL_R, 0.95];
const RAMP = [0, LANE_Y + BALL_R + 0.02, -0.24 * S + Z0 + 0.12];

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.9 });
  bulbs(ctx, { y: 2.3, z: -1.3, x0: -0.9, x1: 0.9, n: 9 });
  // stand-in alley, shown only if the model does not load
  const lane = kit.mesh(new THREE.BoxGeometry(0.9, 0.04, 2.0), mats.oak);
  lane.position.set(0, LANE_Y - 0.02, 0.2);
  const sides = [-0.47, 0.47].map((x) => {
    const sd = kit.mesh(new THREE.BoxGeometry(0.05, 0.12, 2.0), mats.walnut);
    sd.position.set(x, LANE_Y + 0.02, 0.2);
    return sd;
  });
  const legs = kit.mesh(new THREE.BoxGeometry(0.94, LANE_Y - 0.04, 2.0), mats.walnut);
  legs.position.set(0, (LANE_Y - 0.04) / 2, 0.2);
  const cabinet = kit.mesh(new THREE.BoxGeometry(1.1, 1.85, 0.6), mats.walnut);
  cabinet.position.set(0, 0.925, FACE_Z - 0.32);
  const face = kit.mesh(new THREE.CircleGeometry(FACE_R, 48), mats.velvet, { cast: false });
  face.position.set(0, FACE_Y, FACE_Z - 0.004);
  scene.add(lane, ...sides, legs, cabinet, face);
  meshy(ctx, 'skee-ball/lane', { size: S, axis: 'z', anchor: 'base' }, [lane, ...sides, legs, cabinet, face], (m) => {
    m.position.set(0, 0, Z0);
    scene.add(m);
  });
  // the scoring rings on the target face: a brass rim round a dark pocket that lights when scored
  const rings = {};
  const label = (text) => {
    if (typeof document !== 'object') return null;
    const c = Object.assign(document.createElement('canvas'), { width: 96, height: 48 });
    const g = c.getContext('2d');
    g.fillStyle = '#ffd36b';
    g.font = 'bold 36px Georgia, serif';
    g.textAlign = 'center';
    g.fillText(text, 48, 37);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.045), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  };
  for (const [pts, p] of Object.entries(POCKETS)) {
    const r = RING_R[pts];
    const ring = kit.mesh(new THREE.TorusGeometry(r, 0.011, 10, 36), mats.brightBrass);
    ring.position.set(p[0], p[1], p[2] + 0.006);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(r, 28), new THREE.MeshStandardMaterial({ color: 0x0a0506, emissive: 0xffb46b, emissiveIntensity: 0.05, roughness: 0.9 }));
    glow.position.set(p[0], p[1], p[2] + 0.002);
    rings[pts] = { ring, glow };
    scene.add(ring, glow);
    const tag = label(pts);
    if (tag) {
      // numbers sit beside their ring, on the open side of the face
      tag.position.set(p[0] + (pts === '100' ? 0 : -(r + 0.065)), p[1] + (pts === '100' ? -(r + 0.035) : 0), p[2] + 0.004);
      scene.add(tag);
    }
  }

  const ball = new THREE.Group();
  const wood = kit.mesh(new THREE.SphereGeometry(BALL_R, 20, 14), mats.walnut);
  ball.add(wood);
  ball.position.set(...START);
  scene.add(ball);
  meshy(ctx, 'skee-ball/ball', { size: 0.09 }, wood, (m) => ball.add(m));
  const sparks = particles(ctx);
  let landed = null;

  return {
    camera: { pos: [0.3, 1.55, 1.7], target: [0, 1.12, -0.5], fov: 44, fovPortrait: 62, dolly: 1.2 },
    controls: [{ label: 'Roll the ball', choice: null, primary: true }],
    pickables: [ball],
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
      await tween(480, (t) => { ball.position.set(...arcPoint(RAMP, p, 0.12, t)); ball.rotation.x -= 0.2; }, (t) => t);
      audio.knock(0.8);
      const glow = rings[pts].glow.material;
      sparks.fire(v3(...p), { count: pts >= 50 ? 50 : 20, speed: 0.8, up: 0.9, seconds: 0.7 });
      await tween(500, (t) => { glow.emissiveIntensity = 0.05 + 2.4 * Math.sin(Math.PI * t); ball.scale.setScalar(Math.max(0.001, 1 - t * 2)); ball.position.y = p[1] - 0.03 * Math.min(1, t * 2); });
      return r;
    },
    async reset() {
      await sleep(200);
      ball.position.set(...START);
      ball.rotation.set(0, 0, 0);
      ball.scale.setScalar(1);
      landed = null;
    },
    update(dt) { sparks.update(dt); },
    _state: () => ({ landed, ball: ball.position.clone() })
  };
}

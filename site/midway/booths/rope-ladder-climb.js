// Rope Ladder Climb: a single-point swivel rope ladder tilted over a padded pit, a brass bell at the top.
// Climb: the little brass climber goes rung by rung while the ladder twists harder and harder, then flips
// off at the server's rung, or reaches the top and rings the bell.
import { THREE } from '../kit.js';
import { room, bulbs, meshy, particles, v3 } from './common.js';

export const RUNGS = 10;
const BOTTOM = [0, 0.45, 0.55];
const TOP = [0, 1.75, -0.75];
const PIT_Y = 0.12;

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.5, curtainY: 2.2 });
  bulbs(ctx, { y: 2.45, z: -1.2, x0: -1.0, x1: 1.0 });
  // the padded pit
  const pit = kit.mesh(new THREE.BoxGeometry(1.4, 0.24, 1.9), mats.velvet);
  pit.position.set(0, PIT_Y, -0.1);
  const posts = [BOTTOM, TOP].map(([x, y, z]) => {
    const h = z < 0 ? y + 0.26 : y; // the top post rises past the anchor to carry the bell arm
    const p = kit.mesh(new THREE.CylinderGeometry(0.03, 0.03, h, 10), mats.iron);
    p.position.set(x, h / 2, z + (z > 0 ? 0.08 : -0.08));
    return p;
  });
  scene.add(pit, ...posts);
  const bell = kit.mesh(kit.lathe([[0, 0.1], [0.05, 0.09], [0.08, 0.04], [0.095, 0], [0.1, -0.01]], 24), mats.brass);
  bell.position.set(0.18, TOP[1] + 0.15, TOP[2] - 0.08);
  bell.material = mats.brass.clone();
  bell.material.side = THREE.DoubleSide;
  // an iron arm from the top post holds the bell
  const arm = kit.mesh(new THREE.BoxGeometry(0.2, 0.02, 0.02), mats.iron);
  arm.position.set(0.09, TOP[1] + 0.25, TOP[2] - 0.08);
  scene.add(bell, arm);

  // the ladder swivels around the line from the bottom anchor to the top anchor
  const axis = v3(TOP[0] - BOTTOM[0], TOP[1] - BOTTOM[1], TOP[2] - BOTTOM[2]);
  const length = axis.length();
  const ladder = new THREE.Group();
  ladder.position.set(...BOTTOM);
  ladder.quaternion.setFromUnitVectors(v3(0, 1, 0), axis.clone().normalize());
  const twist = new THREE.Group();
  ladder.add(twist);
  const ropeMat = mats.hemp;
  const ropes = [-0.17, 0.17].map((x) => {
    const r = kit.mesh(new THREE.CylinderGeometry(0.012, 0.012, length, 8), ropeMat);
    r.position.set(x, length / 2, 0);
    return r;
  });
  const rungGeo = new THREE.CylinderGeometry(0.013, 0.013, 0.34, 8);
  const rungs = [];
  for (let i = 1; i <= RUNGS; i++) {
    const r = kit.mesh(rungGeo, mats.oak);
    r.rotation.z = Math.PI / 2;
    r.position.y = (i / (RUNGS + 1)) * length;
    rungs.push(r);
  }
  twist.add(...ropes, ...rungs);
  scene.add(ladder);
  meshy(ctx, 'rope-ladder-climb/ladder', { size: length, axis: 'y', anchor: 'base' }, [...ropes, ...rungs], (m) => twist.add(m));

  // the climber: a little brass mannequin
  const climber = new THREE.Group();
  const torso = kit.mesh(new THREE.CapsuleGeometry(0.035, 0.08, 4, 10), mats.brass);
  torso.position.y = 0.09;
  const head = kit.mesh(new THREE.SphereGeometry(0.03, 12, 10), mats.brass);
  head.position.y = 0.19;
  climber.add(torso, head);
  climber.scale.setScalar(1.5);
  twist.add(climber);
  const sparks = particles(ctx);
  const rungY = (i) => (i / (RUNGS + 1)) * length;
  let reached = 0;
  let flipped = false;
  let rang = false;

  return {
    camera: { pos: [1.3, 1.35, 1.4], target: [0, 1.1, -0.1], fov: 46, fovPortrait: 66, dolly: 1.2 },
    controls: [{ label: 'Start climbing', choice: null, primary: true }],
    pickables: [ladder],
    waiting: 'You grab the first rung…',
    winPoint: () => (reached >= 4 ? climber.getWorldPosition(new THREE.Vector3()) : null),
    intro() {
      climber.position.set(0, rungY(0), 0.05);
      ctx.setHint('Climb as far as the ladder lets you. Ring the bell at the top for the jackpot.');
    },
    async play(choice, pending) {
      const r = await pending;
      const top = r.visualParams.rung;
      for (let i = 1; i <= top; i++) {
        const from = climber.position.y;
        await tween(260, (t) => {
          climber.position.y = from + (rungY(i) - from) * t;
          // the ladder wants to roll over, more the higher you go
          twist.rotation.y = Math.sin((i + t) * 1.7) * 0.06 * i;
        });
        audio.knock(0.25);
        reached = i;
      }
      if (top === RUNGS) {
        rang = true;
        audio.bell();
        sparks.fire(bell.position, { count: 80, speed: 1.2, up: 1.2, seconds: 1 });
        await tween(600, (t) => { bell.rotation.z = Math.sin(t * Math.PI * 6) * 0.15 * (1 - t); });
      } else {
        flipped = true;
        audio.slide();
        // the ladder rolls right over and dumps the climber in the pit
        await tween(500, (t) => { twist.rotation.y = Math.PI * t; }, (t) => t * t);
        const at = climber.getWorldPosition(new THREE.Vector3());
        scene.attach(climber);
        await tween(450, (t) => { climber.position.set(at.x + 0.2 * t, at.y + (PIT_Y + 0.15 - at.y) * t * t, at.z); climber.rotation.z = 2 * t; }, (t) => t);
        audio.knock(0.6);
      }
      return r;
    },
    async reset() {
      await sleep(400);
      twist.attach(climber);
      climber.rotation.set(0, 0, 0);
      climber.position.set(0, rungY(0), 0.05);
      twist.rotation.y = 0;
      reached = 0;
      flipped = false;
      rang = false;
    },
    update(dt, t) {
      sparks.update(dt);
      if (!ctx.reduced && !flipped && !reached) twist.rotation.y = Math.sin(t * 0.8) * 0.05;
    },
    _state: () => ({ reached, flipped, rang })
  };
}

// Rigged Hoop: a slightly oval iron rim on a striped backboard with a chain net, under the booth's marquee.
// Shoot: a brick clangs off the front of the rim, a rim-out circles and falls away, a swish drops clean,
// and a bank shot kisses the backboard and goes in.
import { THREE } from '../kit.js';
import { arcPoint } from '../choreo.js';
import { room, bulbs, meshy, particles, v3 } from './common.js';

export const RIM = [0, 1.85, -0.75];
const BOARD_Z = -0.98;
const START = [0, 1.05, 1.4];

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.6, curtainY: 2.3 });
  bulbs(ctx, { y: 2.7, z: -1.3, x0: -1.1, x1: 1.1 });
  // the booth front behind the hoop (the Meshy prop), procedural board and rim in front
  meshy(ctx, 'rigged-hoop/hoop', { size: 2.2, axis: 'y', anchor: 'base' }, null, (m) => { m.position.z = -1.35; scene.add(m); });
  const stripes = new THREE.Group();
  stripes.position.set(0, 2.05, BOARD_Z);
  for (let i = 0; i < 7; i++) {
    const s = kit.mesh(new THREE.BoxGeometry(0.12, 0.62, 0.03), i % 2 ? new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.8 }) : mats.velvet);
    s.position.x = -0.36 + i * 0.12;
    stripes.add(s);
  }
  const box = kit.mesh(new THREE.BoxGeometry(0.22, 0.16, 0.01), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.0 }));
  stripes.add(box);
  scene.add(stripes);
  const rim = kit.mesh(new THREE.TorusGeometry(0.15, 0.012, 10, 40), new THREE.MeshStandardMaterial({ color: 0x6a3a22, metalness: 0.7, roughness: 0.6 }));
  rim.rotation.x = Math.PI / 2;
  rim.scale.set(1.15, 0.9, 1); // rigged: a little oval
  rim.position.set(...RIM);
  const bracket = kit.mesh(new THREE.BoxGeometry(0.06, 0.03, 0.22), mats.iron);
  bracket.position.set(0, RIM[1], RIM[2] - 0.14);
  // chain net
  const net = new THREE.Group();
  net.position.set(...RIM);
  const link = new THREE.CylinderGeometry(0.003, 0.003, 0.28, 4);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const c = kit.mesh(link, mats.iron, { cast: false });
    c.position.set(Math.cos(a) * 0.12, -0.14, Math.sin(a) * 0.1);
    c.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
    net.add(c);
  }
  const counter = kit.mesh(new THREE.BoxGeometry(2.4, 0.9, 0.4), mats.walnut);
  counter.position.set(0, 0.45, 1.3);
  scene.add(rim, bracket, net, counter);

  const ball = new THREE.Group();
  const leather = kit.mesh(new THREE.SphereGeometry(0.11, 20, 14), new THREE.MeshStandardMaterial({ color: 0x4a2a18, roughness: 0.85 }));
  ball.add(leather);
  ball.position.set(...START);
  scene.add(ball);
  meshy(ctx, 'rigged-hoop/ball', { size: 0.22 }, leather, (m) => ball.add(m));
  const dust = particles(ctx, 60);
  let made = false;
  const R = RIM;

  async function arc(from, to, height, ms) {
    await tween(ms, (t) => { ball.position.set(...arcPoint(from, to, height, t)); ball.rotation.x -= 0.15; }, (t) => t);
  }

  return {
    camera: { pos: [0.3, 1.35, 2.5], target: [0, 1.7, -0.6], fov: 46, fovPortrait: 64, dolly: 1.15 },
    controls: [{ label: 'Shoot the ball', choice: null, primary: true }],
    pickables: [ball, rim],
    waiting: 'You line up the shot…',
    winPoint: () => (made ? v3(R[0], R[1] - 0.1, R[2]) : null),
    intro() { ctx.setHint('The rim is a little oval. A swish or a bank shot pays best.'); },
    async play(choice, pending) {
      await tween(260, (t) => { ball.position.y = START[1] - 0.15 * Math.sin(Math.PI * t); });
      const r = await pending;
      const tier = r.outcomeTier;
      if (tier === 'brick') {
        const front = [R[0], R[1] + 0.02, R[2] + 0.17];
        await arc(START, front, 0.55, 700);
        audio.clink(0.45);
        audio.knock(0.6);
        await arc(front, [R[0] + 0.5, 0.11, R[2] + 0.9], 0.2, 600);
      } else if (tier === 'rim-out') {
        const lip = [R[0] + 0.12, R[1] + 0.12, R[2]];
        await arc(START, lip, 0.55, 700);
        audio.clink(0.6);
        // around the rim once, then out
        await tween(700, (t) => {
          const a = t * Math.PI * 2.2;
          ball.position.set(R[0] + Math.cos(a) * 0.17, R[1] + 0.12 + Math.sin(t * Math.PI) * 0.02, R[2] + Math.sin(a) * 0.14);
        }, (t) => t);
        audio.clink(0.55);
        await arc([ball.position.x, ball.position.y, ball.position.z], [R[0] - 0.4, 0.11, R[2] + 0.7], 0.1, 600);
      } else {
        made = true;
        if (tier === 'bank') {
          const kiss = [R[0] - 0.12, R[1] + 0.28, BOARD_Z + 0.13];
          await arc(START, kiss, 0.5, 680);
          audio.knock(0.5);
          await arc(kiss, [R[0], R[1] + 0.1, R[2]], 0.05, 220);
        } else {
          await arc(START, [R[0], R[1] + 0.12, R[2]], 0.6, 720);
        }
        // through the net
        audio.slide();
        await tween(360, (t) => {
          ball.position.set(R[0], R[1] + 0.12 - 0.5 * t, R[2]);
          net.scale.set(1, 1 + Math.sin(t * Math.PI) * 0.25, 1);
        }, (t) => t);
        dust.fire(v3(R[0], R[1] - 0.25, R[2]), { count: tier === 'bank' ? 50 : 24, speed: 0.7, up: 0.4, seconds: 0.7 });
        await arc([R[0], R[1] - 0.38, R[2]], [R[0] + 0.1, 0.11, R[2] + 0.4], 0.05, 420);
      }
      return r;
    },
    async reset() {
      await sleep(250);
      ball.position.set(...START);
      net.scale.set(1, 1, 1);
      made = false;
    },
    update(dt) { dust.update(dt); },
    _state: () => ({ made, ball: ball.position.clone() })
  };
}

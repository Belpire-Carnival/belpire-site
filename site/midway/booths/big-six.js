// Big Six: a massive Victorian prize wheel with brass pegs and a flexing leather flapper. Spin; it slows with
// a tick on every peg and a near miss or two before settling on the server's wedge under the flapper.
import { THREE } from '../kit.js';
import { wheelAngle, easeOut } from '../choreo.js';
import { room, bulbs, meshy, particles, v3 } from './common.js';

// 24 wedges, clockwise from the top. Only one jackpot.
export const WEDGES = ['5', '15', '5', '20', '5', '15', '5', '15', '5', '20', '5', '15', '5', '★', '5', '15', '5', '20', '5', '15', '5', '20', '5', '15'];
const VALUE = { 5: '5', 15: '15', 20: '20', 200: '★' };
const HUB = [0, 1.55, -0.5];
const R = 0.72;

function faceTexture() {
  if (typeof document !== 'object') return null;
  const c = Object.assign(document.createElement('canvas'), { width: 1024, height: 1024 });
  const g = c.getContext('2d');
  const n = WEDGES.length;
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + ((i - 0.5) / n) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / n;
    g.beginPath();
    g.moveTo(512, 512);
    g.arc(512, 512, 500, a0, a1);
    g.closePath();
    g.fillStyle = WEDGES[i] === '★' ? '#b8944f' : i % 2 ? '#2a1418' : '#5a0f1b';
    g.fill();
    g.save();
    g.translate(512, 512);
    g.rotate((a0 + a1) / 2 + Math.PI / 2);
    g.fillStyle = WEDGES[i] === '★' ? '#1a1008' : '#f0d49a';
    g.font = `bold ${WEDGES[i] === '★' ? 70 : 58}px Georgia, serif`;
    g.textAlign = 'center';
    g.fillText(WEDGES[i], 0, -390);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.2, curtainY: 2.2 });
  bulbs(ctx, { y: 2.6, z: -1.0, x0: -1.1, x1: 1.1, n: 13 });
  const wheel = new THREE.Group();
  wheel.position.set(...HUB);
  const tex = faceTexture();
  const face = kit.mesh(new THREE.CircleGeometry(R, 72), new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : 0x5a0f1b, roughness: 0.6 }));
  face.position.z = 0.03;
  const rimRing = kit.mesh(new THREE.TorusGeometry(R, 0.03, 10, 72), mats.brass);
  rimRing.position.z = 0.03;
  wheel.add(face, rimRing);
  const pegGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.06, 8);
  for (let i = 0; i < WEDGES.length; i++) {
    const a = ((i + 0.5) / WEDGES.length) * Math.PI * 2;
    const p = kit.mesh(pegGeo, mats.brightBrass);
    p.rotation.x = Math.PI / 2;
    p.position.set(Math.sin(a) * (R - 0.02), Math.cos(a) * (R - 0.02), 0.06);
    wheel.add(p);
  }
  scene.add(wheel);
  // the Meshy wheel is the frame and stand behind the face
  meshy(ctx, 'big-six/wheel', { size: 2.05, axis: 'y', anchor: 'base' }, null, (m) => { m.position.set(0, 0.02, HUB[2] - 0.12); scene.add(m); });
  const post = kit.mesh(new THREE.BoxGeometry(0.1, HUB[1], 0.1), mats.walnut);
  post.position.set(0, HUB[1] / 2, HUB[2] - 0.08);
  scene.add(post);
  // the flapper at the top
  const flapper = new THREE.Group();
  flapper.position.set(0, HUB[1] + R + 0.1, HUB[2] + 0.1);
  const leather = kit.mesh(new THREE.BoxGeometry(0.03, 0.16, 0.01), new THREE.MeshStandardMaterial({ color: 0x3a1a10, roughness: 0.9 }));
  leather.position.y = -0.08;
  flapper.add(leather);
  scene.add(flapper);
  const sparks = particles(ctx);
  let landed = null;
  let lastPeg = 0;

  return {
    camera: { pos: [0, 1.5, 2.3], target: [0, 1.55, -0.5], fov: 44, fovPortrait: 66, dolly: 1.1 },
    controls: [{ label: 'Spin the wheel', choice: null, primary: true }],
    pickables: [wheel],
    waiting: 'The wheel creaks into motion…',
    winPoint: () => (landed ? v3(0, HUB[1] + R, HUB[2] + 0.1) : null),
    intro() { ctx.setHint('One spin a day. Every wedge pays; the brass star is the jackpot.'); },
    async play(choice, pending) {
      const rest = wheel.rotation.z;
      await tween(300, (t) => { wheel.rotation.z = rest - 0.15 * Math.sin(Math.PI * t); });
      const r = await pending;
      const label = VALUE[r.visualParams.wedge];
      const options = WEDGES.map((w, i) => (w === label ? i : -1)).filter((i) => i >= 0);
      const index = options[Math.floor(ctx.rand() * options.length)];
      // the face is drawn clockwise from the top, so turning the wheel anticlockwise (positive z) by the
      // wedge's angle brings that wedge up under the flapper
      const target = Math.floor(wheel.rotation.z / (Math.PI * 2)) * Math.PI * 2 + wheelAngle(index, WEDGES.length, ctx.reduced ? 0 : 5);
      const from = wheel.rotation.z;
      lastPeg = 0;
      await tween(5200, (t) => {
        wheel.rotation.z = from + (target - from) * t;
        const pegs = Math.floor(Math.abs(wheel.rotation.z) / ((Math.PI * 2) / WEDGES.length));
        if (pegs !== lastPeg) {
          lastPeg = pegs;
          audio.knock(0.25);
          flapper.rotation.z = 0.35;
        }
        flapper.rotation.z *= 0.85;
      }, easeOut);
      flapper.rotation.z = 0;
      landed = label;
      audio.clink(1);
      if (label === '★') {
        audio.bell();
        sparks.fire(v3(0, HUB[1] + R, HUB[2] + 0.15), { count: 120, speed: 1.6, up: 1.6, seconds: 1.3 });
      }
      return r;
    },
    async reset() {
      await sleep(250);
      wheel.rotation.z %= Math.PI * 2;
      landed = null;
    },
    update(dt) { sparks.update(dt); },
    _state: () => {
      // which wedge sits at the top now
      const n = WEDGES.length;
      const turned = ((wheel.rotation.z % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      return { landed, atTop: WEDGES[Math.round((turned / (Math.PI * 2)) * n) % n] };
    }
  };
}

// Hall of Mirrors: four arched gilded mirrors at the end of a dim corridor; only one is the way out.
// Pick one: the camera walks up to it and either bonks off the glass (and the real exit glows), or the
// glass melts away into golden light.
import { THREE } from '../kit.js';
import { room, bulbs, meshy, particles, v3 } from './common.js';

export const MIRROR_X = [-0.9, -0.3, 0.3, 0.9];
const Z = -0.7;
const H = 0.92; // the glass; the Meshy frame (0.59 wide per 1 tall) is sized to sit just around it
const HW = 0.19;

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.1, curtainY: 2.2 });
  bulbs(ctx, { y: 2.3, z: -0.95, x0: -1.1, x1: 1.1, n: 13 });
  const mirrors = MIRROR_X.map((x, i) => {
    const g = new THREE.Group();
    g.position.set(x, 0.3, Z);
    g.rotation.y = -x * 0.25; // a gentle arc facing the visitor
    // the arched glass
    const shape = new THREE.Shape();
    shape.moveTo(-HW, 0);
    shape.lineTo(-HW, H - HW);
    shape.absarc(0, H - HW, HW, Math.PI, 0, true);
    shape.lineTo(HW, 0);
    shape.lineTo(-HW, 0);
    // silvered glass: a little self-light so it reads as a mirror even in a dark tent
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xc8d2d6, metalness: 0.7, roughness: 0.08 + i * 0.04, emissive: 0x1c2226, transparent: true, opacity: 1 });
    const glass = kit.mesh(new THREE.ShapeGeometry(shape, 24), glassMat, { cast: false });
    // a gilded frame as a stand-in
    const frame = kit.mesh(new THREE.TorusGeometry(HW + 0.02, 0.025, 8, 24, Math.PI), mats.gold);
    frame.position.y = H - HW;
    const sides = [-HW - 0.02, HW + 0.02].map((sx) => {
      const s = kit.mesh(new THREE.BoxGeometry(0.05, H - HW, 0.05), mats.gold);
      s.position.set(sx, (H - HW) / 2, 0);
      return s;
    });
    g.add(glass, frame, ...sides);
    g.userData = { choice: String(i + 1), glass, glassMat, stand: [frame, ...sides] };
    glass.userData.choice = String(i + 1);
    scene.add(g);
    return g;
  });
  meshy(ctx, 'hall-of-mirrors/frame', { size: H + 0.1, axis: 'y', anchor: 'base' }, mirrors.flatMap((m) => m.userData.stand), (m) => {
    mirrors.forEach((g, i) => {
      const f = i ? m.clone(true) : m;
      f.position.set(0, -0.06, -0.02);
      g.add(f);
    });
  });
  // the golden light beyond the true exit
  const beyond = new THREE.PointLight(0xffd36b, 0, 3);
  beyond.position.set(0, 1, Z - 0.3);
  scene.add(beyond);
  const glow = particles(ctx);
  let picked = null;
  let through = false;
  let lit = null;
  const base = ctx.camBase;
  let home = null;

  const walk = async (to, ms) => {
    if (!base || ctx.reduced) return;
    const from = base.pos.clone();
    const fromT = base.target.clone();
    await tween(ms, (t) => {
      base.pos.lerpVectors(from, to.pos, t);
      base.target.lerpVectors(fromT, to.target, t);
      ctx.camTarget.copy(base.target);
    });
  };

  return {
    camera: { pos: [0, 1.05, 1.75], target: [0, 0.75, Z], fov: 50, fovPortrait: 74, dolly: 1.25 },
    controls: MIRROR_X.map((_, i) => ({ label: `Mirror ${i + 1}`, choice: String(i + 1), primary: false })),
    pickables: mirrors,
    waiting: 'You step toward the glass…',
    winPoint: () => (through ? v3(MIRROR_X[picked], 1, Z) : null),
    intro() {
      if (base) home = { pos: base.pos.clone(), target: base.target.clone() };
      ctx.setHint('One of the four mirrors is the real way out. Pick it.');
    },
    hover(choice) {
      mirrors.forEach((m) => { m.userData.glassMat.emissive?.setHex(m.userData.choice === choice ? 0x2a2418 : 0x000000); });
    },
    async play(choice, pending) {
      const i = Number(choice) - 1;
      picked = i;
      const m = mirrors[i];
      const front = m.localToWorld(v3(0, 0.6, 0.6));
      const walking = walk({ pos: front, target: m.localToWorld(v3(0, 0.5, 0)) }, 1100);
      const r = await pending;
      await walking;
      const exit = r.visualParams.exit - 1;
      if (r.outcomeTier === 'exit') {
        through = true;
        lit = i;
        audio.win(true);
        beyond.position.set(MIRROR_X[i], 1, Z - 0.3);
        await tween(700, (t) => { m.userData.glassMat.opacity = 1 - t; beyond.intensity = 4 * t; });
        m.userData.glass.visible = false;
        glow.fire(v3(MIRROR_X[i], 0.9, Z + 0.05), { count: 90, speed: 0.8, up: 0.8, seconds: 1.1 });
      } else {
        audio.knock(1);
        ctx.shake(400, 0.05);
        if (home) await walk({ pos: front.clone().add(v3(0, 0, 0.25)), target: base.target.clone() }, 200);
        audio.lose();
        // the real exit gives itself away
        lit = exit;
        await tween(600, (t) => { mirrors[exit].userData.glassMat.emissive.setHex(0x000000).lerp(new THREE.Color(0x6a5020), t); });
      }
      return r;
    },
    async reset() {
      await sleep(500);
      if (home) await walk(home, 700);
      for (const m of mirrors) {
        m.userData.glass.visible = true;
        m.userData.glassMat.opacity = 1;
        m.userData.glassMat.emissive.setHex(0x000000);
      }
      beyond.intensity = 0;
      picked = null;
      through = false;
      lit = null;
    },
    update(dt) { glow.update(dt); },
    _state: () => ({ picked, through, lit })
  };
}

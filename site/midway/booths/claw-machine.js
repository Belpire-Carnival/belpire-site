// Claw Machine: a glass-fronted brass crane cabinet full of plush oddities and one glowing gilded relic.
// Nudge the gantry left or right, then hit Drop: the three-prong claw descends, grabs, lifts, and either
// slips mid-air or carries the prize the server rolled to the chute.
import { THREE } from '../kit.js';
import { room, bulbs, meshy, particles, v3 } from './common.js';

const FLOOR_Y = 0.95;
const TOP_Y = 1.75;
const CHUTE = [0.3, FLOOR_Y + 0.05, 0.05];
const PLUSH_COLORS = [0x6a2a3a, 0x3a4a2a, 0x4a3a6a, 0x7a5a3a, 0x2a4a5a];

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.3 });
  bulbs(ctx, { y: 2.35, z: -1.0, x0: -0.8, x1: 0.8, n: 9 });
  // the cabinet: our pit, the Meshy machine around it
  const pit = kit.mesh(new THREE.BoxGeometry(0.85, 0.06, 0.6), mats.velvet);
  pit.position.set(0, FLOOR_Y - 0.03, -0.25);
  const chute = kit.mesh(new THREE.BoxGeometry(0.18, 0.2, 0.18), mats.brass);
  chute.position.set(CHUTE[0], FLOOR_Y + 0.06, CHUTE[2] - 0.05);
  const body = kit.mesh(new THREE.BoxGeometry(0.95, FLOOR_Y - 0.06, 0.7), mats.walnut);
  body.position.set(0, (FLOOR_Y - 0.06) / 2, -0.25);
  scene.add(pit, chute, body);
  meshy(ctx, 'claw-machine/claw', { size: 2.15, axis: 'y', anchor: 'base' }, body, (m) => { m.position.z = -0.25; scene.add(m); });

  // plushies: soft lumps in muted colours, small and big
  const plush = [];
  for (let i = 0; i < 12; i++) {
    const big = i % 3 === 0;
    const r = big ? 0.075 : 0.05;
    const p = kit.mesh(new THREE.SphereGeometry(r, 14, 10), new THREE.MeshStandardMaterial({ color: PLUSH_COLORS[i % PLUSH_COLORS.length], roughness: 0.95 }));
    p.scale.set(1, 0.8, 1.1);
    p.position.set(-0.32 + (i % 6) * 0.11, FLOOR_Y + r * 0.7, -0.45 + Math.floor(i / 6) * 0.2 + (i % 2) * 0.04);
    p.userData = { big, r, home: p.position.clone() };
    scene.add(p);
    plush.push(p);
  }
  const relic = new THREE.Group();
  const box = kit.mesh(new THREE.BoxGeometry(0.1, 0.06, 0.08), mats.gold);
  relic.add(box);
  relic.position.set(-0.05, FLOOR_Y + 0.04, -0.2);
  relic.userData = { home: relic.position.clone() };
  const glow = new THREE.PointLight(0xffd36b, 1.2, 0.6);
  glow.position.set(-0.05, FLOOR_Y + 0.15, -0.2);
  scene.add(relic, glow);
  meshy(ctx, 'claw-machine/relic', { size: 0.13 }, box, (m) => relic.add(m));

  // gantry, cable and the three-prong claw
  const gantry = new THREE.Group();
  gantry.position.set(0, TOP_Y, -0.25);
  const rail = kit.mesh(new THREE.BoxGeometry(0.85, 0.02, 0.03), mats.iron);
  rail.position.y = 0.02;
  gantry.add(rail);
  scene.add(gantry);
  const claw = new THREE.Group();
  claw.position.set(0, TOP_Y - 0.1, -0.25);
  const hub = kit.mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.05, 12), mats.brass);
  const prongs = [0, 1, 2].map((i) => {
    const g = new THREE.Group();
    g.rotation.y = (i / 3) * Math.PI * 2;
    const p = kit.mesh(new THREE.BoxGeometry(0.008, 0.09, 0.008), mats.iron);
    p.position.set(0.03, -0.05, 0);
    g.add(p);
    g.userData.prong = p;
    return g;
  });
  claw.add(hub, ...prongs);
  const cable = kit.mesh(new THREE.CylinderGeometry(0.003, 0.003, 1, 6), mats.iron, { cast: false });
  scene.add(claw, cable);
  const openClaw = (k) => prongs.forEach((g) => { g.userData.prong.rotation.z = -0.5 * k; g.userData.prong.position.x = 0.03 + 0.02 * k; });
  openClaw(0.2);
  const sparkle = particles(ctx);

  let x = 0;
  let carried = null;
  let won = null;
  const setX = (nx) => { x = Math.max(-0.35, Math.min(0.35, nx)); };
  return {
    camera: { pos: [0, 1.3, 1.75], target: [0, 1.2, -0.25], fov: 46, fovPortrait: 66, dolly: 1.2 },
    controls: [
      { label: '◀ Left', choice: 'left', steer: true },
      { label: 'Right ▶', choice: 'right', steer: true },
      { label: 'Drop the claw', choice: null, primary: true }
    ],
    // left and right only move the gantry; Drop is the play
    steer(choice) {
      if (choice === 'left') setX(x - 0.12);
      else if (choice === 'right') setX(x + 0.12);
      audio.slide();
    },
    pickables: [claw],
    waiting: 'The claw whirs down…',
    winPoint: () => (won ? v3(...CHUTE) : null),
    intro() { ctx.setHint('Line the claw up with the buttons, then drop it. The gilded relic is the top prize.'); },
    async play(choice, pending) {
      const r = await pending;
      const tier = r.outcomeTier;
      // the claw swings over to the nearest prize of the rolled kind (slips grab whatever is below)
      const pool = tier === 'relic' ? [relic] : tier === 'big' ? plush.filter((p) => p.userData.big) : tier === 'small' ? plush.filter((p) => !p.userData.big) : plush;
      const target = pool.slice().sort((a, b) => Math.abs(a.position.x - x) - Math.abs(b.position.x - x))[0];
      const tx = target.position.x;
      const tz = target.position.z;
      audio.slide();
      await tween(500, (t) => { claw.position.x = x + (tx - x) * t; claw.position.z = -0.25 + (tz + 0.25) * t; gantry.position.z = claw.position.z; });
      openClaw(1);
      const topY = claw.position.y;
      await tween(700, (t) => { claw.position.y = topY - (topY - (target.position.y + 0.09)) * t; }, (t) => t);
      audio.knock(0.4);
      await tween(250, (t) => openClaw(1 - t * 0.85));
      carried = target;
      await tween(700, (t) => {
        claw.position.y = target.position.y + 0.09 + (topY - target.position.y - 0.09) * t;
        if (carried) carried.position.set(claw.position.x, claw.position.y - 0.09, claw.position.z);
        // a slip lets go half way up
        if (tier === 'slip' && t > 0.55 && carried) {
          carried = null;
          openClaw(0.6);
          audio.lose();
        }
      }, (t) => t);
      if (tier === 'slip') {
        await tween(350, (t) => { target.position.y = target.position.y + (target.userData.home.y - target.position.y) * t; }, (t) => t * t);
        audio.knock(0.3);
      } else {
        await tween(600, (t) => {
          claw.position.x = tx + (CHUTE[0] - tx) * t;
          claw.position.z = tz + (CHUTE[2] - tz) * t;
          gantry.position.z = claw.position.z;
          carried.position.set(claw.position.x, claw.position.y - 0.09, claw.position.z);
        });
        openClaw(1);
        won = carried;
        carried = null;
        await tween(300, (t) => { won.position.y = TOP_Y - 0.19 - (TOP_Y - 0.19 - CHUTE[1]) * t; }, (t) => t * t);
        audio.knock(0.6);
        sparkle.fire(v3(...CHUTE), { count: tier === 'relic' ? 80 : 30, speed: 0.9, up: 1, seconds: 0.9 });
      }
      return r;
    },
    async reset() {
      await sleep(350);
      for (const p of plush) p.position.copy(p.userData.home);
      relic.position.copy(relic.userData.home);
      claw.position.set(x, TOP_Y - 0.1, -0.25);
      gantry.position.z = -0.25;
      openClaw(0.2);
      won = null;
      carried = null;
    },
    update(dt, t) {
      sparkle.update(dt);
      if (!carried && !won && claw.position.y >= TOP_Y - 0.11) claw.position.x += (x - claw.position.x) * Math.min(1, dt * 8);
      // the cable from the gantry to the claw
      const len = TOP_Y - claw.position.y;
      cable.position.set(claw.position.x, claw.position.y + len / 2, claw.position.z);
      cable.scale.y = Math.max(0.01, len);
      if (!ctx.reduced) glow.intensity = 1 + Math.sin(t * 3) * 0.3;
    },
    _state: () => ({ won: won === relic ? 'relic' : won ? (won.userData.big ? 'big' : 'small') : null })
  };
}

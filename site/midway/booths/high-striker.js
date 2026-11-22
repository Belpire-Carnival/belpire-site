// The High Striker in 3D: a low-angle shot up a towering iron-and-brass rail. Swing the mallet onto the
// lever; the puck rockets up to the server's reading while the camera tilts to follow. A 10 strikes the bell
// with brass sparks and a shake.
import { puckY, easeOut, easeIn, lerp } from '../choreo.js';

export const RAIL_BOTTOM = 0.5;
export const RAIL_TOP = 3.36;
const PIVOT = [1.12, 0.36, 0.18];
const IDLE = 0.35;
const WINDUP = -0.55;
const STRIKE = Math.PI / 2 - 0.05;

// The scale painted on the board: 1–10 with the tier names beside them.
function scaleTexture() {
  const c = typeof document === 'object' ? Object.assign(document.createElement('canvas'), { width: 128, height: 1024 }) : null;
  if (!c) return null;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 1024);
  g.fillStyle = '#f0d49a';
  g.strokeStyle = 'rgba(240,212,154,.55)';
  g.textAlign = 'center';
  const names = { 3: 'WIMP', 6: 'NOT BAD', 9: 'STRONGMAN', 10: 'DING!' };
  for (let h = 1; h <= 10; h++) {
    const y = 1024 - (h / 10) * 980;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(8, y);
    g.lineTo(40, y);
    g.stroke();
    g.font = 'bold 34px Georgia, serif';
    g.fillText(String(h), 70, y + 12);
    if (names[h]) {
      g.font = 'bold 13px Georgia, serif';
      g.fillText(names[h], 70, y + 30);
    }
  }
  return c;
}

export function create(ctx) {
  const { THREE: T, scene, mats, tween, sleep, audio, kit, camTarget, reduced } = ctx;

  const floor = kit.mesh(new T.PlaneGeometry(12, 12), mats.charcoal, { cast: false });
  floor.rotation.x = -Math.PI / 2;
  const curtain = kit.mesh(new T.PlaneGeometry(10, 6), mats.velvet, { cast: false });
  curtain.position.set(0, 3, -1.6);
  const base = kit.mesh(new T.BoxGeometry(1.4, 0.2, 0.8), mats.oak);
  base.position.set(0.25, 0.1, 0.1);
  const board = kit.mesh(new T.BoxGeometry(0.38, 3.3, 0.07), mats.walnut);
  board.position.set(0, 1.85, -0.04);
  const trims = [-0.2, 0.2].map((x) => {
    const t = kit.mesh(new T.BoxGeometry(0.025, 3.3, 0.03), mats.brass);
    t.position.set(x, 1.85, 0);
    return t;
  });
  scene.add(floor, curtain, base, board, ...trims);
  const painted = scaleTexture();
  if (painted) {
    const tex = new T.CanvasTexture(painted);
    tex.colorSpace = T.SRGBColorSpace;
    const plate = new T.Mesh(new T.PlaneGeometry(0.16, 2.9), new T.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6 }));
    plate.position.set(-0.11, lerp(RAIL_BOTTOM, RAIL_TOP, 0.5) - 0.02, 0.0);
    scene.add(plate);
  }
  // bulbs up both sides
  const bulbGeo = new T.SphereGeometry(0.026, 10, 8);
  for (let i = 0; i < 11; i++) for (const x of [-0.26, 0.26]) {
    const b = kit.mesh(bulbGeo, mats.bulb, { cast: false });
    b.position.set(x, 0.45 + i * 0.29, 0.02);
    scene.add(b);
  }
  const glow = new T.PointLight(0xffb46b, 4, 5, 1.6);
  glow.position.set(0.4, 2.4, 0.8);
  scene.add(glow);

  const rail = kit.mesh(new T.CylinderGeometry(0.012, 0.012, RAIL_TOP - RAIL_BOTTOM + 0.2, 10), mats.iron);
  rail.position.set(0.06, (RAIL_TOP + RAIL_BOTTOM) / 2, 0.06);
  const puck = kit.mesh(new T.CylinderGeometry(0.05, 0.05, 0.07, 24), mats.brightBrass);
  puck.position.set(0.06, RAIL_BOTTOM, 0.06);
  const bell = new T.Group();
  bell.position.set(0.06, RAIL_TOP + 0.1, 0.06);
  const dome = kit.mesh(kit.lathe([[0.0, 0.12], [0.06, 0.11], [0.11, 0.06], [0.14, 0.0], [0.15, -0.02]], 40), mats.brass);
  dome.material = mats.brass.clone();
  dome.material.side = T.DoubleSide;
  const bracket = kit.mesh(new T.BoxGeometry(0.06, 0.04, 0.16), mats.iron);
  bracket.position.set(0, 0.13, -0.07);
  bell.add(dome, bracket);
  ctx.prop?.('high-striker/bell', { size: 0.34, axis: 'y' }).then((m) => {
    if (!m) return;
    m.position.y = 0.1;
    dome.visible = false;
    bracket.visible = false;
    bell.add(m);
  });
  // a hanging brass lamp over the rail
  const lamp = new T.Group();
  lamp.position.set(-0.8, 3.15, 0.55);
  const lampLight = new T.PointLight(0xffb46b, 5, 4, 1.6);
  lampLight.position.y = -0.12;
  lamp.add(lampLight);
  scene.add(lamp);
  ctx.prop?.('shared/brass-lamp', { size: 0.5 }).then((m) => { if (m) lamp.add(m); });
  scene.add(rail, puck, bell);

  // the lever plate the mallet hits
  const lever = new T.Group();
  lever.position.set(0.06, 0.24, 0.06);
  const plate = kit.mesh(new T.BoxGeometry(0.5, 0.035, 0.2), mats.iron);
  plate.position.x = 0.22;
  const pad = kit.mesh(new T.CylinderGeometry(0.08, 0.08, 0.02, 20), mats.brass);
  pad.position.set(0.38, 0.025, 0);
  lever.add(plate, pad);
  scene.add(lever);

  // the mallet: taped hickory handle and an iron-banded head
  const mallet = new T.Group();
  mallet.position.set(...PIVOT);
  const handle = kit.mesh(new T.CylinderGeometry(0.022, 0.026, 0.78, 12), mats.oak);
  handle.position.y = 0.39;
  const head = kit.mesh(new T.CylinderGeometry(0.09, 0.09, 0.3, 20), mats.walnut);
  head.rotation.z = Math.PI / 2;
  head.position.y = 0.78;
  const bands = [-0.11, 0.11].map((x) => {
    const b = kit.mesh(new T.CylinderGeometry(0.094, 0.094, 0.03, 20), mats.iron);
    b.rotation.z = Math.PI / 2;
    b.position.set(x, 0.78, 0);
    return b;
  });
  mallet.add(handle, head, ...bands);
  // Meshy mallet: modelled with the handle along X and the head at +X, so stood up along the swing arm.
  ctx.prop?.('high-striker/mallet', { size: 0.82 }).then((m) => {
    if (!m) return;
    m.rotation.z = Math.PI / 2;
    m.position.y = 0.41;
    for (const part of [handle, head, ...bands]) part.visible = false;
    mallet.add(m);
  });
  mallet.rotation.z = IDLE;
  mallet.userData.choice = null;
  scene.add(mallet);

  // sparks for the bell
  const N = 48;
  const sparkPos = new Float32Array(N * 3);
  const sparkVel = new Float32Array(N * 3);
  const sparkGeo = new T.BufferGeometry();
  sparkGeo.setAttribute('position', new T.BufferAttribute(sparkPos, 3));
  const sparks = new T.Points(sparkGeo, new T.PointsMaterial({ color: 0xffd36b, size: 0.035, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }));
  scene.add(sparks);
  let sparkLife = 0;
  function burst() {
    for (let i = 0; i < N; i++) {
      sparkPos.set([bell.position.x, bell.position.y - 0.02, bell.position.z], i * 3);
      const a = ctx.rand() * Math.PI * 2;
      const s = 0.8 + ctx.rand() * 1.6;
      sparkVel.set([Math.cos(a) * s, 0.6 + ctx.rand() * 1.8, Math.sin(a) * s * 0.6], i * 3);
    }
    sparkLife = 1;
  }

  const baseTarget = new T.Vector3(0, 1.2, 0);
  const follow = (y) => camTarget.set(0, Math.min(2.9, Math.max(1.2, y)), 0);

  return {
    camera: { pos: [1.25, 0.55, 2.4], target: [0, 1.2, 0], fov: 46, fovPortrait: 66, dolly: 1.12 },
    controls: [{ label: 'Swing the mallet', choice: null, primary: true }],
    pickables: [mallet, lever],
    waiting: 'You heft the mallet…',
    winPoint: () => puck.position.clone(),
    intro() { ctx.setHint('Swing the mallet. Ring the bell at 10 for the jackpot.'); },
    async play(choice, pending) {
      await tween(380, (t) => { mallet.rotation.z = lerp(IDLE, WINDUP, t); });
      const r = await pending;
      const h = r.visualParams.height;
      await tween(150, (t) => { mallet.rotation.z = lerp(WINDUP, STRIKE, t); }, easeIn);
      audio.knock(1.2);
      audio.spring();
      lever.rotation.z = -0.06;
      ctx.shake(160, 0.015);
      const y = puckY(h, RAIL_BOTTOM, RAIL_TOP);
      await tween(320 + h * 45, (t) => {
        puck.position.y = lerp(RAIL_BOTTOM, y, t);
        follow(puck.position.y - 0.2);
        lever.rotation.z = -0.06 * (1 - t);
      }, easeOut);
      if (h === 10) {
        audio.bell();
        burst();
        ctx.shake(520, 0.06);
        await tween(700, (t) => { bell.rotation.z = Math.sin(t * Math.PI * 6) * 0.08 * (1 - t); }, (t) => t);
      } else {
        await sleep(450);
      }
      return r;
    },
    async reset() {
      const from = puck.position.y;
      await tween(Math.max(250, from * 220), (t) => {
        puck.position.y = lerp(from, RAIL_BOTTOM, t);
        follow(lerp(camTarget.y, baseTarget.y, t));
        mallet.rotation.z = lerp(STRIKE, IDLE, t);
      }, easeIn);
      if (from > RAIL_BOTTOM + 0.05) audio.knock(0.5);
      puck.position.y = RAIL_BOTTOM;
      mallet.rotation.z = IDLE;
      camTarget.copy(baseTarget);
    },
    update(dt, t) {
      if (!reduced) lamp.rotation.z = Math.sin(t * 0.6) * 0.07;
      if (sparkLife > 0) {
        sparkLife = Math.max(0, sparkLife - dt * 1.2);
        for (let i = 0; i < N; i++) {
          sparkVel[i * 3 + 1] -= 4.5 * dt;
          for (let k = 0; k < 3; k++) sparkPos[i * 3 + k] += sparkVel[i * 3 + k] * dt;
        }
        sparkGeo.attributes.position.needsUpdate = true;
        sparks.material.opacity = sparkLife;
      }
      if (reduced) sparks.material.opacity = 0;
    },
    _state: () => ({ puck: puck.position.y, bell: sparkLife > 0 })
  };
}

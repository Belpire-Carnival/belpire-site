// Find the Pea in 3D: a velvet card table under a swaying brass lamp, three walnut-and-brass shells and a
// golden pea. The shells lift to flash the pea, drop, and whip across curved paths; the member picks a
// shell (tap it or use the buttons) and the picked shell tilts up to show the server's answer.
import { THREE } from '../kit.js';
import { shellSwaps, swapPath, applySwaps, easeOut } from '../choreo.js';

const SLOT_X = [-0.42, 0, 0.42];
const TABLE_Y = 0.75;
const LABELS = ['Left shell', 'Middle shell', 'Right shell'];

export function create(ctx) {
  const { scene, mats, tween, sleep, audio, kit, reduced, low } = ctx;

  // the room: floor, a curtain at the back, the table
  const floor = kit.mesh(new THREE.PlaneGeometry(12, 12), mats.charcoal, { cast: false });
  floor.rotation.x = -Math.PI / 2;
  const curtain = kit.mesh(new THREE.PlaneGeometry(8, 4), mats.velvet, { cast: false });
  curtain.position.set(0, 2, -2.2);
  const top = kit.mesh(new THREE.BoxGeometry(2.2, 0.06, 1.2), mats.velvet);
  top.position.set(0, TABLE_Y - 0.03, 0);
  const apron = kit.mesh(new THREE.BoxGeometry(2.24, 0.2, 1.24), mats.walnut);
  apron.position.set(0, TABLE_Y - 0.16, 0);
  const trimGeo = new THREE.BoxGeometry(2.24, 0.018, 0.018);
  const trimFront = kit.mesh(trimGeo, mats.brass);
  trimFront.position.set(0, TABLE_Y - 0.005, 0.61);
  const trimBack = trimFront.clone();
  trimBack.position.z = -0.61;
  const legGeo = new THREE.BoxGeometry(0.08, TABLE_Y - 0.26, 0.08);
  const legs = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => {
    const l = kit.mesh(legGeo, mats.walnut);
    l.position.set(sx * 1.02, (TABLE_Y - 0.26) / 2, sz * 0.52);
    return l;
  });
  scene.add(floor, curtain, top, apron, trimFront, trimBack, ...legs);

  // the brass lamp, swinging gently on its chain
  const lamp = new THREE.Group();
  lamp.position.set(0, 2.25, 0.05);
  const chain = kit.mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.5, 6), mats.iron);
  chain.position.y = 0.25;
  const shade = kit.mesh(kit.lathe([[0.01, 0.16], [0.06, 0.15], [0.14, 0.08], [0.2, 0.0], [0.205, -0.012]], 40), mats.brass);
  shade.material = mats.brass.clone();
  shade.material.side = THREE.DoubleSide;
  const bulb = kit.mesh(new THREE.SphereGeometry(0.045, 16, 12), mats.bulb, { cast: false });
  bulb.position.y = 0.02;
  const light = new THREE.PointLight(0xffb46b, 7, 4.5, 1.6);
  light.position.y = -0.02;
  light.castShadow = !low;
  light.shadow.mapSize.set(512, 512);
  light.shadow.bias = -0.002;
  lamp.add(chain, shade, bulb, light);
  scene.add(lamp);

  // three shells, each with a felt-lined inside, a brass rim and a little knob
  const outer = kit.lathe([[0.15, 0], [0.153, 0.02], [0.149, 0.06], [0.132, 0.1], [0.1, 0.135], [0.06, 0.156], [0.02, 0.165], [0, 0.167]], 40);
  const inner = kit.lathe([[0.138, 0.002], [0.137, 0.05], [0.122, 0.09], [0.092, 0.122], [0.055, 0.143], [0, 0.152]], 32);
  const felt = mats.velvet.clone();
  felt.side = THREE.BackSide;
  const rimGeo = new THREE.TorusGeometry(0.151, 0.009, 8, 48);
  const knobGeo = new THREE.SphereGeometry(0.018, 12, 8);
  const shells = [0, 1, 2].map((i) => {
    const g = new THREE.Group();
    const wood = mats.walnut.clone();
    const body = kit.mesh(outer, wood);
    const lining = kit.mesh(inner, felt, { cast: false });
    const rim = kit.mesh(rimGeo, mats.brass);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.004;
    const knob = kit.mesh(knobGeo, mats.brass);
    knob.position.y = 0.17;
    g.add(body, lining, rim, knob);
    g.position.set(SLOT_X[i], TABLE_Y, 0.05);
    g.userData.parts = [body, lining, rim, knob];
    g.userData.glow = (hex) => wood.emissive.setHex(hex);
    scene.add(g);
    return g;
  });
  // The Meshy shell is modelled as an upright cup; turned over it covers the pea, knob on top.
  ctx.prop?.('find-the-pea/shell', { size: 0.31 }).then((m) => {
    if (!m) return;
    const h = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3()).y;
    shells.forEach((g, i) => {
      const s = i ? m.clone(true) : m;
      const own = [];
      s.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); own.push(o.material); } });
      s.rotation.x = Math.PI;
      s.position.y = h / 2;
      for (const part of g.userData.parts) part.visible = false;
      g.userData.glow = (hex) => own.forEach((mat) => mat.emissive?.setHex(hex));
      g.add(s);
    });
  });
  ctx.prop?.('shared/brass-lamp', { size: 0.5 }).then((m) => {
    if (!m) return;
    m.position.y = 0.12;
    chain.visible = false;
    shade.visible = false;
    lamp.add(m);
  });

  const pea = kit.mesh(new THREE.SphereGeometry(0.03, 20, 14), mats.gold);
  pea.position.set(SLOT_X[1], TABLE_Y + 0.03, 0.05);
  scene.add(pea);

  let order = [0, 1, 2]; // order[slot] = shell index sitting in that slot
  let peaShell = 1; // the shell the pea travels with during the shuffle
  const tilted = new Set();
  const label = () => order.forEach((shell, slot) => { shells[shell].userData.choice = String(slot + 1); });
  label();

  const setY = (y) => shells.forEach((s) => { s.position.y = y; });

  async function intro() {
    ctx.setHint('Watch the pea…');
    peaShell = order[Math.floor(ctx.rand() * 3)];
    pea.position.x = shells[peaShell].position.x;
    pea.visible = true;
    await tween(320, (t) => setY(TABLE_Y + 0.2 * t));
    await sleep(650);
    await tween(220, (t) => setY(TABLE_Y + 0.2 * (1 - t)));
    audio.knock(0.6);
    if (!reduced) {
      const swaps = shellSwaps(Math.floor(ctx.rand() * 2 ** 31), 7);
      for (let i = 0; i < swaps.length; i++) {
        const [a, b] = swaps[i];
        const sa = shells[order[a]];
        const sb = shells[order[b]];
        audio.slide();
        await tween(Math.max(170, 300 - i * 18), (t) => {
          const [xa, za] = swapPath(SLOT_X[a], SLOT_X[b], t, 1);
          const [xb, zb] = swapPath(SLOT_X[b], SLOT_X[a], t, -1);
          sa.position.set(xa, TABLE_Y, 0.05 + za);
          sb.position.set(xb, TABLE_Y, 0.05 + zb);
          const carrier = shells[peaShell];
          pea.position.set(carrier.position.x, TABLE_Y + 0.03, carrier.position.z);
        });
        order = applySwaps(order, [[a, b]]);
      }
    }
    label();
    ctx.setHint('Pick a shell.');
  }

  async function tilt(slot) {
    const s = shells[order[slot]];
    tilted.add(s);
    audio.knock(0.8);
    await tween(380, (t) => {
      const k = easeOut(t);
      s.rotation.x = -0.95 * k;
      s.position.y = TABLE_Y + 0.13 * k;
      s.position.z = 0.05 - 0.07 * k;
    }, (t) => t);
  }

  return {
    camera: { pos: [0, 1.62, 1.55], target: [0, 0.8, 0], fov: 40, fovPortrait: 62, dolly: 1.25 },
    controls: LABELS.map((text, i) => ({ label: text, choice: String(i + 1) })),
    pickables: shells,
    waiting: 'The barker leans in…',
    intro,
    winPoint: () => pea.position.clone(),
    hover(choice) {
      shells.forEach((s) => s.userData.glow(s.userData.choice === choice ? 0x2a1406 : 0x000000));
    },
    async play(choice, pending) {
      const slot = Number(choice) - 1;
      const picked = shells[order[slot]];
      picked.userData.glow(0x3a1c08);
      const r = await pending;
      const v = r.visualParams;
      // the pea is under whichever shell the server says
      pea.position.set(SLOT_X[v.pea], TABLE_Y + 0.03, 0.05);
      pea.visible = true;
      await tilt(slot);
      if (r.outcomeTier !== 'found') {
        await sleep(450);
        await tilt(v.pea);
      } else {
        await tween(500, (t) => pea.scale.setScalar(1 + Math.sin(Math.PI * t) * 0.6));
      }
      picked.userData.glow(0x000000);
      return r;
    },
    async reset({ more } = {}) {
      const back = [...tilted];
      tilted.clear();
      await tween(300, (t) => back.forEach((s) => {
        s.rotation.x = -0.95 * (1 - t);
        s.position.y = TABLE_Y + 0.13 * (1 - t);
        s.position.z = 0.05 - 0.07 * (1 - t);
      }));
      order.forEach((shell, slot) => shells[shell].position.set(SLOT_X[slot], TABLE_Y, 0.05));
      if (more) await intro();
    },
    update(dt, t) {
      if (reduced) return;
      lamp.rotation.z = Math.sin(t * 0.7) * 0.06;
      lamp.rotation.x = Math.sin(t * 0.45) * 0.03;
      pea.rotation.y += dt;
    },
    // for tests: where things ended up
    _state: () => ({ order: [...order], pea: pea.position.clone(), tilted: shells.map((s) => tilted.has(s) || s.rotation.x < -0.5) })
  };
}

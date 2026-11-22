// Ring Toss in 3D: a first-person view over a wooden counter at three stepped rows of glass bottles
// (emerald in front, amber in the middle, ruby at the back). Pick a row; a braided rope ring arcs out and
// either drops cleanly around a neck or clinks off the glass, as the server decided.
import { THREE } from '../kit.js';
import { arcPoint, lerp } from '../choreo.js';

export const ROWS = {
  front: { z: 0.15, y: 0.95, color: 0x1f7a4a },
  middle: { z: -0.3, y: 1.1, color: 0xb5651d },
  back: { z: -0.75, y: 1.25, color: 0x8e1b2b }
};
export const BOTTLE_X = [-0.39, -0.13, 0.13, 0.39];
export const NECK_TOP = 0.36; // above the row's shelf
export const RINGER_REST = 0.225; // where a ringer settles on the shoulders
const START = [0.12, 1.12, 1.6];

export function create(ctx, game) {
  const { scene, mats, tween, sleep, audio, kit } = ctx;

  const floor = kit.mesh(new THREE.PlaneGeometry(12, 12), mats.charcoal, { cast: false });
  floor.rotation.x = -Math.PI / 2;
  const curtain = kit.mesh(new THREE.PlaneGeometry(8, 4), mats.velvet, { cast: false });
  curtain.position.set(0, 2, -1.3);
  const counter = kit.mesh(new THREE.BoxGeometry(2.6, 0.9, 0.45), mats.walnut);
  counter.position.set(0, 0.45, 1.05);
  const lip = kit.mesh(new THREE.BoxGeometry(2.62, 0.03, 0.5), mats.brass);
  lip.position.set(0, 0.915, 1.05);
  scene.add(floor, curtain, counter, lip);

  // a string of bulbs over the bottles
  const bulbGeo = new THREE.SphereGeometry(0.03, 10, 8);
  for (let i = 0; i < 11; i++) {
    const b = kit.mesh(bulbGeo, mats.bulb, { cast: false });
    b.position.set(-1.1 + i * 0.22, 1.95 - Math.sin((i / 10) * Math.PI) * 0.1, -1.0);
    scene.add(b);
  }
  const wash = new THREE.PointLight(0xffb46b, 3, 4, 1.8);
  wash.position.set(0, 1.9, -0.6);
  scene.add(wash);

  const bottleGeo = kit.lathe([[0, 0], [0.055, 0], [0.06, 0.012], [0.06, 0.17], [0.05, 0.21], [0.028, 0.245], [0.021, 0.27], [0.02, 0.33], [0.024, 0.34], [0.024, 0.355], [0.018, NECK_TOP], [0, NECK_TOP]], 28);
  const bottles = {};
  const rowGroups = [];
  for (const [row, r] of Object.entries(ROWS)) {
    const g = new THREE.Group();
    g.userData.choice = row;
    const shelf = kit.mesh(new THREE.BoxGeometry(1.1, 0.06, 0.32), mats.oak);
    shelf.position.set(0, r.y - 0.03, r.z);
    const riser = kit.mesh(new THREE.BoxGeometry(1.1, r.y - 0.06, 0.06), mats.walnut);
    riser.position.set(0, (r.y - 0.06) / 2, r.z + 0.13);
    g.add(shelf, riser);
    const glass = mats.glass(r.color);
    bottles[row] = BOTTLE_X.map((x) => {
      const b = kit.mesh(bottleGeo, glass);
      b.position.set(x, r.y, r.z);
      g.add(b);
      return b;
    });
    scene.add(g);
    rowGroups.push(g);
  }

  // the ring: braided hemp bound with brass wire
  const ring = new THREE.Group();
  const hemp = kit.mesh(new THREE.TorusGeometry(0.056, 0.011, 10, 40), mats.hemp);
  ring.add(hemp);
  // three brass wire bindings around the rope
  const bindGeo = new THREE.TorusGeometry(0.0125, 0.0022, 6, 16);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const bind = kit.mesh(bindGeo, mats.brass, { cast: false });
    bind.position.set(Math.cos(a) * 0.056, Math.sin(a) * 0.056, 0);
    bind.rotation.set(Math.PI / 2, a, 0, 'ZXY');
    bind.rotation.y = 0;
    bind.lookAt(0, 0, 0);
    bind.rotateY(Math.PI / 2);
    ring.add(bind);
  }
  ring.rotation.x = Math.PI / 2;
  ring.position.set(...START);
  scene.add(ring);
  // Meshy props: the braided ring (modelled lying flat, so turned back into the ring's plane) and the booth
  // counter, three of them side by side across the front.
  ctx.prop?.('ring-toss/ring', { size: 0.135 }).then((m) => {
    if (!m) return;
    m.rotation.x = -Math.PI / 2;
    for (const c of [...ring.children]) c.visible = false;
    ring.add(m);
  });
  ctx.prop?.('shared/booth-counter', { size: 0.8, axis: 'y', anchor: 'base' }).then((m) => {
    if (!m) return;
    const w = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3()).x;
    counter.visible = false;
    lip.visible = false;
    for (const i of [-1, 0, 1]) {
      const c = i ? m.clone(true) : m;
      c.position.set(i * w * 0.98, 0, 1.3);
      scene.add(c);
    }
  });

  const sub = (row) => {
    const tiers = game.odds[row];
    const top = tiers.at(-1);
    return `${top.chance}% · ${top.pay} Slivers`;
  };
  const place = (p) => ring.position.set(p[0], p[1], p[2]);

  return {
    camera: { pos: [0, 1.6, 2.35], target: [0, 1.05, -0.2], fov: 42, fovPortrait: 54, dolly: 1.32 },
    controls: ['front', 'middle', 'back'].map((row) => ({ label: `${row[0].toUpperCase()}${row.slice(1)} row`, sub: sub(row), choice: row })),
    pickables: rowGroups,
    waiting: 'You take aim…',
    winPoint: () => ring.position.clone(),
    intro() { ctx.setHint('Pick a row: nearer is easier, farther pays more.'); },
    hover(choice) {
      for (const g of rowGroups) g.position.y = g.userData.choice === choice ? 0.012 : 0;
    },
    async play(row, pending) {
      for (const g of rowGroups) g.position.y = 0;
      const r = await pending;
      const v = r.visualParams;
      const R = ROWS[v.row];
      const x = BOTTLE_X[v.bottle];
      const neck = [x, R.y + NECK_TOP, R.z];
      // tilted toward the camera in flight so it reads as a ring, flat when it lands
      const spin = (t) => { ring.rotation.z = t * Math.PI * 3; ring.rotation.x = Math.PI / 2 - 0.55 * (1 - t); };
      if (r.outcomeTier === 'ringer') {
        const over = [x, neck[1] + 0.06, R.z];
        await tween(680, (t) => { place(arcPoint(START, over, 0.35, t)); spin(t); }, (t) => t);
        await tween(260, (t) => { ring.position.y = lerp(over[1], R.y + RINGER_REST, t); }, (t) => t * t);
        audio.clink(1);
        await tween(380, (t) => { ring.rotation.y = Math.sin(t * Math.PI * 4) * 0.12 * (1 - t); });
      } else {
        const side = ctx.rand() < 0.5 ? -1 : 1;
        const rim = [x + side * 0.03, neck[1] + 0.005, R.z];
        await tween(680, (t) => { place(arcPoint(START, rim, 0.35, t)); spin(t); }, (t) => t);
        audio.clink(1.15);
        const land = [x + side * 0.2, R.y + 0.012, R.z + 0.06];
        await tween(420, (t) => {
          place(arcPoint(rim, land, 0.08, t));
          ring.rotation.y = side * 0.5 * (1 - t);
        }, (t) => t);
        audio.clink(0.8);
      }
      await sleep(200);
      return r;
    },
    async reset() {
      await sleep(300);
      ring.rotation.set(Math.PI / 2, 0, 0);
      place(START);
    },
    update(dt, t) {
      if (ctx.reduced) return;
      if (ring.position.z === START[2]) ring.position.y = START[1] + Math.sin(t * 2) * 0.006;
    },
    _state: () => ({ ring: ring.position.clone() })
  };
}

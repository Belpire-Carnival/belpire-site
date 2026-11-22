// The Midway's 3D stage: the pure choreography helpers, and each 3D booth built headless (Three.js runs in
// Node without a renderer) to check it always lands on the result the server sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arcPoint, shellSwaps, applySwaps, swapPath, puckY, mulberry32, shake } from '../../site/midway/choreo.js';
import { THREE, materials, lathe, mesh } from '../../site/midway/kit.js';
import * as pea from '../../site/midway/booths/find-the-pea.js';
import * as rings from '../../site/midway/booths/ring-toss.js';
import * as striker from '../../site/midway/booths/high-striker.js';
import { GAMES, oddsOf } from '../midway.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('arcs start and end where asked and peak above both ends', () => {
  const a = [0, 1, 2];
  const b = [1, 1.5, -1];
  assert.deepEqual(arcPoint(a, b, 0.4, 0), a);
  assert.ok(arcPoint(a, b, 0.4, 1).every((v, i) => near(v, b[i])));
  let peak = -Infinity;
  for (let t = 0; t <= 1; t += 0.001) peak = Math.max(peak, arcPoint(a, b, 0.4, t)[1]);
  assert.ok(near(peak, 1.9, 1e-3), `peak ${peak}`);
});

test('the shell shuffle is a fair permutation, repeatable from its seed, never a slot with itself', () => {
  const s = shellSwaps(42, 50);
  assert.deepEqual(s, shellSwaps(42, 50));
  assert.ok(s.every(([a, b]) => a !== b && a >= 0 && a < 3 && b >= 0 && b < 3));
  assert.deepEqual([...applySwaps([0, 1, 2], s)].sort(), [0, 1, 2]);
  assert.deepEqual(swapPath(-1, 1, 0), [-1, 0]);
  assert.ok(near(swapPath(-1, 1, 1)[0], 1) && near(swapPath(-1, 1, 1)[1], 0));
});

test('the puck reaches the bell only at 10, and the shake fades out', () => {
  assert.equal(puckY(10, 0.5, 3.36), 3.36);
  assert.ok(puckY(9, 0.5, 3.36) < 3.36);
  assert.ok(near(puckY(0, 0.5, 3.36), 0.5));
  const r = mulberry32(1);
  assert.ok(shake(1, 0.1, r).every((v) => v === 0 || Object.is(v, -0)), 'no shake at the end');
  assert.ok(shake(0, 0.1, () => 1).every((v) => near(v, 0.1)), 'full shake at the start');
});

// A stage without a renderer: instant tweens, silent audio.
function fakeCtx() {
  const scene = new THREE.Scene();
  const silent = new Proxy({}, { get: () => () => {} });
  return {
    THREE, scene, camera: new THREE.PerspectiveCamera(), mats: materials(), audio: silent,
    tween: (ms, fn) => { fn(1); return Promise.resolve(); },
    sleep: () => Promise.resolve(),
    reduced: true, low: false, kit: { lathe, mesh }, rand: mulberry32(7), camTarget: new THREE.Vector3(),
    shake() {}, setHint() {}
  };
}
const gameFor = (id) => ({ id, name: GAMES[id].name, odds: oddsOf(id), playsMax: GAMES[id].plays, playsUsed: 0, choice: GAMES[id].choice || null });
const result = (outcomeTier, visualParams) => Promise.resolve({ outcomeTier, visualParams, totalPayout: 0, playsUsed: 1, playsMax: 5 });

test('Find the Pea: the pea shows under the server\'s shell, whatever was picked', async () => {
  for (const [pick, peaSlot, tier] of [['1', 0, 'found'], ['2', 0, 'miss'], ['3', 1, 'miss'], ['3', 2, 'found']]) {
    const ctx = fakeCtx();
    const b = pea.create(ctx, gameFor('find-the-pea'));
    await b.intro();
    assert.equal(b.pickables.length, 3);
    assert.deepEqual(b.pickables.map((s) => s.userData.choice).sort(), ['1', '2', '3']);
    await b.play(pick, result(tier, { pick: Number(pick) - 1, pea: peaSlot }));
    const st = b._state();
    assert.ok(near(st.pea.x, [-0.42, 0, 0.42][peaSlot]), 'pea under the right slot');
    const lifted = st.order.map((shell) => st.tilted[shell]);
    assert.equal(lifted[Number(pick) - 1], true, 'the picked shell lifts');
    assert.equal(lifted[peaSlot], true, 'and the shell with the pea always shows it');
    await b.reset({ more: true });
    assert.ok(b._state().tilted.every((t) => !t), 'shells back down');
  }
});

test('Ring Toss: a ringer settles on the server\'s bottle; a miss lands off the neck', async () => {
  for (const row of ['front', 'middle', 'back']) {
    for (let bottle = 0; bottle < 4; bottle++) {
      const ctx = fakeCtx();
      const b = rings.create(ctx, gameFor('ring-toss'));
      assert.deepEqual(b.controls.map((c) => c.choice), ['front', 'middle', 'back']);
      await b.play(row, result('ringer', { row, bottle }));
      const p = b._state().ring;
      const R = rings.ROWS[row];
      assert.ok(near(p.x, rings.BOTTLE_X[bottle]) && near(p.z, R.z) && near(p.y, R.y + rings.RINGER_REST), `${row} ${bottle}`);
      const ctx2 = fakeCtx();
      const m = rings.create(ctx2, gameFor('ring-toss'));
      await m.play(row, result('miss', { row, bottle }));
      const q = m._state().ring;
      assert.ok(Math.abs(q.x - rings.BOTTLE_X[bottle]) > 0.1, 'a miss is not around the neck');
      assert.ok(q.y < R.y + 0.05, 'it ends on the shelf');
    }
  }
  assert.match(rings.create(fakeCtx(), gameFor('ring-toss')).controls[2].sub, /10% · 50 Slivers/);
});

test('High Striker: the puck stops at the server\'s height; only 10 rings the bell', async () => {
  for (let h = 1; h <= 10; h++) {
    const b = striker.create(fakeCtx(), gameFor('high-striker'));
    await b.play(null, result(h === 10 ? 'bell' : 'strongman', { height: h }));
    const st = b._state();
    assert.ok(near(st.puck, puckY(h, striker.RAIL_BOTTOM, striker.RAIL_TOP)), `height ${h}`);
    assert.equal(st.bell, h === 10);
    await b.reset();
    assert.ok(near(b._state().puck, striker.RAIL_BOTTOM));
  }
});

test('the page and the stage agree on which booths are 3D, and Three.js is the vendored copy', () => {
  const stage = readFileSync(new URL('../../site/midway/stage.js', import.meta.url), 'utf8');
  const me = readFileSync(new URL('../../site/me/me.js', import.meta.url), 'utf8');
  const fromStage = [...stage.match(/const BOOTHS = \{([\s\S]*?)\};/)[1].matchAll(/'([a-z-]+)': \(\)/g)].map((m) => m[1]).sort();
  const fromMe = [...me.match(/const STAGE_3D = new Set\(\[([^\]]*)\]\)/)[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(fromMe, fromStage);
  for (const id of fromStage) assert.ok(GAMES[id], id);
  const three = readFileSync(new URL('../../site/vendor/three-0.170.0/three.module.min.js', import.meta.url), 'utf8');
  assert.match(three.slice(0, 200), /Copyright 2010-2024 Three\.js Authors[\s\S]*MIT/);
  assert.match(three, /const t="170"/);
  assert.ok(readFileSync(new URL('../../site/vendor/three-0.170.0/LICENSE.txt', import.meta.url), 'utf8').includes('MIT'));
  // no booth or stage file reaches outside the site for code
  for (const f of ['stage.js', 'kit.js', 'audio.js', 'booths/find-the-pea.js', 'booths/ring-toss.js', 'booths/high-striker.js']) {
    const src = readFileSync(new URL(`../../site/midway/${f}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/(?:from|import\()\s*'([^']+)'/g)) assert.ok(m[1].startsWith('.') || m[1].startsWith('/midway/'), `${f} imports ${m[1]}`);
  }
});

test('every Meshy prop in the manifest is on disk, a glTF binary with WebP textures, under the 3 MB budget', async () => {
  const { readFileSync: read, statSync } = await import('node:fs');
  const manifest = JSON.parse(read(new URL('../../scripts/meshy-manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.assets.length, 43);
  for (const a of manifest.assets) {
    const url = new URL(`../../site/assets/midway/${a.game}/${a.prop}.glb`, import.meta.url);
    const size = statSync(url).size;
    assert.ok(size < 3 * 1024 * 1024, `${a.game}/${a.prop} is ${size} bytes`);
    const b = read(url);
    assert.equal(b.readUInt32LE(0), 0x46546c67, `${a.game}/${a.prop} is a .glb`);
    const doc = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
    assert.ok((doc.images || []).every((im) => im.mimeType === 'image/webp'), `${a.game}/${a.prop} textures are WebP`);
    assert.ok(doc.extensionsUsed?.includes('EXT_texture_webp'));
    assert.ok(a.prompt && a.polycount && [512, 1024].includes(a.texture));
  }
});

test('the vendored glTF loader is the published file with only its three import repointed', async () => {
  const { readFileSync: read } = await import('node:fs');
  for (const f of ['loaders/GLTFLoader.js', 'utils/BufferGeometryUtils.js']) {
    const src = read(new URL(`../../site/vendor/three-0.170.0/${f}`, import.meta.url), 'utf8');
    assert.ok(!src.includes("from 'three'"), f);
    assert.equal((src.match(/from '\.\.\/three\.module\.min\.js'/g) || []).length, 1, f);
  }
});

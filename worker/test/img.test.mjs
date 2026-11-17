import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleImg } from '../sc-img.js';

const PATH = 'thumb/e/e4/Apollo_Medivac_flying.png/400px-Apollo_Medivac_flying.png';
const hit = (p) => new URL(`https://bureau.belpire.com/api/sc-img?p=${p}`);

test('a PNG thumbnail saved without .webp is retried with .webp', async () => {
  const asked = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => {
    asked.push(String(u));
    return String(u).endsWith('.webp')
      ? new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'image/webp' } })
      : new Response('missing', { status: 404 });
  };
  try {
    const res = await handleImg(hit(PATH), {});
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'image/webp');
    assert.equal(asked.length, 2);
    assert.ok(asked[1].endsWith('.png.webp'));
  } finally { globalThis.fetch = real; }
});

test('a missing image that already ends in .webp is not retried', async () => {
  let n = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async () => { n++; return new Response('missing', { status: 404 }); };
  try {
    const res = await handleImg(hit(`${PATH}.webp`), {});
    assert.equal(res.status, 404);
    assert.equal(n, 1);
  } finally { globalThis.fetch = real; }
});

test('a missing original (no size in the path) is not retried', async () => {
  let n = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async () => { n++; return new Response('missing', { status: 404 }); };
  try {
    const res = await handleImg(hit('e/e4/Apollo_Medivac_flying.png'), {});
    assert.equal(res.status, 404);
    assert.equal(n, 1);
  } finally { globalThis.fetch = real; }
});

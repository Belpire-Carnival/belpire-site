import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { imgPath, slimPart, slimShip, buildSnapshot, SCHEMA, IMG_PATH } from '../sc-builder.js';
import { handleImg, slimItem, handleItem } from '../sc-img.js';
import { cleanImg } from '../../site/bureau/rsi1/companion/items.js';

const rec = (u) => ({ images: [{ source: 'starcitizen.tools', original_url: u, thumbnail_url: u }] });

test('imgPath keeps only plain image paths on the wiki media host', () => {
  assert.equal(imgPath(rec('https://media.starcitizen.tools/thumb/8/87/CutlassBlack_1.jpg/600px-CutlassBlack_1.jpg')), 'thumb/8/87/CutlassBlack_1.jpg/600px-CutlassBlack_1.jpg');
  assert.equal(imgPath(rec('https://media.starcitizen.tools/8/87/CutlassBlack.jpg')), '8/87/CutlassBlack.jpg');
  for (const bad of ['https://evil.example/8/87/a.jpg', 'http://media.starcitizen.tools/8/87/a.jpg', 'https://media.starcitizen.tools.evil.com/8/87/a.jpg', 'https://media.starcitizen.tools/8/87/../../etc', 'https://media.starcitizen.tools/x/y/a.jpg', 'javascript:alert(1)', 'https://media.starcitizen.tools/8/87/a.jpg?x=<b>']) {
    assert.equal(imgPath(rec(bad)).includes('?') || imgPath(rec(bad)).includes('..'), false, bad);
  }
  assert.equal(imgPath(rec('https://evil.example/8/87/a.jpg')), '');
  assert.equal(imgPath(rec('https://media.starcitizen.tools/8/87/../../etc')), '');
  assert.equal(imgPath({}), ''); assert.equal(imgPath(null), '');
});

test('slimPart and slimShip carry the picture; the snapshot is versioned by schema', () => {
  const p = slimPart({ uuid: 'u1', type: 'Shield', name: 'S', ...rec('https://media.starcitizen.tools/8/87/S.jpg') });
  assert.equal(p.img, '8/87/S.jpg');
  assert.equal('img' in slimPart({ uuid: 'u2', type: 'Shield', name: 'N' }), false);
  assert.equal(slimShip({ uuid: 's', name: 'Ship', ...rec('https://media.starcitizen.tools/8/87/Ship.jpg') }).img, '8/87/Ship.jpg');
  assert.equal(buildSnapshot('4.x', [], []).schema, SCHEMA);
});

test('the image route refuses anything but a plain wiki path', async () => {
  for (const p of ['', '../x', 'http://evil/x.png', '8/87/a b.png', 'thumb/8/87/a.png/%2e%2e', '8/87/' + 'a'.repeat(200)]) {
    const res = await handleImg(new URL(`https://x.test/api/sc-img?p=${encodeURIComponent(p)}`), {});
    assert.equal(res.status, 400, p);
  }
});

test('the image route passes through an image and rejects other content', async () => {
  const real = globalThis.fetch;
  try {
    let seen;
    globalThis.fetch = async (u) => { seen = String(u); return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } }); };
    const ok = await handleImg(new URL('https://x.test/api/sc-img?p=8/87/a.jpg'), {});
    assert.equal(ok.status, 200); assert.equal(seen, 'https://media.starcitizen.tools/8/87/a.jpg');
    assert.match(ok.headers.get('cache-control'), /max-age=2592000/); assert.equal(ok.headers.get('content-type'), 'image/jpeg');
    globalThis.fetch = async () => new Response('<script>', { status: 200, headers: { 'content-type': 'text/html' } });
    assert.equal((await handleImg(new URL('https://x.test/api/sc-img?p=8/87/b.jpg'), {})).status, 502);
  } finally { globalThis.fetch = real; }
});

test('item search returns slim rows and validates the query', async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ uuid: 'i', name: 'Pembroke Core', type: 'Char_Armor_Torso', manufacturer: { name: 'RSI' }, ...rec('https://media.starcitizen.tools/9/9a/P.png') }, { nope: 1 }] }), { status: 200 });
    const r = await handleItem(new URL('https://x.test/api/sc-item?q=pembroke'), {}, {});
    assert.equal(r.status, 200); assert.equal(r.body.items.length, 1); assert.equal(r.body.items[0].img, '9/9a/P.png');
    assert.equal((await handleItem(new URL('https://x.test/api/sc-item?q=p'), {}, {})).status, 400);
  } finally { globalThis.fetch = real; }
  assert.equal(slimItem({}), null);
});

test('the page applies the same picture-path rule', () => {
  assert.equal(cleanImg('thumb/8/87/A.jpg/600px-A.jpg'), 'thumb/8/87/A.jpg/600px-A.jpg');
  assert.equal(cleanImg('https://evil/a.jpg'), ''); assert.equal(cleanImg('../x'), ''); assert.equal(cleanImg(5), '');
  assert.ok(IMG_PATH.test('8/87/a.jpg'));
});

test('item search builds a stat line from the record, and the CSP allows only the wiki image host', async () => {
  const { itemInfo } = await import('../sc-img.js');
  const line = itemInfo({ description_data: [{ name: 'Carrying Capacity', value: '180K µSCU' }, { name: 'Item Type', value: 'Heavy Backpack' }], suit_armor: { damage_resistance_map: { physical: 0.8, energy: null, stun: 0.5 } }, uex_prices: { purchase: [{ price_buy: 8531 }, { price_buy: 8105 }] } });
  assert.match(line, /Carrying Capacity 180K µSCU/); assert.match(line, /Resist Phys 0.8 Stun 0.5/); assert.match(line, /from 8,105 aUEC/);
  const headers = readFileSync(new URL('../../site/_headers', import.meta.url), 'utf8');
  assert.match(headers, /img-src 'self' data: blob: [^;]*https:\/\/media\.starcitizen\.tools;/);
  assert.doesNotMatch(headers, /(?:script|connect|default)-src[^;]*media\.starcitizen\.tools/);
});

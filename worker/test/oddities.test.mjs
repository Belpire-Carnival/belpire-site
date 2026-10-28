import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { seal, SESSION_COOKIE } from '../auth.js';
import { _clearMemberCache } from '../polls.js';
import { _resetSchemaFlag } from '../oddity-db.js';
import { purgeStaleUploads, REPORTS_TO_HIDE, DAILY_LIMITS } from '../oddities.js';
import { sniff, imageSize, stripMetadata, cleanCaption, parseVerdict, CLIP_PART_BYTES, CLIP_MAX_BYTES } from '../oddity-check.js';
import { fakeD1 } from './helpers/d1.mjs';

const ORIGIN = 'https://belpire.com';
const GUILD = '100000000000000001';
const MANAGER_ROLE = '200000000000000001';
const USERS = { boss: '300000000000000001', fan: '300000000000000003', fan2: '300000000000000004', fan3: '300000000000000005', fan4: '300000000000000006', stranger: '300000000000000009' };

// ---------------------------------------------------------------- sample files

const enc = (s) => new TextEncoder().encode(s);
const u32be = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32le = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const cat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...(p instanceof Uint8Array ? p : Array.isArray(p) ? p : enc(p))]));
const pngChunk = (type, data) => cat(u32be(data.length), type, data, [0, 0, 0, 0]);

function png({ w = 640, h = 360, text = true } = {}) {
  return cat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    pngChunk('IHDR', [...u32be(w), ...u32be(h), 8, 2, 0, 0, 0]),
    text ? pngChunk('tEXt', [...enc('GPS'), 0, ...enc('40.7128,-74.0060')]) : [],
    pngChunk('IDAT', [1, 2, 3, 4]),
    pngChunk('IEND', []));
}

function jpeg({ w = 800, h = 600, trailer = true } = {}) {
  const exif = cat([0xff, 0xe1], [0, 18], 'Exif\0\0GPS-HOME!!');
  const sof = cat([0xff, 0xc0, 0, 17, 8], [h >> 8, h & 255, w >> 8, w & 255], [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const sos = cat([0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0], [0x12, 0x34, 0x56], [0xff, 0xd9]);
  return cat([0xff, 0xd8], cat([0xff, 0xe0, 0, 16], 'JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0]), exif, cat([0xff, 0xfe, 0, 7], 'hello'), sof, sos, trailer ? enc('<script>alert(1)</script>') : []);
}

function webp({ w = 1920, h = 1080 } = {}) {
  const vp8x = cat('VP8X', u32le(10), [0x0c, 0, 0, 0], [(w - 1) & 255, ((w - 1) >> 8) & 255, 0, (h - 1) & 255, ((h - 1) >> 8) & 255, 0]);
  const exifChunk = cat('EXIF', u32le(4), 'GPS!');
  const img = cat('VP8 ', u32le(4), [1, 2, 3, 4]);
  const body = cat('WEBP', vp8x, exifChunk, img);
  return cat('RIFF', u32le(body.length), body);
}

const mp4 = (size = 64) => { const b = new Uint8Array(size); b.set(cat([0, 0, 0, 24], 'ftypisom')); return b; };
const webm = () => cat([0x1a, 0x45, 0xdf, 0xa3], [0x9f, 0x42, 0x86, 0x81, 0x01], [0x42, 0x82, 0x84], 'webm', new Uint8Array(32));
const has = (hay, needle) => Buffer.from(hay).includes(Buffer.from(needle));

// ---------------------------------------------------------------- pure checks

test('sniff accepts only PNG, JPEG, WebP, MP4 and WebM, by content', () => {
  assert.deepEqual(sniff(png()), { ok: true, kind: 'image', mime: 'image/png' });
  assert.deepEqual(sniff(jpeg()), { ok: true, kind: 'image', mime: 'image/jpeg' });
  assert.deepEqual(sniff(webp()), { ok: true, kind: 'image', mime: 'image/webp' });
  assert.deepEqual(sniff(mp4()), { ok: true, kind: 'clip', mime: 'video/mp4' });
  assert.deepEqual(sniff(webm()), { ok: true, kind: 'clip', mime: 'video/webm' });
  const refused = {
    bmp: cat('BM', new Uint8Array(40)),
    gif: cat('GIF89a', new Uint8Array(20)),
    svg: enc('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'),
    html: enc('  <html><body>hi</body></html>      '),
    pdf: cat('%PDF-1.7', new Uint8Array(20)),
    zip: cat([0x50, 0x4b, 0x03, 0x04], new Uint8Array(20)),
    exe: cat('MZ', new Uint8Array(40)),
    mov: cat([0, 0, 0, 20], 'ftypqt  ', new Uint8Array(20)),
    heic: cat([0, 0, 0, 20], 'ftypheic', new Uint8Array(20)),
    tiny: enc('hi')
  };
  for (const [name, bytes] of Object.entries(refused)) {
    const r = sniff(bytes);
    assert.equal(r.ok, false, name);
    assert.ok(r.reason.length > 10, name);
  }
  assert.match(sniff(refused.bmp).reason, /Bitmap/);
});

test('imageSize reads dimensions from each format', () => {
  assert.deepEqual(imageSize(png({ w: 1280, h: 720 }), 'image/png'), { width: 1280, height: 720 });
  assert.deepEqual(imageSize(jpeg({ w: 1024, h: 768 }), 'image/jpeg'), { width: 1024, height: 768 });
  assert.deepEqual(imageSize(webp({ w: 1920, h: 1080 }), 'image/webp'), { width: 1920, height: 1080 });
});

test('stripMetadata removes location data, comments and smuggled trailers', () => {
  const p = stripMetadata(png(), 'image/png');
  assert.ok(!has(p, 'GPS') && has(p, 'IDAT') && has(p, 'IEND'));
  assert.deepEqual(imageSize(p, 'image/png'), { width: 640, height: 360 });

  const j = stripMetadata(jpeg(), 'image/jpeg');
  assert.ok(!has(j, 'GPS-HOME') && !has(j, 'hello') && !has(j, '<script>'));
  assert.deepEqual([...j.slice(-2)], [0xff, 0xd9]);
  assert.deepEqual(imageSize(j, 'image/jpeg'), { width: 800, height: 600 });

  const w = stripMetadata(webp(), 'image/webp');
  assert.ok(!has(w, 'EXIF') && !has(w, 'GPS!') && has(w, 'VP8 '));
  assert.equal(new DataView(w.buffer).getUint32(4, true), w.length - 8, 'RIFF size updated');
  assert.equal(w[20] & 0x0c, 0, 'EXIF/XMP flags cleared');
});

test('parseVerdict is strict: anything unclear goes to review', () => {
  assert.deepEqual(parseVerdict({ response: '{"verdict":"allow","reason":"game screenshot"}' }), { verdict: 'allow', reason: 'game screenshot' });
  assert.equal(parseVerdict('Sure! {"verdict":"block","reason":"nudity"}').verdict, 'block');
  assert.equal(parseVerdict({ response: '{"verdict":"maybe"}' }).verdict, 'review');
  assert.equal(parseVerdict({ response: 'I cannot help with that.' }).verdict, 'review');
  assert.equal(parseVerdict(null).verdict, 'review');
});

test('cleanCaption strips control and direction characters and trims', () => {
  assert.equal(cleanCaption('  Jump‮scare\n\n<b>lol</b>  '), 'Jump scare <b>lol</b>');
  assert.equal(cleanCaption('x'.repeat(500)).length, 60);
  assert.equal(cleanCaption(undefined), '');
});

// ---------------------------------------------------------------- API

function fakeR2() {
  const objects = new Map();
  const uploads = new Map();
  const getObj = (key, opts) => {
    const o = objects.get(key);
    if (!o) return null;
    let body = o.bytes;
    let range;
    const r = opts?.range?.get?.('Range');
    if (r) {
      const [, a, b] = r.match(/bytes=(\d+)-(\d*)/);
      const offset = Number(a);
      const end = b ? Number(b) : o.bytes.length - 1;
      body = o.bytes.slice(offset, end + 1);
      range = { offset, length: body.length };
    }
    return { body, size: o.bytes.length, etag: 'e1', httpEtag: '"e1"', range };
  };
  return {
    objects,
    uploads,
    async put(key, bytes, opts) { objects.set(key, { bytes: new Uint8Array(bytes), type: opts?.httpMetadata?.contentType }); },
    async get(key, opts) { return getObj(key, opts); },
    async head(key) { const o = objects.get(key); return o ? { size: o.bytes.length } : null; },
    async delete(key) { objects.delete(key); },
    async createMultipartUpload(key, opts) {
      const uploadId = `up-${uploads.size + 1}`;
      uploads.set(uploadId, { key, parts: new Map(), type: opts?.httpMetadata?.contentType, aborted: false });
      return { uploadId, key };
    },
    resumeMultipartUpload(key, uploadId) {
      const u = uploads.get(uploadId);
      return {
        async uploadPart(n, bytes) { u.parts.set(n, new Uint8Array(bytes)); return { partNumber: n, etag: `etag-${n}` }; },
        async complete(parts) {
          const bytes = cat(...parts.map((p) => u.parts.get(p.partNumber)));
          objects.set(key, { bytes, type: u.type });
          uploads.delete(uploadId);
        },
        async abort() { u.aborted = true; uploads.delete(uploadId); }
      };
    }
  };
}

let env;
let aiMode;
const realFetch = globalThis.fetch;

beforeEach(() => {
  _clearMemberCache();
  _resetSchemaFlag();
  aiMode = 'allow';
  const members = {
    [USERS.boss]: { nick: 'RingMaster', roles: [MANAGER_ROLE], user: { username: 'boss' } },
    [USERS.fan]: { roles: [], user: { username: 'fan', global_name: 'Fan One' } },
    [USERS.fan2]: { roles: [], user: { username: 'fan2' } },
    [USERS.fan3]: { roles: [], user: { username: 'fan3' } },
    [USERS.fan4]: { roles: [], user: { username: 'fan4' } }
  };
  globalThis.fetch = async (url) => {
    const m = new URL(url).pathname.match(/^\/api\/v10\/guilds\/\d+\/members\/(\d+)$/);
    if (m) return members[m[1]] ? Response.json(members[m[1]]) : Response.json({ code: 10007 }, { status: 404 });
    throw new Error('unexpected fetch ' + url);
  };
  env = {
    SESSION_SECRET: 'x'.repeat(48),
    DISCORD_BOT_TOKEN: 'bot-token',
    DISCORD_GUILD_ID: GUILD,
    POLL_MANAGER_ROLE_IDS: MANAGER_ROLE,
    MAIN_STAGE_CHANNEL_ID: '100000000000000002',
    GENERAL_CHANNEL_ID: '100000000000000003',
    DB: fakeD1(),
    ODDITIES: fakeR2(),
    AI: {
      calls: 0,
      async run(model, input) {
        this.calls++;
        assert.match(model, /^@cf\//);
        const img = input.messages[1].content.find((c) => c.type === 'image_url');
        assert.match(img.image_url.url, /^data:image\/(png|jpeg|webp);base64,/);
        if (aiMode === 'throw') throw new Error('model unavailable');
        return { response: `{"verdict":"${aiMode}","reason":"test"}` };
      }
    },
    ASSETS: { fetch: async () => new Response('nope', { status: 404 }) }
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

async function cookieFor(uid) {
  const t = Math.floor(Date.now() / 1000);
  return `${SESSION_COOKIE}=${await seal({ uid, name: 'Someone', iat: t, exp: t + 3600 }, env.SESSION_SECRET, 'session')}`;
}
const ctx = { waitUntil: (p) => p };

async function call(path, { as, method = 'GET', body, type, origin = ORIGIN, headers: extra = {} } = {}) {
  const headers = { ...extra };
  if (as) headers.Cookie = await cookieFor(USERS[as]);
  if (method !== 'GET') headers.Origin = origin;
  let payload = body;
  if (body && !(body instanceof Uint8Array)) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = type || 'application/json';
  } else if (body) headers['Content-Type'] = type || 'application/octet-stream';
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body: payload }), env, ctx);
  const isJson = (res.headers.get('Content-Type') || '').startsWith('application/json');
  return { status: res.status, headers: res.headers, body: isJson ? await res.json() : new Uint8Array(await res.arrayBuffer()) };
}
const uploadImage = (as, bytes, caption = 'Boo') => call(`/api/oddities/image?caption=${encodeURIComponent(caption)}`, { as, method: 'POST', body: bytes });

test('only signed-in Discord members can upload', async () => {
  assert.equal((await uploadImage(null, png())).status, 401);
  assert.equal((await uploadImage('stranger', png())).status, 403);
  const ok = await uploadImage('fan', png());
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'live');
});

test('a clean picture goes live with metadata stripped and is served safely', async () => {
  const up = await uploadImage('fan', jpeg(), 'Caught the mimic');
  assert.equal(up.body.status, 'live');
  const list = await call('/api/oddities');
  assert.equal(list.body.items.length, 1);
  const item = list.body.items[0];
  assert.equal(item.caption, 'Caught the mimic');
  assert.equal(item.by, 'Fan One');
  assert.equal(item.width, 800);
  assert.ok(!('user_id' in item) && !JSON.stringify(list.body).includes(USERS.fan), 'uploader ID never public');
  const file = await call(item.src);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(file.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(file.headers.get('Content-Security-Policy'), /sandbox/);
  assert.ok(!has(file.body, 'GPS-HOME') && !has(file.body, '<script>'));
});

test('the safety scan blocks, holds or fails closed', async () => {
  aiMode = 'block';
  const blocked = await uploadImage('fan', png());
  assert.equal(blocked.status, 422);
  assert.equal(env.ODDITIES.objects.size, 0, 'blocked files are never stored');

  aiMode = 'review';
  assert.equal((await uploadImage('fan', png())).body.status, 'pending');
  aiMode = 'throw';
  assert.equal((await uploadImage('fan', png())).body.status, 'pending');
  delete env.AI;
  assert.equal((await uploadImage('fan', png())).body.status, 'pending');

  assert.equal((await call('/api/oddities')).body.items.length, 0, 'nothing unscanned is public');
  const asBoss = await call('/api/oddities', { as: 'boss' });
  assert.equal(asBoss.body.queue.length, 3);
  const id = asBoss.body.queue[0].id;
  assert.equal((await call(`/api/oddities/${id}/media`)).status, 404, 'pending files hidden from the public');
  assert.equal((await call(`/api/oddities/${id}/media`, { as: 'fan' })).status, 404);
  assert.equal((await call(`/api/oddities/${id}/media`, { as: 'boss' })).status, 200);
  assert.equal((await call(`/api/oddities/${id}/approve`, { as: 'fan', method: 'POST', body: {} })).status, 403);
  assert.equal((await call(`/api/oddities/${id}/approve`, { as: 'boss', method: 'POST', body: {} })).status, 200);
  assert.equal((await call('/api/oddities')).body.items.length, 1);
});

test('unsafe or unsupported files are refused before scanning', async () => {
  const calls = () => env.AI.calls;
  for (const bytes of [cat('BM', new Uint8Array(60)), enc('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.padEnd(64)), cat('GIF89a', new Uint8Array(40)), mp4()]) {
    const r = await uploadImage('fan', bytes);
    assert.equal(r.status, 415);
  }
  assert.equal((await uploadImage('fan', png({ w: 20000, h: 20000 }))).status, 413);
  assert.equal(calls(), 0);
  assert.equal(env.ODDITIES.objects.size, 0);
});

test('uploads must come from belpire.com and use raw bytes', async () => {
  assert.equal((await call('/api/oddities/image', { as: 'fan', method: 'POST', body: png(), origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('/api/oddities/image', { as: 'fan', method: 'POST', body: png(), type: 'multipart/form-data; boundary=x' })).status, 403);
});

test('members get a daily limit', async () => {
  for (let i = 0; i < DAILY_LIMITS.image; i++) assert.equal((await uploadImage('fan', png())).status, 200);
  assert.equal((await uploadImage('fan', png())).status, 429);
  assert.equal((await uploadImage('fan2', png())).status, 200, 'limits are per member');
});

test('reports from three members pull an oddity back for review', async () => {
  await uploadImage('fan', png());
  const { id } = (await call('/api/oddities')).body.items[0];
  assert.equal((await call(`/api/oddities/${id}/report`, { as: 'fan', method: 'POST', body: {} })).status, 400, 'no self-reports');
  await call(`/api/oddities/${id}/report`, { as: 'fan2', method: 'POST', body: {} });
  await call(`/api/oddities/${id}/report`, { as: 'fan2', method: 'POST', body: {} }); // repeat ignored
  assert.equal((await call('/api/oddities')).body.items.length, 1);
  await call(`/api/oddities/${id}/report`, { as: 'fan3', method: 'POST', body: {} });
  const last = await call(`/api/oddities/${id}/report`, { as: 'fan4', method: 'POST', body: {} });
  assert.equal(REPORTS_TO_HIDE, 3);
  assert.equal(last.body.hidden, true);
  assert.equal((await call('/api/oddities')).body.items.length, 0);
  assert.equal((await call('/api/oddities', { as: 'boss' })).body.queue[0].reports, 3);
});

test('the uploader or a Ringleader can remove, and the file is deleted', async () => {
  await uploadImage('fan', png());
  const { id } = (await call('/api/oddities')).body.items[0];
  assert.equal((await call(`/api/oddities/${id}/remove`, { as: 'fan2', method: 'POST', body: {} })).status, 403);
  assert.equal((await call(`/api/oddities/${id}/remove`, { as: 'fan', method: 'POST', body: {} })).status, 200);
  assert.equal(env.ODDITIES.objects.size, 0);
  assert.equal((await call(`/api/oddities/${id}/media`)).status, 404);
});

test('clips upload in parts, are checked, and always wait for a Ringleader', async () => {
  const size = CLIP_PART_BYTES + 100;
  const start = await call('/api/oddities/clip', { as: 'fan', method: 'POST', body: { size, mime: 'video/mp4', caption: 'Jumpscare' } });
  assert.equal(start.status, 200);
  assert.equal(start.body.parts, 2);
  const id = start.body.id;
  assert.equal((await call(`/api/oddities/clip/${id}/part/1`, { as: 'fan2', method: 'PUT', body: mp4() })).status, 404, 'only the uploader can add parts');
  const p1 = await call(`/api/oddities/clip/${id}/part/1`, { as: 'fan', method: 'PUT', body: mp4(1024) });
  const p2 = await call(`/api/oddities/clip/${id}/part/2`, { as: 'fan', method: 'PUT', body: new Uint8Array(100) });
  assert.equal(p1.status, 200);
  const done = await call(`/api/oddities/clip/${id}/complete`, { as: 'fan', method: 'POST', body: { parts: [p1.body, p2.body] } });
  assert.equal(done.body.status, 'pending');
  assert.equal(env.AI.calls, 0, 'clips are reviewed by people, not the picture scanner');
  assert.equal((await call('/api/oddities')).body.items.length, 0);
  const q = (await call('/api/oddities', { as: 'boss' })).body.queue;
  assert.equal(q[0].kind, 'clip');
  await call(`/api/oddities/${id}/approve`, { as: 'boss', method: 'POST', body: {} });
  const ranged = await call(`/api/oddities/${id}/media`, { headers: { Range: 'bytes=0-15' } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('Content-Type'), 'video/mp4');
  assert.equal(ranged.body.length, 16);
});

test('clips that are too big or are not really video are refused', async () => {
  assert.equal((await call('/api/oddities/clip', { as: 'fan', method: 'POST', body: { size: CLIP_MAX_BYTES + 1, mime: 'video/mp4', caption: 'Huge' } })).status, 413);
  const start = await call('/api/oddities/clip', { as: 'fan', method: 'POST', body: { size: 2000, mime: 'video/mp4', caption: 'Nope' } });
  const bad = await call(`/api/oddities/clip/${start.body.id}/part/1`, { as: 'fan', method: 'PUT', body: png() });
  assert.equal(bad.status, 415);
  assert.equal(env.ODDITIES.uploads.size, 0, 'upload aborted');
  assert.equal((await call(`/api/oddities/clip/${start.body.id}/part/1`, { as: 'fan', method: 'PUT', body: mp4() })).status, 404);
});

test('unfinished clip uploads are cleaned up after a day', async () => {
  await call('/api/oddities/clip', { as: 'fan', method: 'POST', body: { size: 5000, mime: 'video/webm', caption: 'Lost' } });
  assert.equal(env.ODDITIES.uploads.size, 1);
  assert.equal(await purgeStaleUploads(env, Date.now()), 0);
  assert.equal(await purgeStaleUploads(env, Date.now() + 25 * 3600 * 1000), 1);
  assert.equal(env.ODDITIES.uploads.size, 0);
});

test('every upload needs a short title, and galleries filter by kind', async () => {
  assert.equal((await uploadImage('fan', png(), '   ')).status, 400);
  assert.equal((await call('/api/oddities/clip', { as: 'fan', method: 'POST', body: { size: 100, mime: 'video/mp4' } })).status, 400);
  await uploadImage('fan', png(), 'Mimic');
  const start = await call('/api/oddities/clip', { as: 'fan', method: 'POST', body: { size: 64, mime: 'video/mp4', caption: 'Closet' } });
  const p1 = await call(`/api/oddities/clip/${start.body.id}/part/1`, { as: 'fan', method: 'PUT', body: mp4() });
  await call(`/api/oddities/clip/${start.body.id}/complete`, { as: 'fan', method: 'POST', body: { parts: [p1.body] } });
  await call(`/api/oddities/${start.body.id}/approve`, { as: 'boss', method: 'POST', body: {} });
  assert.deepEqual((await call('/api/oddities?kind=image')).body.items.map((i) => i.caption), ['Mimic']);
  assert.deepEqual((await call('/api/oddities?kind=clip')).body.items.map((i) => i.caption), ['Closet']);
  assert.equal((await call('/api/oddities?limit=1')).body.items.length, 1);
});

test('members toggle reactions; counts are public, who reacted is not', async () => {
  await uploadImage('fan', png(), 'React to me');
  const { id } = (await call('/api/oddities')).body.items[0];
  assert.equal((await call(`/api/oddities/${id}/react`, { method: 'POST', body: { reaction: 'laugh' } })).status, 401);
  assert.equal((await call(`/api/oddities/${id}/react`, { as: 'stranger', method: 'POST', body: { reaction: 'laugh' } })).status, 403);
  assert.equal((await call(`/api/oddities/${id}/react`, { as: 'fan2', method: 'POST', body: { reaction: 'kiss' } })).status, 400);
  let r = await call(`/api/oddities/${id}/react`, { as: 'fan2', method: 'POST', body: { reaction: 'laugh' } });
  assert.deepEqual(r.body.reactions, { laugh: 1 });
  await call(`/api/oddities/${id}/react`, { as: 'fan3', method: 'POST', body: { reaction: 'laugh' } });
  await call(`/api/oddities/${id}/react`, { as: 'fan3', method: 'POST', body: { reaction: 'scream' } });
  r = await call(`/api/oddities/${id}/react`, { as: 'fan2', method: 'POST', body: { reaction: 'laugh' } }); // toggle off
  assert.equal(r.body.on, false);
  const pub = (await call('/api/oddities')).body.items[0];
  assert.deepEqual(pub.reactions, { laugh: 1, scream: 1 });
  assert.deepEqual(pub.myReactions, []);
  const mine = (await call('/api/oddities', { as: 'fan3' })).body.items[0];
  assert.deepEqual(mine.myReactions.sort(), ['laugh', 'scream']);
  assert.ok(!JSON.stringify(pub).includes(USERS.fan3));
});

test('Ringleaders\' own pictures and clips go straight up, skipping the scan and the queue', async () => {
  aiMode = 'review';
  const pic = await uploadImage('boss', png(), 'Opening night');
  assert.equal(pic.status, 200);
  assert.equal(pic.body.status, 'live');
  assert.equal(env.AI.calls, 0, 'no scan for Ringleaders');
  assert.equal((await uploadImage('boss', cat([0x42, 0x4d], new Uint8Array(64)))).status, 415, 'file checks still apply');

  const size = CLIP_PART_BYTES + 100;
  const start = await call('/api/oddities/clip', { as: 'boss', method: 'POST', body: { size, mime: 'video/mp4', caption: 'Big top' } });
  const id = start.body.id;
  const p1 = await call(`/api/oddities/clip/${id}/part/1`, { as: 'boss', method: 'PUT', body: mp4(1024) });
  const p2 = await call(`/api/oddities/clip/${id}/part/2`, { as: 'boss', method: 'PUT', body: new Uint8Array(100) });
  const done = await call(`/api/oddities/clip/${id}/complete`, { as: 'boss', method: 'POST', body: { parts: [p1.body, p2.body] } });
  assert.equal(done.body.status, 'live');

  assert.equal((await call('/api/oddities?kind=image')).body.items.length, 1);
  assert.equal((await call('/api/oddities?kind=clip')).body.items.length, 1);
  assert.equal((await call('/api/oddities', { as: 'boss' })).body.queue.length, 0);
  assert.equal((await call(`/api/oddities/${id}/media`)).status, 200);
});

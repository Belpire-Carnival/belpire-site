// Hall of Oddities API: members of the Belpire Discord share screenshots and clips.
//
//   GET  /api/oddities?kind=image|clip&limit=n  public gallery (+ review queue for Ringleaders)
//   POST /api/oddities/image?caption=…          one picture, raw bytes (application/octet-stream)
//   POST /api/oddities/clip                     start a clip upload  { size, mime, caption }
//   PUT  /api/oddities/clip/:id/part/:n         one 25 MB part, raw bytes
//   POST /api/oddities/clip/:id/complete        { parts: [{ partNumber, etag }] }
//   GET  /api/oddities/:id/media                the file (live: anyone; pending: Ringleaders)
//   POST /api/oddities/:id/approve | remove | report
//   POST /api/oddities/:id/react                { reaction: 'like' | 'love' | 'laugh' | 'scream' | 'dead' | 'angry' } (toggle)
//
// Safety: the file's bytes decide its type (PNG/JPEG/WebP, MP4/WebM only; BMP, SVG, GIF and everything
// else refused), size and pixel limits, metadata (GPS etc.) stripped, then pictures are scanned with
// Workers AI. Clean pictures go live; anything unclear and every clip waits for a Ringleader.
// Three member reports pull an oddity back into the queue.

import { readSession } from './auth.js';
import { memberInfo } from './polls.js';
import { oddityStore } from './oddity-db.js';
import { sniff, imageSize, stripMetadata, cleanCaption, moderateImage, IMAGE_MAX_BYTES, CLIP_MAX_BYTES, CLIP_PART_BYTES, MAX_PIXELS } from './oddity-check.js';

export const DAILY_LIMITS = { image: 10, clip: 3 };
export const REPORTS_TO_HIDE = 3;
export const REACTIONS = ['like', 'love', 'laugh', 'scream', 'dead', 'angry'];
const UPLOAD_EXPIRY_HOURS = 24;
const ID = /^[a-f0-9]{24}$/;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' };

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const fail = (status, error, message) => json({ error, message }, status);

const newId = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
const nowIso = () => new Date().toISOString();
const key = (o) => `oddities/${o.id}.${EXT[o.mime] || 'bin'}`;

// Cross-site pages can't send these: they need our Origin and a content type a plain form can't use.
function sameSite(request, type) {
  return request.headers.get('Origin') === new URL(request.url).origin && (request.headers.get('Content-Type') || '').startsWith(type);
}

// Read a request body, refusing anything over `max` bytes without buffering it.
async function readLimited(request, max) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > max) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function publicOddity(o) {
  return {
    id: o.id,
    kind: o.kind,
    caption: o.caption,
    by: o.user_name,
    at: o.created_at,
    width: o.width,
    height: o.height,
    src: `/api/oddities/${o.id}/media`
  };
}

const MIB = 1024 * 1024;

async function upload(env, store, who, session, { request, caption }) {
  if (!caption) return fail(400, 'title', 'Give it a short title first.');
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  if ((await store.countRecent(session.uid, 'image', since)) >= DAILY_LIMITS.image) {
    return fail(429, 'limit', `That's ${DAILY_LIMITS.image} pictures in a day. Come back tomorrow.`);
  }
  const raw = await readLimited(request, IMAGE_MAX_BYTES);
  if (!raw) return fail(413, 'too_big', `Pictures can be up to ${IMAGE_MAX_BYTES / MIB} MB.`);
  const type = sniff(raw);
  if (!type.ok) return fail(415, 'type', type.reason);
  if (type.kind !== 'image') return fail(415, 'type', 'Clips use the clip uploader.');
  const size = imageSize(raw, type.mime);
  if (!size || !size.width || !size.height) return fail(415, 'type', 'That picture looks damaged. Try saving it again.');
  if (size.width * size.height > MAX_PIXELS) return fail(413, 'too_big', 'That picture is too large. Keep it under about 8K resolution.');
  let clean;
  try {
    clean = stripMetadata(raw, type.mime);
  } catch {
    return fail(415, 'type', 'That picture looks damaged. Try saving it again.');
  }

  const scan = await moderateImage(env, clean, type.mime);
  if (scan.verdict === 'block') {
    console.log(`Oddity refused by scan for ${session.uid}: ${scan.reason}`);
    return fail(422, 'unsafe', 'The safety check flagged this picture, so it wasn\'t posted. Nudity, real-world gore, hate symbols and personal details aren\'t allowed. Game and horror gore is fine.');
  }
  const o = {
    id: newId(), kind: 'image', mime: type.mime, size: clean.length, width: size.width, height: size.height,
    caption, user_id: session.uid, user_name: who.name, status: scan.verdict === 'allow' ? 'live' : 'pending',
    scan: `${scan.verdict}: ${scan.reason}`.slice(0, 120), created_at: nowIso()
  };
  await env.ODDITIES.put(key(o), clean, { httpMetadata: { contentType: o.mime } });
  await store.create(o);
  return json({
    ok: true,
    status: o.status,
    message: o.status === 'live' ? 'It\'s up in the Hall of Oddities.' : 'Got it. A Ringleader will take a look before it goes up.',
    oddity: o.status === 'live' ? publicOddity(o) : null
  });
}

async function startClip(env, store, who, session, body) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  if ((await store.countRecent(session.uid, 'clip', since)) >= DAILY_LIMITS.clip) {
    return fail(429, 'limit', `That's ${DAILY_LIMITS.clip} clips in a day. Come back tomorrow.`);
  }
  const size = Number(body?.size);
  if (!Number.isInteger(size) || size <= 0) return fail(400, 'bad_request', 'Missing file size.');
  if (size > CLIP_MAX_BYTES) return fail(413, 'too_big', `Clips can be up to ${CLIP_MAX_BYTES / MIB} MB.`);
  if (!cleanCaption(body?.caption)) return fail(400, 'title', 'Give it a short title first.');
  const mime = body?.mime === 'video/webm' ? 'video/webm' : 'video/mp4';
  const o = {
    id: newId(), kind: 'clip', mime, size, caption: cleanCaption(body?.caption), user_id: session.uid, user_name: who.name,
    status: 'uploading', created_at: nowIso()
  };
  const mpu = await env.ODDITIES.createMultipartUpload(key(o), { httpMetadata: { contentType: mime } });
  o.upload_id = mpu.uploadId;
  await store.create(o);
  return json({ ok: true, id: o.id, partSize: CLIP_PART_BYTES, parts: Math.ceil(size / CLIP_PART_BYTES) });
}

async function clipPart(env, store, session, o, n, request) {
  const parts = Math.ceil(o.size / CLIP_PART_BYTES);
  if (!Number.isInteger(n) || n < 1 || n > parts) return fail(400, 'bad_request', 'Unexpected part.');
  const bytes = await readLimited(request, CLIP_PART_BYTES);
  if (!bytes || !bytes.length) return fail(413, 'too_big', 'Part too large.');
  if (n === 1) {
    const type = sniff(bytes);
    if (!type.ok || type.kind !== 'clip' || type.mime !== o.mime) {
      await abortClip(env, store, o);
      return fail(415, 'type', type.ok ? 'Only MP4 or WebM clips are allowed here.' : type.reason);
    }
  }
  const mpu = env.ODDITIES.resumeMultipartUpload(key(o), o.upload_id);
  const part = await mpu.uploadPart(n, bytes);
  return json({ ok: true, partNumber: part.partNumber, etag: part.etag });
}

async function completeClip(env, store, o, body) {
  const parts = Array.isArray(body?.parts) ? body.parts : [];
  const expected = Math.ceil(o.size / CLIP_PART_BYTES);
  if (parts.length !== expected || parts.some((p, i) => p?.partNumber !== i + 1 || typeof p?.etag !== 'string')) {
    return fail(400, 'bad_request', 'Some parts are missing. Try the upload again.');
  }
  const mpu = env.ODDITIES.resumeMultipartUpload(key(o), o.upload_id);
  await mpu.complete(parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })));
  const head = await env.ODDITIES.head(key(o));
  if (!head || head.size > CLIP_MAX_BYTES) {
    await env.ODDITIES.delete(key(o));
    await store.delete(o.id);
    return fail(413, 'too_big', `Clips can be up to ${CLIP_MAX_BYTES / MIB} MB.`);
  }
  await store.setSize(o.id, head.size);
  await store.setStatus(o.id, 'pending', { from: 'uploading' });
  return json({ ok: true, status: 'pending', message: 'Clip received. A Ringleader will watch it before it goes up.' });
}

async function abortClip(env, store, o) {
  try {
    await env.ODDITIES.resumeMultipartUpload(key(o), o.upload_id).abort();
  } catch {
    // already gone
  }
  await store.delete(o.id);
}

async function media(env, request, o, canSeePending) {
  const visible = o.status === 'live' || (o.status === 'pending' && canSeePending);
  if (!visible) return fail(404, 'not_found', 'Not found.');
  const range = request.headers.get('Range');
  const obj = await env.ODDITIES.get(key(o), range ? { range: request.headers } : undefined);
  if (!obj) return fail(404, 'not_found', 'Not found.');
  const headers = new Headers({
    'Content-Type': o.mime,
    'Content-Disposition': `inline; filename="oddity-${o.id}.${EXT[o.mime]}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Accept-Ranges': 'bytes',
    'Cache-Control': o.status === 'live' ? 'public, max-age=3600' : 'private, no-store'
  });
  if (obj.etag) headers.set('ETag', obj.httpEtag || `"${obj.etag}"`);
  if (range && obj.range) {
    const { offset = 0, length = obj.size - offset } = obj.range;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set('Content-Length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { headers });
}

export async function handleOddities(request, env, ctx) {
  if (!env.DB || !env.ODDITIES) return fail(503, 'unavailable', 'The Hall of Oddities is being set up. Check back soon.');
  const url = new URL(request.url);
  const parts = url.pathname.replace(/\/+$/, '').split('/').slice(3); // after /api/oddities
  const store = oddityStore(env.DB);
  const session = await readSession(request, env);
  const method = request.method;

  try {
    // Public file route first: no Discord lookup needed for live media.
    if (method === 'GET' && parts.length === 2 && parts[1] === 'media' && ID.test(parts[0])) {
      const o = await store.get(parts[0]);
      if (!o) return fail(404, 'not_found', 'Not found.');
      const who = o.status === 'pending' && session ? await memberInfo(env, session) : null;
      return media(env, request, o, Boolean(who?.manager));
    }

    if (method === 'GET' && parts.length === 0) {
      let me = { signedIn: false, member: false, manager: false };
      let who = null;
      if (session) {
        who = await memberInfo(env, session);
        me = { signedIn: true, name: who.name, member: who.member, manager: who.manager };
      }
      const limit = Math.min(48, Math.max(1, Number(url.searchParams.get('limit')) || 48));
      const kind = ['image', 'clip'].includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : null;
      const live = await store.list('live', limit, kind);
      const reacts = await store.reactions(live.map((o) => o.id), who?.member ? session.uid : null);
      const items = live.map((o) => ({
        ...publicOddity(o),
        mine: Boolean(session && o.user_id === session.uid),
        reactions: reacts[o.id].counts,
        myReactions: reacts[o.id].mine
      }));
      const body = { me, items, limits: { imageMB: IMAGE_MAX_BYTES / MIB, clipMB: CLIP_MAX_BYTES / MIB, partMB: CLIP_PART_BYTES / MIB } };
      if (who?.manager) {
        body.queue = (await store.list('pending', 50)).map((o) => ({ ...publicOddity(o), scan: o.scan, reports: o.reports }));
      }
      return json(body);
    }

    // Everything below changes something: same-site requests from signed-in members only.
    if (!session) return fail(401, 'signed_out', 'Verify with Discord first.');
    const who = await memberInfo(env, session);
    if (!who.member) return fail(403, 'not_member', 'Only members of the Belpire Discord can do that.');

    if (method === 'POST' && parts.length === 1 && parts[0] === 'image') {
      if (!sameSite(request, 'application/octet-stream')) return fail(403, 'forbidden', 'Upload from belpire.com.');
      return upload(env, store, who, session, { request, caption: cleanCaption(url.searchParams.get('caption')) });
    }

    if (method === 'POST' && parts.length === 1 && parts[0] === 'clip') {
      if (!sameSite(request, 'application/json')) return fail(403, 'forbidden', 'Upload from belpire.com.');
      return startClip(env, store, who, session, await request.json().catch(() => null));
    }

    if (parts[0] === 'clip' && ID.test(parts[1] || '')) {
      const o = await store.get(parts[1]);
      if (!o || o.status !== 'uploading' || o.user_id !== session.uid) return fail(404, 'not_found', 'That upload has expired. Start again.');
      if (method === 'PUT' && parts.length === 4 && parts[2] === 'part') {
        if (!sameSite(request, 'application/octet-stream')) return fail(403, 'forbidden', 'Upload from belpire.com.');
        return clipPart(env, store, session, o, Number(parts[3]), request);
      }
      if (method === 'POST' && parts.length === 3 && parts[2] === 'complete') {
        if (!sameSite(request, 'application/json')) return fail(403, 'forbidden', 'Upload from belpire.com.');
        return completeClip(env, store, o, await request.json().catch(() => null));
      }
      if (method === 'DELETE' && parts.length === 2) {
        if (request.headers.get('Origin') !== url.origin) return fail(403, 'forbidden', 'Upload from belpire.com.');
        await abortClip(env, store, o);
        return json({ ok: true });
      }
    }

    if (method === 'POST' && parts.length === 2 && ID.test(parts[0]) && parts[1] === 'react') {
      if (!sameSite(request, 'application/json')) return fail(403, 'forbidden', 'Use the buttons on belpire.com.');
      const reaction = (await request.json().catch(() => null))?.reaction;
      if (!REACTIONS.includes(reaction)) return fail(400, 'bad_request', 'Unknown reaction.');
      const o = await store.get(parts[0]);
      if (!o || o.status !== 'live') return fail(404, 'not_found', 'That oddity is gone.');
      const on = await store.toggleReaction(o.id, session.uid, reaction, nowIso());
      const r = (await store.reactions([o.id], session.uid))[o.id];
      return json({ ok: true, on, reactions: r.counts, myReactions: r.mine });
    }

    if (method === 'POST' && parts.length === 2 && ID.test(parts[0]) && ['approve', 'remove', 'report'].includes(parts[1])) {
      if (!sameSite(request, 'application/json')) return fail(403, 'forbidden', 'Use the buttons on belpire.com.');
      const o = await store.get(parts[0]);
      if (!o || o.status === 'removed' || o.status === 'uploading') return fail(404, 'not_found', 'That oddity is gone.');
      const action = parts[1];
      if (action === 'approve') {
        if (!who.manager) return fail(403, 'forbidden', 'Only Ringleaders can approve.');
        await store.setStatus(o.id, 'live', { by: who.name, at: nowIso() });
        return json({ ok: true });
      }
      if (action === 'remove') {
        if (!who.manager && o.user_id !== session.uid) return fail(403, 'forbidden', 'Only Ringleaders or the person who posted it can remove it.');
        await env.ODDITIES.delete(key(o));
        await store.setStatus(o.id, 'removed', { by: who.name, at: nowIso() });
        await store.clearReactions(o.id);
        return json({ ok: true });
      }
      if (o.user_id === session.uid) return fail(400, 'bad_request', 'You can remove your own oddity instead.');
      if (o.status !== 'live') return json({ ok: true, hidden: true });
      const total = await store.report(o.id, session.uid, nowIso());
      let hidden = false;
      if (total !== null && total >= REPORTS_TO_HIDE) hidden = await store.setStatus(o.id, 'pending', { from: 'live' });
      return json({ ok: true, hidden, message: hidden ? 'Thanks. It\'s hidden until a Ringleader reviews it.' : 'Thanks. The Ringleaders have been told.' });
    }

    return fail(404, 'not_found', 'Not found.');
  } catch (err) {
    console.error(`Oddities error: ${err.stack || err.message}`);
    return fail(500, 'error', 'Something went wrong in the Hall of Oddities. Try again in a moment.');
  }
}

// Cron: clip uploads that never finished are cancelled after a day.
export async function purgeStaleUploads(env, now = Date.now()) {
  if (!env.DB || !env.ODDITIES) return 0;
  const store = oddityStore(env.DB);
  const stale = await store.staleUploads(new Date(now - UPLOAD_EXPIRY_HOURS * 3600 * 1000).toISOString());
  for (const o of stale) await abortClip(env, store, o);
  return stale.length;
}

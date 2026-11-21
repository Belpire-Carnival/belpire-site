// Hall of Oddities: pure checks for uploaded files (tested in worker/test/oddities.test.mjs).
//
// The file's own bytes decide what it is; the name and the browser's Content-Type are ignored.
// Only three picture formats and two clip formats are accepted. Everything else (BMP, SVG, GIF,
// HTML, PDF, archives, programs…) is refused before it is stored.

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const CLIP_MAX_BYTES = 500 * 1024 * 1024; // 500 MB
export const CLIP_PART_BYTES = 25 * 1024 * 1024; // clips upload in 25 MB parts
export const MAX_PIXELS = 50_000_000; // ~8K × 6K
export const CAPTION_MAX = 60; // a short title, shown as "Title — uploaded by Name"

const startsWith = (b, sig, at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b, at, len) => String.fromCharCode(...b.subarray(at, at + len));

// → { ok: true, kind: 'image'|'clip', mime } or { ok: false, reason }
export function sniff(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 16) return { ok: false, reason: 'That file is empty or cut short.' };
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ok: true, kind: 'image', mime: 'image/png' };
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { ok: true, kind: 'image', mime: 'image/jpeg' };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { ok: true, kind: 'image', mime: 'image/webp' };
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (/^(isom|iso[2-9]|mp41|mp42|avc1|M4V |dash|mmp4|MSNV)$/.test(brand)) return { ok: true, kind: 'clip', mime: 'video/mp4' };
    if (/^(heic|heix|hevc|mif1|msf1|avif)$/.test(brand)) return { ok: false, reason: 'HEIC/AVIF photos aren\'t supported. Save it as JPEG or PNG.' };
    if (brand === 'qt  ') return { ok: false, reason: 'QuickTime (.mov) clips aren\'t supported. Export it as MP4.' };
    return { ok: false, reason: 'That video format isn\'t supported. Use MP4 or WebM.' };
  }
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) {
    // EBML header; only WebM (not other Matroska files) plays in browsers.
    const head = ascii(b, 0, Math.min(b.length, 64));
    return head.includes('webm') ? { ok: true, kind: 'clip', mime: 'video/webm' } : { ok: false, reason: 'MKV files aren\'t supported. Use MP4 or WebM.' };
  }
  if (ascii(b, 0, 2) === 'BM') return { ok: false, reason: 'Bitmap (.bmp) files aren\'t allowed. Save it as PNG or JPEG.' };
  if (ascii(b, 0, 3) === 'GIF') return { ok: false, reason: 'GIFs aren\'t supported. Upload a PNG, JPEG or WebP, or an MP4 clip.' };
  const text = ascii(b, 0, Math.min(b.length, 256)).replace(/^﻿/, '').trimStart().toLowerCase();
  if (text.startsWith('<')) return { ok: false, reason: 'SVG, HTML and other text files aren\'t allowed.' };
  return { ok: false, reason: 'Only PNG, JPEG or WebP pictures and MP4 or WebM clips are allowed.' };
}

// Width and height from the file header, or null if it can't be read.
export function imageSize(bytes, mime) {
  const b = bytes;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (mime === 'image/png') {
      if (ascii(b, 12, 4) !== 'IHDR') return null;
      return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const marker = b[i + 1];
        if (marker === 0xd9 || marker === 0xda) return null;
        const len = dv.getUint16(i + 2);
        if ((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) };
        }
        i += 2 + len;
      }
      return null;
    }
    if (mime === 'image/webp') {
      const chunk = ascii(b, 12, 4);
      if (chunk === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      if (chunk === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
      if (chunk === 'VP8L') {
        const bits = dv.getUint32(21, true);
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
      }
    }
  } catch {
    return null;
  }
  return null;
}

// Remove metadata (camera, GPS location, comments, embedded thumbnails) without touching the picture.
// Anything after the end of the image (a common way to smuggle another file inside a picture) is dropped too.
export function stripMetadata(bytes, mime) {
  if (mime === 'image/jpeg') return stripJpeg(bytes);
  if (mime === 'image/png') return stripPng(bytes);
  if (mime === 'image/webp') return stripWebp(bytes);
  return bytes;
}

function concat(chunks) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function stripJpeg(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const keep = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new Error('bad jpeg');
    const marker = b[i + 1];
    if (marker === 0xda) {
      // Start of scan: copy through the end-of-image marker, then stop.
      let end = b.length;
      for (let j = b.length - 2; j > i; j--) if (b[j] === 0xff && b[j + 1] === 0xd9) { end = j + 2; break; }
      keep.push(b.subarray(i, end));
      return concat(keep);
    }
    const len = dv.getUint16(i + 2);
    const seg = b.subarray(i, i + 2 + len);
    const isApp = marker >= 0xe1 && marker <= 0xef; // APP1–APP15: EXIF, XMP, ICC profiles, vendor data
    const keepIcc = marker === 0xe2 && ascii(b, i + 4, 11) === 'ICC_PROFILE';
    if ((!isApp || keepIcc) && marker !== 0xfe) keep.push(seg); // 0xFE = comment
    i += 2 + len;
  }
  throw new Error('bad jpeg');
}

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
function stripPng(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const keep = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = dv.getUint32(i);
    const type = ascii(b, i + 4, 4);
    const chunk = b.subarray(i, i + 12 + len);
    if (!PNG_DROP.has(type)) keep.push(chunk);
    i += 12 + len;
    if (type === 'IEND') return concat(keep);
  }
  throw new Error('bad png');
}

function stripWebp(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const riffLen = dv.getUint32(4, true);
  const end = Math.min(b.length, 8 + riffLen);
  const chunks = [];
  let i = 12;
  let vp8x = null;
  while (i + 8 <= end) {
    const type = ascii(b, i, 4);
    const len = dv.getUint32(i + 4, true);
    const total = 8 + len + (len & 1);
    const chunk = b.slice(i, i + total);
    if (type === 'VP8X') vp8x = chunk;
    if (type !== 'EXIF' && type !== 'XMP ') chunks.push(chunk);
    i += total;
  }
  if (vp8x) vp8x[8] &= ~(0x08 | 0x04); // clear the EXIF and XMP flags
  const body = concat(chunks);
  const head = new Uint8Array(12);
  head.set(b.subarray(0, 12));
  new DataView(head.buffer).setUint32(4, 4 + body.length, true);
  return concat([head, body]);
}

// Captions are plain text: no control characters, no markup, single line.
export function cleanCaption(s) {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CAPTION_MAX);
}

// ---------------------------------------------------------------- AI moderation

export const MODERATION_PROMPT = `You review screenshots for a horror and party gaming community's public gallery.
Decide if this image may be shown publicly.

BLOCK if it contains ANY of:
- nudity, sexual activity, sexualised poses, or exposed genitals, breasts or buttocks (drawn, rendered or real)
- anything sexual or suggestive involving someone who looks under 18
- REAL-WORLD gore: photos or video stills of actual injuries, dead bodies, accidents, violence or self-harm
- hate symbols or slurs, extremist imagery
- visible personal information: home addresses, phone numbers, ID documents, bank or card details

ALLOW:
- horror and video-game violence, monsters, blood, gore and jump-scares that are clearly fictional (games, films, art, props, make-up)
- dark, creepy or disturbing imagery that is not real
- ordinary game screenshots, memes, UI, text and people in normal clothing

Answer with exactly one line of JSON and nothing else:
{"verdict":"allow"|"block"|"review","reason":"<at most 12 words>"}
Use "review" only if you genuinely cannot tell (for example, unsure whether gore is real or fictional).`;

// Model output → { verdict, reason }. Anything unclear goes to human review, never straight to public.
export function parseVerdict(raw) {
  const text = typeof raw === 'string' ? raw : raw?.response ?? raw?.result?.response ?? raw?.description ?? '';
  const m = String(text).match(/\{[^{}]*"verdict"[^{}]*\}/);
  if (!m) return { verdict: 'review', reason: 'scanner gave no clear answer' };
  try {
    const v = JSON.parse(m[0]);
    const verdict = ['allow', 'block', 'review'].includes(v.verdict) ? v.verdict : 'review';
    return { verdict, reason: cleanCaption(v.reason || '').slice(0, 100) };
  } catch {
    return { verdict: 'review', reason: 'scanner gave no clear answer' };
  }
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const MODERATION_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';

// Ask Workers AI about one picture. Any failure → 'review' (held for a Ringleader), never 'allow'.
export async function moderateImage(env, bytes, mime) {
  if (!env.AI) return { verdict: 'review', reason: 'automatic scan unavailable' };
  try {
    const out = await env.AI.run(env.MODERATION_MODEL || MODERATION_MODEL, {
      messages: [
        { role: 'system', content: MODERATION_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Review this image.' },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${toBase64(bytes)}` } }
          ]
        }
      ],
      max_tokens: 60,
      temperature: 0
    });
    return parseVerdict(out);
  } catch (err) {
    console.warn(`Oddity scan failed: ${err.message}`);
    return { verdict: 'review', reason: 'automatic scan failed' };
  }
}

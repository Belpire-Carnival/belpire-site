// Repository guards: catch broken merges and unfinished config before Cloudflare tries to deploy them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SKIP = new Set(['.git', 'node_modules', '.wrangler', 'data']);
const TEXT = /\.(m?js|json|jsonc|html|css|md|ya?ml|toml|txt|svg|sh)$|^_headers$|^\.gitignore$|^\.gitattributes$/;

async function* files(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (TEXT.test(e.name)) yield p;
  }
}

test('no merge-conflict markers anywhere', async () => {
  const hits = [];
  for await (const f of files(ROOT)) {
    const text = await readFile(f, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (/^(<{7}|>{7})( |$)/.test(line) || /^={7}$/.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, [], `Conflict markers found:\n${hits.join('\n')}`);
});

// JSONC: drop // and /* */ comments outside strings, then trailing commas.
function parseJsonc(src) {
  let out = '';
  for (let i = 0, inStr = false; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      out += c;
      if (c === '\\') out += src[++i];
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2) + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

test('wrangler.jsonc parses and has no placeholders left', async () => {
  const src = await readFile(join(ROOT, 'wrangler.jsonc'), 'utf8');
  const cfg = parseJsonc(src);
  assert.equal(cfg.name, 'belpire-site');
  assert.ok(cfg.assets?.run_worker_first?.includes('/api/*'));
  assert.doesNotMatch(src, /REPLACE_WITH_/, 'Fill in the real IDs in wrangler.jsonc before merging (see the private runbook).');
  for (const db of cfg.d1_databases || []) assert.match(db.database_id, /^[0-9a-f-]{36}$/, `D1 ${db.binding}: database_id should be a UUID`);
});

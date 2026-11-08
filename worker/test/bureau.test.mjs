import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { bureauRoute } from '../bureau.js';

const route = (u) => bureauRoute(new URL(u));

test('bureau.belpire.com maps onto site/bureau/, keeping shared fonts and icons', () => {
  assert.deepEqual(route('https://bureau.belpire.com/'), { path: '/bureau/' });
  assert.deepEqual(route('https://bureau.belpire.com/bureau.css'), { path: '/bureau/bureau.css' });
  assert.deepEqual(route('https://bureau.belpire.com/fonts/barlow-400.woff2'), { path: '/fonts/barlow-400.woff2' });
  assert.deepEqual(route('https://bureau.belpire.com/favicon.svg'), { path: '/favicon.svg' });
  assert.deepEqual(route('https://bureau.belpire.com/data/feed.json'), { path: '/data/feed.json' }, 'Bureau Patches read the shared game feed');
  assert.equal(route('https://bureau.belpire.com/api/star-citizen'), null, 'the API answers on the subdomain too');
  assert.equal(route('https://bureau.belpire.com/auth/login'), null); // handled by the companion's own sign-in
});

test('belpire.com/bureau/ sends people to the subdomain; other hosts serve it as a folder', () => {
  assert.deepEqual(route('https://belpire.com/bureau/'), { redirect: 'https://bureau.belpire.com/', status: 301 });
  assert.deepEqual(route('https://www.belpire.com/bureau'), { redirect: 'https://bureau.belpire.com/', status: 301 });
  assert.equal(route('https://belpire.com/jackbox/'), null);
  assert.deepEqual(route('https://belpire.com/star-citizen/'), { redirect: 'https://bureau.belpire.com/rsi1/', status: 301 });
  assert.deepEqual(route('https://www.belpire.com/star-citizen'), { redirect: 'https://bureau.belpire.com/rsi1/', status: 301 });
  assert.deepEqual(route('https://preview.belpire-site.example.workers.dev/star-citizen/'), { redirect: '/bureau/rsi1/', status: 301 });
  assert.equal(route('https://belpire.com/bureaucracy/'), null);
  assert.equal(route('https://preview.belpire-site.example.workers.dev/bureau/'), null);
});

test('the Worker serves the subdomain from the static files and tidies their redirects', async () => {
  const seen = [];
  const env = {
    ASSETS: {
      async fetch(req) {
        const { pathname } = new URL(req.url);
        seen.push(pathname);
        if (pathname === '/bureau/') return new Response('bureau page', { status: 200 });
        if (pathname === '/bureau/index.html') return new Response(null, { status: 307, headers: { Location: '/bureau/' } });
        if (pathname === '/') return new Response('carnival home', { status: 200 });
        return new Response('not found', { status: 404 });
      }
    }
  };
  let res = await worker.fetch(new Request('https://bureau.belpire.com/'), env, {});
  assert.equal(await res.text(), 'bureau page');
  res = await worker.fetch(new Request('https://bureau.belpire.com/index.html'), env, {});
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('Location'), 'https://bureau.belpire.com/');
  res = await worker.fetch(new Request('https://bureau.belpire.com/nope'), env, {});
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), 'https://bureau.belpire.com/');
  res = await worker.fetch(new Request('https://belpire.com/bureau/'), env, {});
  assert.equal(res.status, 301);
  res = await worker.fetch(new Request('https://belpire.com/'), env, {});
  assert.equal(await res.text(), 'carnival home', 'the main site is untouched');
});

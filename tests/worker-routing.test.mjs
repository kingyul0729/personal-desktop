import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker/index.js';

// Stand-in for the hosting's static files: the app page plus one image.
const ASSETS = {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/' || path === '/index.html') return new Response('<!doctype html><title>금액 계산 데스크톱</title>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (path === '/icons/pink-notepad.png') return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });
    return new Response('not found', { status: 404 });
  },
};
const brokenDb = { prepare() { throw new Error('no such table'); } };
const safariPage = { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
const appFetch = { Accept: '*/*' };
const get = (path, headers = {}, env = { ASSETS, DB: brokenDb }) => worker.fetch(new Request(`https://site.test${path}`, { headers }), env);

test('the site address and app paths always return the app page', async () => {
  for (const path of ['/', '/index.html', '/desktop', '/settings/wallpaper']) {
    const response = await get(path, safariPage);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(await response.text(), /금액 계산 데스크톱/);
  }
  assert.equal((await get('/icons/pink-notepad.png')).headers.get('content-type'), 'image/png');
  assert.equal((await get('/missing.png')).status, 404, 'a missing file is not replaced by the page');
});

test('opening an API address in Safari goes back to the app instead of showing raw JSON', async () => {
  for (const path of ['/api/desktop', '/api/unknown', '/api/memos']) {
    for (const headers of [safariPage, { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' }]) {
      const response = await get(path, headers);
      assert.equal(response.status, 302, path);
      assert.equal(response.headers.get('location'), '/');
    }
  }
  // A server failure during a page visit also lands on the app, not on an error page.
  const failing = await get('/api/price-files', { ...safariPage, 'oai-authenticated-user-id': 'me', 'oai-authenticated-user-email': 'me@test.invalid' });
  assert.equal(failing.status, 302);
});

test('the app still receives JSON errors, declared as UTF-8 so Korean reads correctly', async () => {
  const missing = await get('/api/unknown', { ...appFetch, 'oai-authenticated-user-id': 'me', 'oai-authenticated-user-email': 'me@test.invalid' });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual(await missing.json(), { error: '요청한 기능을 찾을 수 없습니다.' });
  const failing = await get('/api/price-files', { 'Sec-Fetch-Mode': 'cors', 'oai-authenticated-user-id': 'me', 'oai-authenticated-user-email': 'me@test.invalid' });
  assert.equal(failing.status, 503);
  assert.equal(failing.headers.get('content-type'), 'application/json; charset=utf-8');
  const bytes = new Uint8Array(await failing.arrayBuffer());
  assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(bytes), JSON.stringify({ error: '저장 공간에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' }));
  const signedOut = await get('/api/desktop', appFetch);
  assert.equal(signedOut.status, 200);
  assert.equal((await signedOut.json()).authenticated, false);
});

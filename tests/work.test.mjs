import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleApi, publicDesktop } from '../worker/index.js';

function environment() {
  const sqlite = new DatabaseSync(':memory:');
  const root = new URL('../drizzle/', import.meta.url);
  for (const file of readdirSync(root).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(file, root), 'utf8'));
  const objects = new Map();
  const env = { sqlite, objects, DB: {
    prepare(sql) { const s = sqlite.prepare(sql); return { bind(...v) { return {
      async first() { return s.get(...v) ?? null; }, async all() { return { results: s.all(...v) }; },
      async run() { return { meta: { changes: s.run(...v).changes } }; },
    }; } }; },
    async batch(statements) { sqlite.exec('BEGIN'); try { const result = []; for (const s of statements) result.push(await s.run()); sqlite.exec('COMMIT'); return result; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } },
  }, BUCKET: {
    async put(key, bytes) { objects.set(key, bytes); }, async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; }, async delete(key) { objects.delete(key); },
  } };
  return env;
}
function request(path, { method = 'GET', body, owner = 'owner-one', origin = 'https://site.test' } = {}) {
  const headers = new Headers({ Origin: origin });
  if (owner) { headers.set('oai-authenticated-user-id', owner); headers.set('oai-authenticated-user-email', `${owner}@test.invalid`); }
  if (body && !(body instanceof FormData)) { headers.set('Content-Type', 'application/json'); body = JSON.stringify(body); }
  return new Request(`https://site.test${path}`, { method, headers, body });
}
const call = async (env, path, options) => { const response = await handleApi(request(path, options), env); return { status: response.status, data: await response.json() }; };
const id = '22222222-2222-4222-8222-222222222222';
const path = `/api/work/docs/${id}`;
const png = () => new File([new Uint8Array([137,80,78,71,13,10,26,10])], '상담.png', { type: 'image/png' });
function form(overrides = {}, files = []) {
  const body = new FormData();
  for (const [key, value] of Object.entries({ kind: 'manual', title: '레이저 토닝 준비 순서', summary: '시술 전 준비', content: '## 준비\n- 세안', version: '0', keep: '[]', ...overrides })) body.set(key, String(value));
  for (const file of files) body.append('files', file);
  return body;
}

test('work documents are created, edited, trashed and restored with attachments under their own prefix', async () => {
  const env = environment();
  assert.deepEqual((await call(env, '/api/work', { owner: null })).data, { authenticated: false, docs: [] });
  assert.equal((await call(env, path, { method: 'PUT', body: form(), owner: null })).status, 401);
  assert.equal((await call(env, path, { method: 'PUT', body: form(), origin: 'https://evil.test' })).status, 403);
  assert.equal((await call(env, path, { method: 'PUT', body: form({ kind: 'contract' }) })).status, 400);
  const created = await call(env, path, { method: 'PUT', body: form({}, [png()]) });
  assert.equal(created.status, 201);
  assert.equal(created.data.kind, 'manual');
  assert.equal(created.data.attachments.length, 1);
  assert.ok([...env.objects.keys()].every(key => key.startsWith(`work/owner-one/${id}/`)));
  // Work documents never appear in the personal study archive, and the reverse.
  assert.deepEqual((await call(env, '/api/study')).data.records, []);
  const stale = await call(env, path, { method: 'PUT', body: form({ title: '이전 버전', version: '1' }) });
  assert.equal(stale.status, 409);
  const edited = await call(env, path, { method: 'PUT', body: form({ kind: 'consult', title: '토닝 상담 안내', version: created.data.updatedAt, keep: '[]' }) });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.kind, 'consult');
  assert.equal(edited.data.attachments.length, 0);
  assert.equal(env.objects.size, 0);
  const trashed = await call(env, path, { method: 'PATCH', body: { action: 'trash', version: edited.data.updatedAt } });
  assert.ok(trashed.data.trashedAt);
  const restored = await call(env, path, { method: 'PATCH', body: { action: 'restore', version: trashed.data.updatedAt } });
  assert.equal(restored.data.trashedAt, null);
  const list = await call(env, '/api/work');
  assert.deepEqual(list.data.docs.map(doc => doc.title), ['토닝 상담 안내']);
});

test('another account cannot read, change or adopt a work document', async () => {
  const env = environment();
  const created = await call(env, path, { method: 'PUT', body: form({}, [png()]) });
  const fileUrl = created.data.attachments[0].url;
  assert.equal((await call(env, path, { owner: 'owner-two' })).status, 404);
  assert.deepEqual((await call(env, '/api/work', { owner: 'owner-two' })).data.docs, []);
  assert.equal((await handleApi(request(fileUrl, { owner: 'owner-two' }), env)).status, 404);
  assert.equal((await call(env, path, { method: 'PUT', body: form(), owner: 'owner-two' })).status, 409);
  assert.equal((await call(env, path, { method: 'PATCH', body: { action: 'trash', version: created.data.updatedAt }, owner: 'owner-two' })).status, 404);
  assert.equal((await handleApi(request(fileUrl), env)).status, 200);
});

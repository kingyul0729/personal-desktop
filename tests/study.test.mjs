import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { environment, call, request } from './support/study-env.mjs';
import { handleApi } from '../worker/index.js';
import worker from '../worker/index.js';
import { newStudyId, studyChanged, studyUrl, studyRequest } from '../src/app/study.ts';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const note = (extra = {}) => ({ title: '기초 정리', content: '## 핵심 개념\n\n중요한 설명', folderId: null, revision: 0, ...extra });
const save = (env, body = note(), options = {}) => call(env, `/api/study/notes/${ID}`, { method: 'PUT', body, ...options });
const folder = async (env, name = '피부 기초') => (await call(env, '/api/study/folders', { method: 'POST', body: { name } })).data.id;

test('new notes receive distinct valid ids even when randomUUID is unavailable', t => {
  t.mock.property(Object.getPrototypeOf(globalThis.crypto), 'randomUUID', undefined);
  const first = newStudyId(); const second = newStudyId();
  assert.match(first, /^[A-Za-z0-9-]{8,64}$/); assert.notEqual(first, second);
});

test('study requires authentication and same-origin writes; signed-out lists are empty', async () => {
  const env = environment();
  assert.deepEqual((await call(env, '/api/study', { owner: '' })).data, { authenticated: false, folders: [], notes: [], counts: { total: 0, trash: 0, unfiled: 0 } });
  assert.equal((await save(env, note(), { owner: '' })).status, 401);
  assert.equal((await save(env, note(), { origin: 'https://other.test' })).status, 403);
  assert.equal((await call(env, '/api/study/folders', { method: 'POST', body: { name: 'folder' }, owner: '' })).status, 401);
});

test('notes save, reopen, move between folders and search their full body without copying', async () => {
  const env = environment(); const folderId = await folder(env);
  let result = await save(env, note({ folderId, content: '처음 '.repeat(100) + '정확한 본문 검색어' }));
  assert.equal(result.status, 200); assert.equal(result.data.revision, 1);
  const createdAt = result.data.createdAt;
  assert.equal((await call(env, '/api/study?q=정확한')).data.notes[0].id, ID);
  assert.equal((await call(env, '/api/study?folder=unfiled')).data.notes.length, 0);
  assert.equal((await call(env, `/api/study?folder=${folderId}`)).data.notes.length, 1);
  result = await save(env, note({ revision: 1, title: '정리 수정', content: '수정한 본문' }));
  assert.equal(result.data.createdAt, createdAt); assert.equal(result.data.revision, 2);
  assert.equal((await call(env, '/api/study?folder=unfiled')).data.notes.length, 1);
  assert.equal((await call(env, `/api/study/notes/${ID}`)).data.content, '수정한 본문');
  const state = (await call(env, '/api/study')).data;
  assert.equal(state.notes.length, 1); assert.equal(state.folders[0].count, 0);
  assert.equal('content' in state.notes[0], false);
});

test('other accounts cannot read, update, restore or file notes in another account folders', async () => {
  const env = environment(); const folderId = await folder(env);
  await save(env, note({ folderId }));
  assert.equal((await call(env, '/api/study', { owner: 'other' })).data.notes.length, 0);
  assert.equal((await call(env, `/api/study/notes/${ID}`, { owner: 'other' })).status, 404);
  assert.equal((await save(env, note({ revision: 1 }), { owner: 'other' })).status, 409);
  assert.equal((await save(env, note(), { owner: 'other' })).status, 409);
  assert.equal((await call(env, `/api/study/notes/${OTHER}`, { method: 'PUT', body: note({ folderId }), owner: 'other' })).status, 404);
  assert.equal((await call(env, `/api/study/notes/${ID}`, { method: 'PATCH', body: { action: 'trash', revision: 1 }, owner: 'other' })).status, 409);
  assert.equal((await call(env, `/api/study/folders/${folderId}`, { method: 'PATCH', body: { name: 'stolen' }, owner: 'other' })).status, 404);
  assert.equal((await call(env, `/api/study/notes/${ID}`)).data.title, '기초 정리');
});

test('stale saves cannot overwrite newer notes or revive trashed notes; restore retains content and folder', async () => {
  const env = environment(); const folderId = await folder(env);
  await save(env, note({ folderId }));
  await save(env, note({ revision: 1, folderId, content: '최신 내용' }));
  assert.equal((await save(env, note({ revision: 1, content: '오래된 창' }))).status, 409);
  assert.equal((await call(env, `/api/study/notes/${ID}`, { method: 'PATCH', body: { action: 'trash', revision: 2 } })).status, 200);
  assert.equal((await save(env, note({ revision: 2 }))).status, 409);
  assert.equal((await call(env, '/api/study')).data.notes.length, 0);
  const trashed = (await call(env, '/api/study?trash=1')).data.notes[0];
  assert.equal(trashed.revision, 3); assert.equal(trashed.folderId, folderId);
  assert.equal((await call(env, `/api/study/notes/${ID}`, { method: 'PATCH', body: { action: 'restore', revision: 3 } })).status, 200);
  const restored = (await call(env, `/api/study/notes/${ID}`)).data;
  assert.equal(restored.content, '최신 내용'); assert.equal(restored.folderId, folderId); assert.equal(restored.trashedAt, null);
});

test('folder rename preserves notes; a folder containing active or trashed notes cannot be deleted', async () => {
  const env = environment(); const folderId = await folder(env);
  await save(env, note({ folderId }));
  const remove = () => call(env, `/api/study/folders/${folderId}`, { method: 'DELETE' });
  assert.equal((await remove()).status, 409);
  await call(env, `/api/study/folders/${folderId}`, { method: 'PATCH', body: { name: '새 이름' } });
  assert.equal((await call(env, '/api/study')).data.folders[0].name, '새 이름');
  await call(env, `/api/study/notes/${ID}`, { method: 'PATCH', body: { action: 'trash', revision: 1 } });
  assert.equal((await remove()).status, 409);
  await call(env, `/api/study/notes/${ID}`, { method: 'PATCH', body: { action: 'restore', revision: 2 } });
  await save(env, note({ revision: 3 }));
  assert.equal((await remove()).status, 200);
  assert.equal((await call(env, '/api/study')).data.notes.length, 1);
});

test('invalid bodies, oversized content, missing folders and malformed ids are rejected', async () => {
  const env = environment();
  for (const body of [null, {}, note({ content: '' }), note({ title: ' ' }), note({ title: 'a'.repeat(101) }), note({ revision: -1 }), note({ revision: 1.1 }), note({ folderId: {} })]) assert.equal((await save(env, body)).status, 400);
  assert.equal((await save(env, note({ content: 'a'.repeat(200001) }))).status, 413);
  assert.equal((await save(env, note({ folderId: OTHER }))).status, 404);
  assert.equal((await call(env, '/api/study/notes/%E0%A4%A')).status, 404);
  assert.equal((await call(env, '/api/study/folders', { method: 'POST', body: { name: '' } })).status, 400);
});

test('study uploads validate bytes, retain original images and enforce owner-only access', async () => {
  const env = environment();
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const form = new FormData(); form.set('file', new File([bytes], 'diagram.png', { type: 'image/png' }));
  const uploaded = await call(env, '/api/study/assets', { method: 'POST', body: form });
  assert.equal(uploaded.status, 201);
  const response = await handleApi(request(uploaded.data.src), env);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await call(env, uploaded.data.src, { owner: 'other' })).status, 404);
  const invalid = new FormData(); invalid.set('file', new File(['<svg onload="alert(1)"/>'], 'fake.png', { type: 'image/png' }));
  assert.equal((await call(env, '/api/study/assets', { method: 'POST', body: invalid })).status, 400);
  assert.equal(env.objects.size, 1);
});

test('an image DB failure cleans only the just-uploaded object', async () => {
  const env = environment(); env.objects.set('existing', 'original');
  const form = new FormData(); form.set('file', new File([new Uint8Array([137,80,78,71,13,10,26,10])], 'image.png'));
  const failing = { ...env, DB: { prepare() { throw new Error('temporary DB outage'); } } };
  assert.equal((await worker.fetch(request('/api/study/assets', { method: 'POST', body: form }), failing)).status, 503);
  assert.deepEqual([...env.objects.keys()], ['existing']);
});

test('additive migration and study operations preserve existing memo, price, file and trash data', async () => {
  const env = environment({ migrateStudy: false });
  await call(env, '/api/price-files');
  await call(env, `/api/memos/${ID}`, { method: 'PUT', body: { title: '메모 원본', content: '기존 내용' } });
  const created = await call(env, '/api/desktop', { method: 'POST', body: { action: 'create-file', kind: 'file', name: '기존 파일', parentId: null } });
  await call(env, '/api/desktop', { method: 'POST', body: { action: 'trash-file', id: created.data.created } });
  const tables = env.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
  const snapshot = () => Object.fromEntries(tables.map(table => [table, env.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const before = snapshot();
  const migration = readdirSync(new URL('../drizzle/', import.meta.url)).find(name => name.startsWith('0007') && name.endsWith('.sql'));
  env.sqlite.exec(readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), 'utf8'));
  await save(env); await folder(env);
  await call(env, `/api/study/notes/${ID}`, { method: 'PATCH', body: { action: 'trash', revision: 1 } });
  assert.deepEqual(snapshot(), before);
  // Emptying the original trash never removes the separate study records.
  await call(env, '/api/desktop', { method: 'POST', body: { action: 'empty-trash' } });
  assert.equal((await call(env, '/api/study?trash=1')).data.notes.length, 1);
});

test('network failures report retryable errors and leave supplied draft data unchanged', async t => {
  const draft = note(); const copy = structuredClone(draft);
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('offline'); });
  await assert.rejects(studyRequest('/notes/test', { method: 'PUT', body: JSON.stringify(draft) }), /작성 내용은 유지/);
  assert.deepEqual(draft, copy);
  assert.equal(studyChanged({ ...draft, folderId: 'new-folder' }, draft), true);
  assert.equal(studyChanged(draft, draft), false);
});

test('document URLs block scripts, HTML data URLs and arbitrary local endpoints', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,evil', '//evil.test/image', '/api/memos', '/signin-with-chatgpt']) {
    assert.equal(studyUrl(url, 'src'), ''); assert.equal(studyUrl(url, 'href'), '');
  }
  assert.equal(studyUrl(`/api/study/assets/${ID}`, 'src'), `/api/study/assets/${ID}`);
  assert.equal(studyUrl('https://example.org/info', 'href'), 'https://example.org/info');
});

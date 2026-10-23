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
const id = '11111111-1111-4111-8111-111111111111';
const path = `/api/study/records/${id}`;
const png = () => new File([new Uint8Array([137,80,78,71,13,10,26,10])], '구조.png', { type: 'image/png' });
function form(overrides = {}, files = []) {
  const body = new FormData();
  for (const [key, value] of Object.entries({ title: '피부 구조 정리', category: '피부 기초', studiedOn: '2026-10-22', content: '표피와 진피를 비교해 공부함', tags: '기초, 복습', version: '0', keep: '[]', ...overrides })) body.set(key, String(value));
  for (const file of files) body.append('files', file);
  return body;
}

test('study records and attachments require authentication, ownership and same-origin writes', async () => {
  const env = environment();
  assert.deepEqual((await call(env, '/api/study', { owner: '' })).data, { authenticated: false, records: [] });
  assert.equal((await call(env, path, { owner: '', method: 'PUT', body: form() })).status, 401);
  assert.equal((await call(env, path, { method: 'PUT', body: form(), origin: 'https://other.test' })).status, 403);
  const saved = await call(env, path, { method: 'PUT', body: form({}, [png()]) });
  assert.equal(saved.status, 201);
  assert.equal((await call(env, path, { owner: 'someone-else' })).status, 404);
  assert.equal((await call(env, path, { owner: 'someone-else', method: 'PUT', body: form() })).status, 409);
  assert.deepEqual((await call(env, '/api/study', { owner: 'someone-else' })).data.records, []);
  const file = saved.data.attachments[0];
  assert.equal((await handleApi(request(file.url, { owner: 'someone-else' }), env)).status, 404);
  const download = await handleApi(request(`${file.url}?download=1`), env);
  assert.equal(download.status, 200); assert.equal(download.headers.get('Content-Type'), 'image/png');
  assert.match(download.headers.get('Content-Disposition'), /^attachment;/);
  assert.equal((await download.arrayBuffer()).byteLength, 8);
});

test('saved records survive independent requests, edit in place, search metadata and restore with files', async () => {
  const env = environment();
  let saved = (await call(env, path, { method: 'PUT', body: form({}, [png()]) })).data;
  assert.equal((await call(env, '/api/study')).data.records[0].attachments.length, 1);
  saved = (await call(env, path, { method: 'PUT', body: form({ version: saved.updatedAt, content: '수정된 메모', keep: JSON.stringify(saved.attachments.map(f => f.id)) }) })).data;
  assert.equal(saved.content, '수정된 메모'); assert.equal(saved.attachments.length, 1);
  saved = (await call(env, path, { method: 'PATCH', body: { action: 'favorite', version: saved.updatedAt } })).data;
  assert.equal(saved.favorite, 1);
  saved = (await call(env, path, { method: 'PATCH', body: { action: 'trash', version: saved.updatedAt } })).data;
  assert.ok(saved.trashedAt); assert.equal(env.objects.size, 1);
  assert.equal((await handleApi(request(saved.attachments[0].url), env)).status, 404);
  saved = (await call(env, path, { method: 'PATCH', body: { action: 'restore', version: saved.updatedAt } })).data;
  assert.equal(saved.trashedAt, null); assert.equal(saved.favorite, 1);
  assert.equal((await handleApi(request(saved.attachments[0].url), env)).status, 200);
  saved = (await call(env, path, { method: 'PUT', body: form({ version: saved.updatedAt }) })).data;
  assert.deepEqual(saved.attachments, []); assert.equal(env.objects.size, 0);
});

test('invalid dates, unsafe file bytes, oversize notes and excessive file counts are rejected without writes', async () => {
  const env = environment();
  for (const studiedOn of ['2026-02-30', '', 'bad']) assert.equal((await call(env, path, { method: 'PUT', body: form({ studiedOn }) })).status, 400);
  assert.equal((await call(env, path, { method: 'PUT', body: form({ content: 'x'.repeat(100001) }) })).status, 400);
  assert.equal((await call(env, path, { method: 'PUT', body: form({}, [new File(['<script>x</script>'], 'fake.png', { type: 'image/png' })]) })).status, 400);
  assert.equal((await call(env, path, { method: 'PUT', body: form({}, Array.from({ length: 13 }, png)) })).status, 413);
  assert.equal(env.objects.size, 0); assert.deepEqual((await call(env, '/api/study')).data.records, []);
  assert.equal((await call(env, '/api/study/records/%E0%A4%A')).status, 404);
});

test('PDF attachments are retained and served with private cache and inert headers', async () => {
  const env = environment();
  const result = await call(env, path, { method: 'PUT', body: form({}, [new File(['%PDF-1.7\n%%EOF'], '공부.pdf', { type: 'application/pdf' })]) });
  const response = await handleApi(request(result.data.attachments[0].url), env);
  assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'application/pdf');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
});

test('stale saves cannot overwrite newer changes, including a conflict during an upload', async () => {
  const env = environment();
  const first = (await call(env, path, { method: 'PUT', body: form({}, [png()]) })).data;
  const second = (await call(env, path, { method: 'PATCH', body: { action: 'favorite', version: first.updatedAt } })).data;
  assert.equal((await call(env, path, { method: 'PUT', body: form({ version: first.updatedAt }) })).status, 409);
  const originalPut = env.BUCKET.put;
  env.BUCKET.put = async (key, bytes) => { await originalPut(key, bytes); env.sqlite.prepare('UPDATE study_records SET content = ?, updated_at = updated_at + 1 WHERE id = ?').run('다른 기기에서 저장', id); };
  const raced = await call(env, path, { method: 'PUT', body: form({ version: second.updatedAt }, [png()]) });
  assert.equal(raced.status, 409); assert.equal(env.objects.size, 1);
  const kept = (await call(env, path)).data;
  assert.equal(kept.content, '다른 기기에서 저장'); assert.equal(kept.attachments.length, 1);
});

test('database failure rolls back records and cleans uploaded objects', async () => {
  const env = environment();
  env.DB.batch = async () => { throw new Error('Storage unavailable'); };
  await assert.rejects(call(env, path, { method: 'PUT', body: form({}, [png()]) }), /Storage unavailable/);
  assert.equal(env.objects.size, 0); assert.deepEqual((await call(env, '/api/study')).data.records, []);
});

test('existing program identity is kept for saved desktop layouts with the new study label', () => {
  const program = publicDesktop().items.find(item => item.target === 'program:terminal');
  assert.equal(program.label, '공부 보관함'); assert.equal(publicDesktop().items.length, 7);
});

test('Cornell keywords and summary persist, and older clients cannot erase these fields', async () => {
  const env = environment();
  let record = (await call(env, path, { method: 'PUT', body: form({ keywords: '구조\n기능', summary: '핵심 요약' }, [png()]) })).data;
  assert.equal(record.keywords, '구조\n기능'); assert.equal(record.summary, '핵심 요약');
  record = (await call(env, path, { method: 'PUT', body: form({ version: record.updatedAt, keep: JSON.stringify(record.attachments.map(f => f.id)) }) })).data;
  assert.equal(record.keywords, '구조\n기능'); assert.equal(record.summary, '핵심 요약'); assert.equal(record.attachments.length, 1);
  const listed = (await call(env, '/api/study')).data.records[0];
  assert.equal(listed.summary, '핵심 요약');
  assert.equal((await call(env, path, { method: 'PUT', body: form({ version: record.updatedAt, summary: 'x'.repeat(10001) }) })).status, 400);
});

test('Cornell migration preserves existing notes and attachment rows', () => {
  const db = new DatabaseSync(':memory:');
  const root = new URL('../drizzle/', import.meta.url);
  const files = readdirSync(root).filter(name => name.endsWith('.sql')).sort();
  for (const file of files.filter(name => !name.startsWith('0008_'))) db.exec(readFileSync(new URL(file, root), 'utf8'));
  db.prepare('INSERT INTO study_records (id,owner,title,category,studied_on,content,tags,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id,'owner','기존 제목','분류','2026-10-22','기존 본문','기존 태그',1,1);
  db.prepare('INSERT INTO study_attachments (id,owner,record_id,name,object_key,mime,size,created_at) VALUES (?,?,?,?,?,?,?,?)').run('attachment','owner',id,'기존.png','original-key','image/png',8,1);
  db.exec(readFileSync(new URL(files.find(name => name.startsWith('0008_')), root),'utf8'));
  const row = db.prepare('SELECT * FROM study_records').get();
  assert.equal(row.content,'기존 본문'); assert.equal(row.keywords,''); assert.equal(row.summary,'');
  assert.equal(db.prepare('SELECT object_key FROM study_attachments').get().object_key,'original-key');
});

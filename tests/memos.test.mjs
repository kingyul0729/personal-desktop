import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleApi } from '../worker/index.js';
import { formatMemoTime, memoChanged } from '../src/app/memos.ts';

function environment() {
  const sqlite = new DatabaseSync(':memory:');
  const migrations = new URL('../drizzle/', import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
  const DB = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return { bind(...values) { return {
        async first() { return statement.get(...values) ?? null; },
        async all() { return { results: statement.all(...values) }; },
        async run() { const result = statement.run(...values); return { meta: { changes: result.changes } }; },
      }; } };
    },
    async batch(statements) { sqlite.exec('BEGIN'); try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } },
  };
  return { DB };
}
function request(path, { method = 'GET', body, owner = 'owner-one', origin = 'https://site.test' } = {}) {
  const headers = new Headers({ Origin: origin, 'Content-Type': 'application/json' });
  if (owner) { headers.set('oai-authenticated-user-id', owner); headers.set('oai-authenticated-user-email', `${owner}@test.invalid`); }
  return new Request(`https://site.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}
const call = async (env, path, options) => { const response = await handleApi(request(path, options), env); return { status: response.status, data: await response.json() }; };
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

test('memos need sign-in to store, while signed-out visitors see an empty list', async () => {
  const env = environment();
  assert.deepEqual((await call(env, '/api/memos', { owner: '' })).data, { authenticated: false, memos: [], draft: null });
  assert.equal((await call(env, `/api/memos/${ID_A}`, { method: 'PUT', body: { content: '메모' }, owner: '' })).status, 401);
  assert.equal((await call(env, '/api/memo-draft', { method: 'PUT', body: { memoId: ID_A, content: '메모' }, owner: '' })).status, 401);
  assert.equal((await call(env, `/api/memos/${ID_A}`, { method: 'PUT', body: { content: '메모' }, origin: 'https://elsewhere.test' })).status, 403);
});

test('drafts autosave without appearing in the saved list, and resume on another device', async () => {
  const env = environment();
  assert.equal((await call(env, '/api/memo-draft', { method: 'PUT', body: { memoId: ID_A, title: '', content: '작성 중' } })).status, 200);
  const state = (await call(env, '/api/memos')).data;
  assert.deepEqual(state.memos, []);
  assert.equal(state.draft.memoId, ID_A);
  assert.equal(state.draft.content, '작성 중');
  assert.equal((await call(env, '/api/memos', { owner: 'someone-else' })).data.draft, null);
  assert.equal((await call(env, '/api/memo-draft', { method: 'PUT', body: { memoId: '../x', content: 'a' } })).status, 400);
});

test('saving twice updates one memo, New makes a separate one, newest first', async () => {
  const env = environment();
  let saved = await call(env, `/api/memos/${ID_A}`, { method: 'PUT', body: { title: '  ', content: '첫 메모' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.memo.title, '');
  const firstCreated = saved.data.memo.createdAt;
  await new Promise(resolve => setTimeout(resolve, 5));
  saved = await call(env, `/api/memos/${ID_A}`, { method: 'PUT', body: { title: '회의', content: '첫 메모 수정' } });
  assert.equal(saved.data.memos.length, 1);
  assert.equal(saved.data.memo.createdAt, firstCreated);
  assert.ok(saved.data.memo.savedAt > firstCreated);
  assert.equal(saved.data.draft.content, '첫 메모 수정');
  await new Promise(resolve => setTimeout(resolve, 5));
  saved = await call(env, `/api/memos/${ID_B}`, { method: 'PUT', body: { content: '두 번째\n\n  메모' } });
  assert.deepEqual(saved.data.memos.map(memo => memo.id), [ID_B, ID_A]);
  assert.equal(saved.data.memos[0].preview, '두 번째 메모');
  assert.equal(saved.data.memos[1].title, '회의');
  assert.equal('content' in saved.data.memos[0], false);
  const opened = await call(env, `/api/memos/${ID_A}`);
  assert.equal(opened.data.content, '첫 메모 수정');
  // Re-saving the older memo moves it to the top without copying it.
  await new Promise(resolve => setTimeout(resolve, 5));
  saved = await call(env, `/api/memos/${ID_A}`, { method: 'PUT', body: { title: '회의', content: '다시 수정' } });
  assert.deepEqual(saved.data.memos.map(memo => memo.id), [ID_A, ID_B]);
});

test('memos stay private to their owner and reject empty or oversized text', async () => {
  const env = environment();
  await call(env, `/api/memos/${ID_A}`, { method: 'PUT', body: { content: '내 메모' } });
  assert.equal((await call(env, `/api/memos/${ID_A}`, { owner: 'someone-else' })).status, 404);
  assert.equal((await call(env, `/api/memos/${ID_A}`, { method: 'PUT', body: { content: '덮어쓰기' }, owner: 'someone-else' })).status, 404);
  assert.equal((await call(env, `/api/memos/${ID_A}`)).data.content, '내 메모');
  assert.equal((await call(env, '/api/memos', { owner: 'someone-else' })).data.draft, null);
  assert.equal((await call(env, `/api/memos/${ID_B}`, { method: 'PUT', body: { content: '   ' } })).status, 400);
  assert.equal((await call(env, `/api/memos/${ID_B}`, { method: 'PUT', body: { content: 'a'.repeat(100001) } })).status, 413);
  assert.equal((await call(env, '/api/memos/%E0%A4%A')).status, 404);
});

test('memo times read as year.month.day hour:minute and changes compare against the saved copy', () => {
  assert.equal(formatMemoTime(new Date(2026, 9, 2, 22, 41).getTime()), '2026.10.02 22:41');
  assert.equal(memoChanged('', '', null), false);
  assert.equal(memoChanged('', '글', null), true);
  assert.equal(memoChanged(' 제목 ', '글', { title: '제목', content: '글' }), false);
  assert.equal(memoChanged('제목', '글 수정', { title: '제목', content: '글' }), true);
});

test('deleting a memo removes it and its draft for the owner only', async () => {
  const env = environment();
  await call(env, `/api/memos/${ID_A}`, { method: 'PUT', body: { content: '지울 메모' } });
  await call(env, `/api/memos/${ID_B}`, { method: 'PUT', body: { content: '남길 메모' } });
  await call(env, '/api/memo-draft', { method: 'PUT', body: { memoId: ID_A, content: '지울 메모 수정 중' } });
  assert.equal((await call(env, `/api/memos/${ID_A}`, { method: 'DELETE', owner: 'someone-else' })).status, 404);
  assert.equal((await call(env, `/api/memos/${ID_A}`, { method: 'DELETE', origin: 'https://elsewhere.test' })).status, 403);
  const deleted = await call(env, `/api/memos/${ID_A}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.data.memos.map(memo => memo.id), [ID_B]);
  assert.equal(deleted.data.draft, null);
  assert.equal((await call(env, `/api/memos/${ID_A}`)).status, 404);
  assert.equal((await call(env, `/api/memos/${ID_A}`, { method: 'DELETE' })).status, 404);
  // A draft for another memo survives deleting a different one.
  await call(env, '/api/memo-draft', { method: 'PUT', body: { memoId: ID_B, content: '남길 메모 수정 중' } });
  await call(env, `/api/memos/${ID_A}`, { method: 'PUT', body: { content: '다시 만든 메모' } });
  await call(env, '/api/memo-draft', { method: 'PUT', body: { memoId: ID_B, content: '남길 메모 수정 중' } });
  assert.equal((await call(env, `/api/memos/${ID_A}`, { method: 'DELETE' })).data.draft.memoId, ID_B);
});

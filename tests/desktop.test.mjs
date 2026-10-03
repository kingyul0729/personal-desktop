import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleApi } from '../worker/index.js';

const migrationFiles = readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort();
function environment(migrations = migrationFiles) {
  const sqlite = new DatabaseSync(':memory:');
  const apply = files => { for (const file of files) sqlite.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8')); };
  apply(migrations);
  const objects = new Map();
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
  return { sqlite, apply, objects, DB, BUCKET: { async put(key, value) { objects.set(key, value); }, async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; }, async delete(key) { objects.delete(key); } } };
}
function request(path, { method = 'GET', body, owner = 'me', tokens = [] } = {}) {
  const headers = new Headers({ Origin: 'https://site.test' });
  if (owner) { headers.set('oai-authenticated-user-id', owner); headers.set('oai-authenticated-user-email', `${owner}@test.invalid`); }
  if (tokens.length) headers.set('X-Unlock-Tokens', tokens.join(','));
  if (body && !(body instanceof FormData)) headers.set('Content-Type', 'application/json');
  return new Request(`https://site.test${path}`, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
}
const call = async (env, path, options) => { const response = await handleApi(request(path, options), env); return { status: response.status, data: response.headers.get('content-type')?.includes('json') ? await response.json() : response } };
const act = (env, body, options = {}) => call(env, '/api/desktop', { method: 'POST', body, ...options });
const png = () => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2])], 'a.png', { type: 'image/png' });
const upload = async (env, kind) => { const form = new FormData(); form.set('file', png()); form.set('kind', kind); return call(env, '/api/desktop-assets', { method: 'POST', body: form }); };
const program = (state, id) => state.items.find(item => item.target === `program:${id}`);

test('signed-out visitors see the default desktop and cannot change it', async () => {
  const env = environment();
  const state = (await call(env, '/api/desktop', { owner: '' })).data;
  assert.equal(state.authenticated, false);
  assert.deepEqual(state.items.map(item => item.label), ['Terminal', '가격표 보관함', '환경설정', '작업 캡슐', '메모장', '금액 계산', '휴지통']);
  assert.equal((await act(env, { action: 'set-fit', fit: 'contain' }, { owner: '' })).status, 401);
});

test('wallpaper upload, choice and fit persist on the server for every device', async () => {
  const env = environment();
  const uploaded = await upload(env, 'wallpaper');
  assert.equal(uploaded.status, 201);
  const assetId = uploaded.data.asset.id;
  await act(env, { action: 'set-wallpaper', assetId });
  await act(env, { action: 'set-fit', fit: 'contain' });
  const reloaded = (await call(env, '/api/desktop')).data;
  assert.deepEqual(reloaded.settings, { wallpaper: { assetId, src: `/api/desktop-assets/${assetId}` }, fit: 'contain', font: null });
  assert.equal((await call(env, reloaded.settings.wallpaper.src)).status, 200);
  assert.equal((await call(env, reloaded.settings.wallpaper.src, { owner: 'someone-else' })).status, 404);
  assert.equal((await call(env, '/api/desktop', { owner: 'someone-else' })).data.settings.wallpaper, null);
  await act(env, { action: 'set-wallpaper', assetId: null });
  assert.deepEqual((await call(env, '/api/desktop')).data.settings, { wallpaper: null, fit: 'contain', font: null });
  assert.equal((await act(env, { action: 'set-wallpaper', assetId: 'aaaaaaaa-unknown' })).status, 404);
});

test('desktop labels, icons, visibility and order change without changing what an item opens', async () => {
  const env = environment();
  let state = (await call(env, '/api/desktop')).data;
  const memo = program(state, 'notepad');
  const icon = (await upload(env, 'icon')).data.asset.id;
  state = (await act(env, { action: 'update-item', id: memo.id, label: '업무 메모', icon: `asset:${icon}` })).data;
  assert.equal(program(state, 'notepad').label, '업무 메모');
  assert.equal(program(state, 'notepad').icon, `asset:${icon}`);
  assert.equal(program(state, 'notepad').target, 'program:notepad');
  state = (await act(env, { action: 'update-item', id: memo.id, icon: 'folder:cherry' })).data;
  assert.equal(program(state, 'notepad').icon, 'folder:cherry');
  state = (await act(env, { action: 'update-item', id: memo.id, icon: 'builtin:coral-notepad' })).data;
  assert.equal(program(state, 'notepad').icon, 'builtin:coral-notepad');
  assert.equal((await call(env, '/api/desktop')).data.items.find(item => item.target === 'program:notepad').icon, 'builtin:coral-notepad', 'kept after reload');
  assert.equal(program(state, 'notepad').target, 'program:notepad');
  assert.equal((await act(env, { action: 'update-item', id: memo.id, icon: 'builtin:../x' })).status, 400);
  state = (await act(env, { action: 'update-item', id: memo.id, icon: 'folder:cherry' })).data;
  assert.equal(program(state, 'notepad').label, '업무 메모');
  state = (await act(env, { action: 'update-item', id: memo.id, hidden: true })).data;
  assert.equal(program(state, 'notepad').hidden, true);
  state = (await act(env, { action: 'update-item', id: memo.id, hidden: false, label: '' })).data;
  assert.equal(program(state, 'notepad').label, '메모장');
  assert.equal((await act(env, { action: 'update-item', id: memo.id, icon: 'javascript:alert(1)' })).status, 400);
  const before = state.items.map(item => item.target);
  state = (await act(env, { action: 'move-item', id: memo.id, direction: -1 })).data;
  const after = state.items.map(item => item.target);
  assert.equal(after.indexOf('program:notepad'), before.indexOf('program:notepad') - 1);
  assert.equal((await act(env, { action: 'remove-shortcut', id: memo.id })).status, 400);
  assert.equal((await call(env, '/api/desktop')).data.items.filter(item => item.kind === 'program').length, 7);
});

test('new shortcuts link to a program or file; removing one never touches the target', async () => {
  const env = environment();
  let state = (await act(env, { action: 'create-file', kind: 'folder', name: '자료' })).data;
  const folder = state.created;
  state = (await act(env, { action: 'add-shortcut', label: '자료 바로가기', icon: 'folder:flower', target: `file:${folder}`, hidden: false })).data;
  const shortcut = state.items.find(item => item.kind === 'shortcut');
  assert.equal(shortcut.target, `file:${folder}`);
  state = (await act(env, { action: 'add-shortcut', label: '계산', target: 'program:priceCalculator', hidden: true })).data;
  assert.equal(state.items.find(item => item.label === '계산').hidden, true);
  assert.equal((await act(env, { action: 'add-shortcut', label: '없음', target: 'program:nothing' })).status, 400);
  state = (await act(env, { action: 'remove-shortcut', id: shortcut.id })).data;
  assert.ok(!state.items.some(item => item.id === shortcut.id));
  assert.ok(state.files.some(file => file.id === folder));
});

test('renaming a file keeps its id, content and desktop link; display labels stay separate', async () => {
  const env = environment();
  const id = (await act(env, { action: 'create-file', kind: 'file', name: '새 파일' })).data.created;
  await act(env, { action: 'save-file', id, content: '본문' });
  let state = (await act(env, { action: 'rename-file', id, name: '회의록' })).data;
  assert.equal(state.files.find(file => file.id === id).name, '회의록');
  assert.equal(state.items.find(item => item.target === `file:${id}`).label, '회의록');
  assert.equal((await call(env, `/api/files/${id}`)).data.content, '본문');
  const desktopFile = state.items.find(item => item.target === `file:${id}`);
  assert.equal((await act(env, { action: 'update-item', id: desktopFile.id, label: '다른 이름' })).status, 400);
  state = (await act(env, { action: 'update-item', id: desktopFile.id, hidden: true })).data;
  assert.equal(state.items.find(item => item.id === desktopFile.id).hidden, true);
  assert.equal((await call(env, `/api/files/${id}`)).data.content, '본문');
  assert.equal((await call(env, `/api/files/${id}`, { owner: 'someone-else' })).status, 404);
});

test('folders hold files, moves keep data, and a folder cannot move into itself', async () => {
  const env = environment();
  const folder = (await act(env, { action: 'create-file', kind: 'folder', name: '폴더' })).data.created;
  const inner = (await act(env, { action: 'create-file', kind: 'file', name: '안쪽', parentId: folder })).data.created;
  let state = (await call(env, '/api/desktop')).data;
  assert.ok(!state.items.some(item => item.target === `file:${inner}`));
  assert.equal(state.files.find(file => file.id === inner).parentId, folder);
  state = (await act(env, { action: 'move-file', id: inner, parentId: null })).data;
  assert.ok(state.items.some(item => item.target === `file:${inner}`));
  assert.equal((await act(env, { action: 'move-file', id: folder, parentId: folder })).status, 400);
});

test('locked files and folders are refused by the server until the right password unlocks them', async () => {
  const env = environment();
  const folder = (await act(env, { action: 'create-file', kind: 'folder', name: '비밀 폴더' })).data.created;
  const inner = (await act(env, { action: 'create-file', kind: 'file', name: '안쪽 문서', parentId: folder })).data.created;
  await act(env, { action: 'save-file', id: inner, content: '비밀 내용' });
  assert.equal((await act(env, { action: 'lock-set', id: folder, password: '12' })).status, 400);
  await act(env, { action: 'lock-set', id: folder, password: 'pink1234' });
  const hidden = (await call(env, '/api/desktop')).data;
  assert.equal(hidden.files.find(file => file.id === folder).locked, true);
  assert.ok(!hidden.files.some(file => file.id === inner));
  const blocked = await call(env, `/api/files/${inner}`);
  assert.equal(blocked.status, 423);
  assert.equal(blocked.data.lockedId, folder);
  assert.ok(!JSON.stringify(blocked.data).includes('비밀 내용'));
  for (const action of [{ action: 'rename-file', id: inner, name: 'x' }, { action: 'save-file', id: inner, content: 'x' }, { action: 'trash-file', id: folder }])
    assert.equal((await act(env, action)).status, 423);
  assert.equal((await act(env, { action: 'unlock', id: folder, password: 'wrong' })).status, 403);
  const opened = await act(env, { action: 'unlock', id: folder, password: 'pink1234' });
  assert.equal(opened.status, 200);
  const tokens = [opened.data.token];
  assert.ok(opened.data.files.some(file => file.id === inner));
  assert.equal((await call(env, `/api/files/${inner}`, { tokens })).data.content, '비밀 내용');
  assert.equal((await call(env, `/api/files/${inner}`, { tokens: ['forged'] })).status, 423);
  assert.equal((await call(env, `/api/files/${inner}`, { tokens, owner: 'someone-else' })).status, 404);
  const row = env.sqlite.prepare('SELECT lock_hash, lock_salt FROM user_files WHERE id = ?').get(folder);
  assert.ok(row.lock_hash && !row.lock_hash.includes('pink1234') && row.lock_salt);
  assert.ok(!JSON.stringify(env.sqlite.prepare('SELECT * FROM file_unlocks').all()).includes(tokens[0]));
  assert.equal((await act(env, { action: 'lock-change', id: folder, current: 'wrong', next: 'newpass' })).status, 403);
  await act(env, { action: 'lock-change', id: folder, current: 'pink1234', next: 'newpass' });
  assert.equal((await call(env, `/api/files/${inner}`, { tokens })).status, 423, 'changing the password ends earlier access');
  await act(env, { action: 'lock-remove', id: folder, password: 'newpass' });
  assert.equal((await call(env, `/api/files/${inner}`)).data.content, '비밀 내용');
});

test('repeated wrong passwords pause further attempts', async () => {
  const env = environment();
  const id = (await act(env, { action: 'create-file', kind: 'file', name: '잠금' })).data.created;
  await act(env, { action: 'lock-set', id, password: 'right-one' });
  for (let i = 0; i < 5; i++) assert.equal((await act(env, { action: 'unlock', id, password: `bad${i}` })).status, 403);
  assert.equal((await act(env, { action: 'unlock', id, password: 'right-one' })).status, 429);
});

test('trash keeps data until purge; restore returns to the original folder or the desktop', async () => {
  const env = environment();
  const folder = (await act(env, { action: 'create-file', kind: 'folder', name: '보관' })).data.created;
  const inner = (await act(env, { action: 'create-file', kind: 'file', name: '문서', parentId: folder })).data.created;
  await act(env, { action: 'save-file', id: inner, content: '남아 있어야 함' });
  let state = (await act(env, { action: 'trash-file', id: inner })).data;
  assert.ok(!state.files.some(file => file.id === inner));
  assert.equal(state.trash[0].id, inner);
  assert.equal(state.trash[0].location, '보관');
  assert.ok(state.trash[0].trashedAt > 0);
  assert.equal(env.sqlite.prepare('SELECT content FROM user_files WHERE id = ?').get(inner).content, '남아 있어야 함');
  state = (await act(env, { action: 'restore-file', id: inner })).data;
  assert.equal(state.restoredTo, folder);
  assert.equal(state.files.find(file => file.id === inner).parentId, folder);
  await act(env, { action: 'trash-file', id: inner });
  await act(env, { action: 'trash-file', id: folder });
  state = (await act(env, { action: 'restore-file', id: inner })).data;
  assert.equal(state.restoredTo, null, 'the folder is in the trash, so the file returns to the desktop');
  assert.ok(state.items.some(item => item.target === `file:${inner}`));
  state = (await act(env, { action: 'purge-file', id: folder })).data;
  assert.equal(state.trash.length, 0);
  assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM user_files WHERE id = ?').get(folder).n, 0);
  assert.equal((await act(env, { action: 'purge-file', id: inner })).status, 404, 'only trashed items can be purged');
  await act(env, { action: 'trash-file', id: inner });
  const locked = (await act(env, { action: 'create-file', kind: 'file', name: '잠금' })).data.created;
  await act(env, { action: 'lock-set', id: locked, password: 'pink1234' });
  const token = (await act(env, { action: 'unlock', id: locked, password: 'pink1234' })).data.token;
  await act(env, { action: 'trash-file', id: locked }, { tokens: [token] });
  state = (await act(env, { action: 'empty-trash' })).data;
  assert.equal(state.skipped, 1);
  assert.deepEqual(state.trash.map(item => item.id), [locked]);
  assert.equal((await act(env, { action: 'purge-file', id: locked })).status, 423);
  state = (await act(env, { action: 'purge-file', id: locked }, { tokens: [token] })).data;
  assert.equal(state.trash.length, 0);
  assert.ok(!state.items.some(item => item.target === `file:${inner}`));
});

test('adding the desktop tables keeps price lists, memos and drafts exactly as they were', async () => {
  // 0006 adds a column to a 0003 table, so it is applied together with 0003.
  const desktop = name => name.startsWith('0003') || name.startsWith('0006');
  const before = migrationFiles.filter(name => !desktop(name));
  const env = environment(before);
  for (const owner of ['me', 'other']) await call(env, '/api/price-files', { owner });
  await call(env, '/api/price-files', { method: 'POST', body: { action: 'create-folder', name: '내 폴더', variant: 'flower' } });
  const memo = '44444444-4444-4444-8444-444444444444';
  await call(env, `/api/memos/${memo}`, { method: 'PUT', body: { title: '메모', content: '기존 메모' } });
  await call(env, '/api/memo-draft', { method: 'PUT', body: { memoId: memo, title: '', content: '작성 중' } });
  const snapshot = () => JSON.stringify(['price_folders', 'price_images', 'memos', 'memo_drafts'].map(table => env.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
  const saved = snapshot();
  env.apply(migrationFiles.filter(desktop));
  assert.equal(snapshot(), saved);
  await act(env, { action: 'create-file', kind: 'file', name: '새 파일' });
  assert.equal(snapshot(), saved);
  assert.equal((await call(env, '/api/memos')).data.memos[0].preview, '기존 메모');
  assert.ok((await call(env, '/api/price-files')).data.folders.some(folder => folder.name === '내 폴더'));
});

const layout = (windows, active = windows.at(-1)?.id, view = {}) => ({ windows, active, view });
const win = (id, x = 10, y = 20, width = 600, height = 400, extra = {}) => ({ id, x, y, width, height, minimized: false, maximized: false, ...extra });

test('work capsules save only window layouts, survive reload, and rename or delete one at a time', async () => {
  const env = environment();
  const capsules = (owner) => call(env, '/api/capsules', { owner });
  const save = (body, owner) => call(env, '/api/capsules', { method: 'POST', body, owner });
  assert.deepEqual((await capsules('')).data, { authenticated: false, capsules: [] });
  assert.equal((await save({ action: 'create', name: 'x', layout: layout([win('notepad')]) }, '')).status, 401);
  const memo = '55555555-5555-4555-8555-555555555555';
  await call(env, `/api/memos/${memo}`, { method: 'PUT', body: { title: '', content: '10월 1일 메모' } });
  let state = (await save({ action: 'create', name: '상담 준비', layout: layout([win('notepad'), win('fileExplorer', 240, 24, 920, 760, { minimized: true }), win('priceCalculator', 250, 52, 980, 680, { maximized: true })], 'priceCalculator', { settingsTab: 'files' }) })).data;
  assert.equal(state.capsules.length, 1);
  const saved = state.capsules[0];
  assert.deepEqual(saved.layout.windows.map(w => w.id), ['notepad', 'fileExplorer', 'priceCalculator']);
  assert.equal(saved.layout.windows[1].minimized, true);
  assert.equal(saved.layout.windows[2].maximized, true);
  assert.equal(saved.layout.active, 'priceCalculator');
  assert.deepEqual(saved.layout.view, { settingsTab: 'files' });
  assert.ok(!JSON.stringify(env.sqlite.prepare('SELECT layout FROM work_capsules').all()).includes('10월 1일 메모'), 'no app data is copied');
  await save({ action: 'create', name: '10월 2일 마감 정리', layout: layout([win('fileExplorer'), win('notepad')]) });
  // Later edits stay: a capsule never brings back old memo content.
  await call(env, `/api/memos/${memo}`, { method: 'PUT', body: { title: '', content: '10월 3일 최신 메모' } });
  state = (await capsules()).data;
  assert.deepEqual(state.capsules.map(c => c.name), ['10월 2일 마감 정리', '상담 준비'], 'kept after reload, newest first');
  assert.equal((await call(env, `/api/memos/${memo}`)).data.content, '10월 3일 최신 메모');
  assert.equal((await capsules('someone-else')).data.capsules.length, 0);
  state = (await save({ action: 'rename', id: saved.id, name: '상담 준비 2' })).data;
  assert.equal(state.capsules.find(c => c.id === saved.id).name, '상담 준비 2');
  assert.equal((await save({ action: 'rename', id: saved.id, name: '탈취' }, 'someone-else')).status, 404);
  const memosBefore = JSON.stringify(env.sqlite.prepare('SELECT * FROM memos').all());
  state = (await save({ action: 'delete', id: saved.id })).data;
  assert.deepEqual(state.capsules.map(c => c.name), ['10월 2일 마감 정리']);
  assert.equal(JSON.stringify(env.sqlite.prepare('SELECT * FROM memos').all()), memosBefore);
});

test('capsule layouts are cleaned: unknown windows, the capsule window and bad numbers are dropped', async () => {
  const env = environment();
  const save = body => call(env, '/api/capsules', { method: 'POST', body });
  assert.equal((await save({ action: 'create', name: '빈 작업', layout: layout([]) })).status, 400);
  assert.equal((await save({ action: 'create', name: '', layout: layout([win('notepad')]) })).status, 400);
  const state = (await save({ action: 'create', name: '정리', layout: layout([win('notepad'), win('notepad'), win('programManager'), win('hacker'), win('trash', 'x'), { ...win('files'), extra: 'ignored' }], 'hacker', { settingsTab: 'evil', filesViewing: '../x' }) })).data;
  const cleaned = state.capsules[0].layout;
  assert.deepEqual(cleaned.windows.map(w => w.id), ['notepad', 'files']);
  assert.equal(cleaned.active, null);
  assert.deepEqual(cleaned.view, {});
  assert.ok(!('extra' in cleaned.windows[1]));
});

test('memos, price images and work capsules go to the trash first; restore brings them back, purge and emptying delete for good', async () => {
  const env = environment();
  const memo = '66666666-6666-4666-8666-666666666666';
  await call(env, `/api/memos/${memo}`, { method: 'PUT', body: { title: '', content: '휴지통에 갈 메모 내용' } });
  await call(env, '/api/memo-draft', { method: 'PUT', body: { memoId: memo, title: '', content: '작성 중' } });
  await call(env, '/api/price-files');
  const form = new FormData();
  form.set('file', png()); form.set('name', '내 가격표'); form.set('folderId', 'me:toning');
  const price = (await call(env, '/api/price-images', { method: 'POST', body: form })).data.images.find(image => image.name === '내 가격표');
  const capsule = (await call(env, '/api/capsules', { method: 'POST', body: { action: 'create', name: '상담 준비', layout: layout([win('notepad')]) } })).data.capsules[0];
  const counts = () => ['memos', 'price_images', 'work_capsules'].map(table => env.sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE owner = 'me'`).get().n);
  const before = counts();

  assert.equal((await call(env, `/api/memos/${memo}`, { method: 'DELETE' })).data.memos.length, 0);
  assert.ok(!(await call(env, '/api/price-files', { method: 'POST', body: { action: 'delete-image', id: price.id } })).data.images.some(image => image.id === price.id));
  assert.equal((await call(env, '/api/capsules', { method: 'POST', body: { action: 'delete', id: capsule.id } })).data.capsules.length, 0);
  assert.deepEqual(counts(), before, 'moving to the trash deletes nothing');
  assert.equal(env.objects.size, 1, 'the stored image stays while in the trash');
  assert.equal((await call(env, `/api/memos/${memo}`)).status, 404);
  assert.equal((await call(env, '/api/memos')).data.draft, null, 'the draft does not reopen the trashed memo');

  let state = (await call(env, '/api/desktop')).data;
  assert.deepEqual(state.trash.map(item => [item.type, item.name, item.location]).sort(), [
    ['capsule', '상담 준비', '작업 캡슐'], ['memo', '휴지통에 갈 메모 내용', '메모장'], ['price', '내 가격표', '가격표 보관함 › 색소·토닝']]);
  assert.equal((await call(env, '/api/desktop', { owner: 'someone-else' })).data.trash.length, 0);
  assert.equal((await act(env, { action: 'purge-file', type: 'memo', id: memo }, { owner: 'someone-else' })).status, 404);

  state = (await act(env, { action: 'restore-file', type: 'memo', id: memo })).data;
  assert.equal((await call(env, `/api/memos/${memo}`)).data.content, '휴지통에 갈 메모 내용');
  await act(env, { action: 'restore-file', type: 'price', id: price.id });
  assert.ok((await call(env, '/api/price-files')).data.images.some(image => image.id === price.id && image.folderId === 'me:toning'));
  await act(env, { action: 'restore-file', type: 'capsule', id: capsule.id });
  assert.deepEqual((await call(env, '/api/capsules')).data.capsules[0].layout, capsule.layout);
  assert.equal((await call(env, '/api/desktop')).data.trash.length, 0);
  assert.equal((await act(env, { action: 'restore-file', type: 'memo', id: memo })).status, 404, 'only trashed items can be restored');
  assert.equal((await act(env, { action: 'purge-file', type: 'memo', id: memo })).status, 404, 'only trashed items can be purged');

  // Saving a memo another device trashed keeps the text instead of losing it.
  await call(env, `/api/memos/${memo}`, { method: 'DELETE' });
  await call(env, `/api/memos/${memo}`, { method: 'PUT', body: { title: '', content: '다른 기기에서 저장' } });
  assert.equal((await call(env, '/api/memos')).data.memos.length, 1);

  await call(env, `/api/memos/${memo}`, { method: 'DELETE' });
  await act(env, { action: 'purge-file', type: 'memo', id: memo });
  assert.equal(counts()[0], before[0] - 1);
  await call(env, '/api/price-files', { method: 'POST', body: { action: 'delete-image', id: price.id } });
  await call(env, '/api/capsules', { method: 'POST', body: { action: 'delete', id: capsule.id } });
  const file = (await act(env, { action: 'create-file', kind: 'file', name: '문서' })).data.created;
  await act(env, { action: 'trash-file', id: file });
  state = (await act(env, { action: 'empty-trash' })).data;
  assert.equal(state.trash.length, 0);
  assert.deepEqual(counts(), [before[0] - 1, before[1] - 1, before[2] - 1]);
  assert.equal(env.objects.size, 0, 'emptying the trash removes the stored image');
});

test('adding the trash columns keeps memos, price lists and work capsules exactly as they were', async () => {
  const env = environment(migrationFiles.filter(name => !name.startsWith('0005')));
  // Rows written the way the server stored them before the trash columns existed.
  env.sqlite.exec(`INSERT INTO price_folders (id, owner, name, variant, created_at, catalog_version) VALUES ('me:mine', 'me', '내 폴더', 'heart', 1, 1);
    INSERT INTO price_images (id, owner, folder_id, name, object_key, mime, created_at) VALUES ('img', 'me', 'me:mine', '기존 가격표', 'k', 'image/png', 1);
    INSERT INTO memos (id, owner, title, content, created_at, saved_at) VALUES ('77777777-7777-4777-8777-777777777777', 'me', '메모', '기존 메모', 1, 1);
    INSERT INTO memo_drafts (owner, memo_id, title, content, updated_at) VALUES ('me', '77777777-7777-4777-8777-777777777777', '', '작성 중', 2);
    INSERT INTO work_capsules (id, owner, name, layout, created_at, updated_at) VALUES ('cap', 'me', '기존 작업', '{"windows":[{"id":"notepad","x":1,"y":2,"width":300,"height":200,"minimized":false,"maximized":false}],"active":"notepad","view":{}}', 1, 1);`);
  const snapshot = () => JSON.stringify(['price_folders', 'price_images', 'memos', 'memo_drafts', 'work_capsules'].map(table =>
    env.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(({ trashed_at, ...row }) => row)));
  const saved = snapshot();
  env.apply(migrationFiles.filter(name => name.startsWith('0005')));
  assert.equal(snapshot(), saved);
  assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM memos WHERE trashed_at IS NOT NULL').get().n, 0);
  assert.equal((await call(env, '/api/memos')).data.memos[0].preview, '기존 메모');
  assert.ok((await call(env, '/api/price-files')).data.images.some(image => image.name === '기존 가격표'));
  assert.equal((await call(env, '/api/memos')).data.draft.content, '작성 중');
  assert.equal((await call(env, '/api/capsules')).data.capsules[0].name, '기존 작업');
});

test('the chosen font is saved per account, only from the bundled list, and kept with the wallpaper', async () => {
  const env = environment();
  assert.equal((await call(env, '/api/desktop', { owner: '' })).data.settings.font, null);
  assert.equal((await act(env, { action: 'set-font', font: 'adultkid' }, { owner: '' })).status, 401);
  let state = (await act(env, { action: 'set-font', font: 'nanum-sinhonbubu' })).data;
  assert.equal(state.settings.font, 'nanum-sinhonbubu');
  for (const font of ['comic-sans', '../x', 3, undefined]) assert.equal((await act(env, { action: 'set-font', font })).status, 400);
  await act(env, { action: 'set-fit', fit: 'contain' });
  state = (await call(env, '/api/desktop')).data;
  assert.deepEqual(state.settings, { wallpaper: null, fit: 'contain', font: 'nanum-sinhonbubu' }, 'other settings do not reset the font');
  assert.equal((await call(env, '/api/desktop', { owner: 'someone-else' })).data.settings.font, null);
  state = (await act(env, { action: 'set-font', font: null })).data;
  assert.equal(state.settings.font, null);
  for (const file of ['bccard', 'beomseok-neo', 'adultkid', 'nanum-sinhonbubu']) assert.ok(readFileSync(new URL(`../public/fonts/${file}.woff2`, import.meta.url)).length > 0);
});

test('adding the font column keeps the saved wallpaper settings', async () => {
  const env = environment(migrationFiles.filter(name => !name.startsWith('0006')));
  env.sqlite.exec(`INSERT INTO desktop_settings (owner, wallpaper_asset_id, wallpaper_fit, updated_at) VALUES ('me', NULL, 'contain', 5)`);
  const saved = env.sqlite.prepare('SELECT * FROM desktop_settings').all();
  env.apply(migrationFiles.filter(name => name.startsWith('0006')));
  assert.deepEqual(env.sqlite.prepare('SELECT owner, wallpaper_asset_id, wallpaper_fit, updated_at FROM desktop_settings').all(), saved);
  assert.deepEqual((await call(env, '/api/desktop')).data.settings, { wallpaper: null, fit: 'contain', font: null });
});

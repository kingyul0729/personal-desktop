import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import worker, { handleApi, imageType } from '../worker/index.js';
import { initialPriceFiles } from '../src/app/priceFiles.ts';
import { imageDimensions } from './image-dimensions.mjs';

function environment() {
  const sqlite = new DatabaseSync(':memory:');
  const migrations = new URL('../drizzle/', import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
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
  return { DB, objects, BUCKET: { async put(key, value) { objects.set(key, value); }, async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; }, async delete(key) { objects.delete(key); } } };
}
function request(path, body, owner = 'owner-one', origin = 'https://site.test') {
  const headers = new Headers({ Origin: origin });
  if (owner) { headers.set('oai-authenticated-user-id', owner); headers.set('oai-authenticated-user-email', `${owner}@test.invalid`); }
  if (body && !(body instanceof FormData)) headers.set('Content-Type', 'application/json');
  return new Request(`https://site.test${path}`, { method: body ? 'POST' : 'GET', headers, body: body ? body instanceof FormData ? body : JSON.stringify(body) : undefined });
}

test('anonymous browsing uses the current image catalog while storage is sign-in gated', async () => {
  const env = environment();
  const original = await (await handleApi(request('/api/price-files', null, ''), env)).json();
  assert.deepEqual(original, initialPriceFiles);
  assert.equal(original.folders.length, 5);
  assert.equal(original.images[0].src, '/documents/toning-special1-landscape.png');
  assert.deepEqual(original.images.filter(image => image.folderId === 'toning').map(image => image.name), ['스페셜 토닝 1', '스페셜 토닝 2', '스페셜 토닝 3', '스페셜 토닝 4', '듀얼 토닝', '트리플 토닝', '흑자 제거']);
  assert.ok(!original.images.some(image => image.id === 'toning-original'));
  assert.deepEqual(original.images.filter(image => image.folderId === 'skinbooster').map(image => image.name), ['스킨부스터 3종', '리바이브', '리투오', '힐로웨이브']);
  assert.deepEqual(original.images.filter(image => image.folderId === 'acne').map(image => image.name), ['여드름 치료 원리', '여드름 치료 안내', '여드름 4주 패키지', '여드름 6주 패키지', '여드름 8주 패키지', '여드름 자국 지우기']);
  for (const image of original.images) {
    assert.ok(readFileSync(new URL(`../public${image.src}`, import.meta.url)).length > 0);
    for (const [orientation, source] of Object.entries(image.variants ?? {})) {
      const { width, height } = imageDimensions(new URL(`../public${source}`, import.meta.url));
      assert.equal(width > height, orientation === 'landscape', source);
    }
  }
  assert.equal((await handleApi(request('/api/price-files', { action: 'create-folder', name: '시도' }, ''), env)).status, 401);
  assert.equal((await handleApi(request('/api/price-files', { action: 'create-folder', name: '시도' }, 'one', 'https://elsewhere.test'), env)).status, 403);
});

test('upload, rename, move, reopen and delete persist with original image bytes and owner isolation', async () => {
  const env = environment();
  let data = await (await handleApi(request('/api/price-files'), env)).json();
  assert.equal(data.images.length, 18);
  assert.equal((await (await handleApi(request('/api/price-files'), env)).json()).images.length, 18);
  data = await (await handleApi(request('/api/price-files', { action: 'create-folder', name: '추가 가격표', variant: 'flower' }), env)).json();
  const folder = data.folders.find(item => item.name === '추가 가격표');
  assert.ok(folder);
  const form = new FormData();
  const bytes = new Uint8Array([137,80,78,71,13,10,26,10,1,2,3]);
  form.set('file', new File([bytes], '테스트.png', { type: 'image/png' }));
  form.set('name', '스킨부스터 가격표'); form.set('folderId', folder.id);
  const added = await handleApi(request('/api/price-images', form), env);
  assert.equal(added.status, 201);
  data = await added.json();
  const image = data.images.find(item => item.name === '스킨부스터 가격표');
  const served = await handleApi(request(image.src), env);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), bytes);
  assert.equal((await handleApi(request(image.src, null, 'someone-else'), env)).status, 404);
  const other = await (await handleApi(request('/api/price-files', null, 'someone-else'), env)).json();
  assert.equal(other.images.length, 18);
  assert.equal((await handleApi(request('/api/price-files', { action: 'edit-image', id: image.id, name: '탈취', folderId: other.folders[0].id }, 'someone-else'), env)).status, 404);
  assert.equal((await handleApi(request('/api/price-files', { action: 'edit-image', id: image.id, name: '이동', folderId: other.folders[0].id }), env)).status, 400);
  const targetFolder = data.folders[1];
  await handleApi(request('/api/price-files', { action: 'edit-image', id: image.id, name: '수정한 가격표', folderId: targetFolder.id }), env);
  await handleApi(request('/api/price-files', { action: 'rename-folder', id: targetFolder.id, name: '새 프로그램' }), env);
  const reloaded = await (await handleApi(request('/api/price-files'), env)).json();
  assert.equal(reloaded.images.find(item => item.id === image.id).folderId, targetFolder.id);
  assert.equal(reloaded.images.find(item => item.id === image.id).name, '수정한 가격표');
  assert.equal(reloaded.folders.find(item => item.id === targetFolder.id).name, '새 프로그램');
  const removed = await (await handleApi(request('/api/price-files', { action: 'delete-image', id: image.id }), env)).json();
  assert.equal(removed.images.length, 18);
  assert.equal(env.objects.size, 0);
});

test('existing accounts receive the skinbooster collection once without replacing saved images or resurrecting deleted ones', async () => {
  const env = environment();
  await env.DB.prepare('INSERT INTO price_folders (id, owner, name, variant, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind('owner-one:toning', 'owner-one', '내가 정리한 폴더', 'kitty', 1).run();
  await env.DB.prepare('INSERT INTO price_images (id, owner, folder_id, name, source, mime, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind('saved-image', 'owner-one', 'owner-one:toning', '기존 가격표', '/documents/toning-program.jpeg', 'image/jpeg', 1).run();
  const updated = await (await handleApi(request('/api/price-files'), env)).json();
  assert.equal(updated.folders.length, 4);
  assert.equal(updated.folders[0].name, '내가 정리한 폴더');
  assert.equal(updated.images.length, 19);
  assert.equal(updated.images[0].name, '기존 가격표');
  const image = updated.images.find(item => item.name === '리바이브');
  await handleApi(request('/api/price-files', { action: 'delete-image', id: image.id }), env);
  const reloaded = await (await handleApi(request('/api/price-files'), env)).json();
  assert.equal(reloaded.images.length, 18);
  assert.ok(!reloaded.images.some(item => item.id === image.id));
});

test('existing lifting folders receive the Serf pair once and retain user edits and deletion', async () => {
  const env = environment();
  await handleApi(request('/api/price-files'), env);
  await env.DB.prepare('DELETE FROM price_images WHERE id = ?').bind('owner-one:lifting-serf').run();
  await env.DB.prepare('UPDATE price_folders SET catalog_version = 0, name = ? WHERE id = ?')
    .bind('리프팅 상담', 'owner-one:lifting').run();
  const added = await (await handleApi(request('/api/price-files'), env)).json();
  assert.equal(added.folders.find(item => item.id === 'owner-one:lifting').name, '리프팅 상담');
  assert.equal(added.images.filter(item => item.id === 'owner-one:lifting-serf').length, 1);
  assert.deepEqual(added.images.find(item => item.id === 'owner-one:lifting-serf').variants, {
    landscape: '/documents/lifting-serf-landscape.jpg', portrait: '/documents/lifting-serf-portrait.jpg',
  });
  await handleApi(request('/api/price-files', { action: 'edit-image', id: 'owner-one:lifting-serf', name: '세르프 상담', folderId: 'owner-one:other' }), env);
  const moved = (await (await handleApi(request('/api/price-files'), env)).json()).images.find(item => item.id === 'owner-one:lifting-serf');
  assert.equal(moved.name, '세르프 상담');
  assert.equal(moved.folderId, 'owner-one:other');
  await handleApi(request('/api/price-files', { action: 'delete-image', id: moved.id }), env);
  const reloaded = await (await handleApi(request('/api/price-files'), env)).json();
  assert.ok(!reloaded.images.some(item => item.id === moved.id));
});

test('invalid uploads and storage failures produce recoverable Korean errors', async () => {
  const env = environment();
  const data = await (await handleApi(request('/api/price-files'), env)).json();
  const form = new FormData();
  form.set('file', new File(['<svg onload=alert(1)>'], 'image.png', { type: 'image/png' }));
  form.set('folderId', data.folders[0].id); form.set('name', '금액표');
  assert.equal((await handleApi(request('/api/price-images', form), env)).status, 400);
  assert.equal(imageType(new Uint8Array([255,216,255]).buffer), 'image/jpeg');
  const unavailable = await worker.fetch(request('/api/price-files'), { DB: { prepare() { throw new Error('storage unavailable'); } } });
  assert.equal(unavailable.status, 503);
  assert.match((await unavailable.json()).error, /다시 시도/);
});

test('existing acne folders receive six originals once while renames, moves and deletions remain saved', async () => {
  const env = environment();
  for (const [id, name] of [['acne', '여드름 상담 자료'], ['skinbooster', '스킨부스터']]) {
    await env.DB.prepare('INSERT INTO price_folders (id, owner, name, variant, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(`owner-one:${id}`, 'owner-one', name, 'kitty', 1).run();
  }
  const added = await (await handleApi(request('/api/price-files'), env)).json();
  assert.equal(added.folders.find(item => item.id === 'owner-one:acne').name, '여드름 상담 자료');
  assert.equal(added.images.length, 14);
  await handleApi(request('/api/price-files', { action: 'edit-image', id: 'owner-one:acne-guide', name: '수정한 안내', folderId: 'owner-one:skinbooster' }), env);
  await handleApi(request('/api/price-files', { action: 'delete-image', id: 'owner-one:acne-four' }), env);
  const reloaded = await (await handleApi(request('/api/price-files'), env)).json();
  assert.equal(reloaded.images.length, 13);
  assert.ok(!reloaded.images.some(item => item.id === 'owner-one:acne-four'));
  const moved = reloaded.images.find(item => item.id === 'owner-one:acne-guide');
  assert.equal(moved.name, '수정한 안내');
  assert.equal(moved.folderId, 'owner-one:skinbooster');
});

test('toning replacement removes only the old built-in image and preserves user content and later edits', async () => {
  const env = environment();
  await handleApi(request('/api/price-files'), env);
  await env.DB.prepare('DELETE FROM price_images WHERE owner = ? AND folder_id = ?').bind('owner-one', 'owner-one:toning').run();
  await env.DB.prepare('UPDATE price_folders SET catalog_version = 0, name = ? WHERE id = ?').bind('색소 상담', 'owner-one:toning').run();
  for (const [id, name] of [['owner-one:toning-original', '토닝 프로그램'], ['custom-toning', '직접 저장한 가격표']]) {
    await env.DB.prepare('INSERT INTO price_images (id, owner, folder_id, name, source, mime, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, 'owner-one', 'owner-one:toning', name, '/documents/toning-program.jpeg', 'image/jpeg', 1).run();
  }
  const updated = await (await handleApi(request('/api/price-files'), env)).json();
  assert.equal(updated.images.length, 19);
  assert.equal(updated.folders.find(item => item.id === 'owner-one:toning').name, '색소 상담');
  assert.ok(!updated.images.some(item => item.id === 'owner-one:toning-original'));
  assert.ok(updated.images.some(item => item.id === 'custom-toning'));
  assert.deepEqual(updated.images.filter(item => item.id.startsWith('owner-one:toning-')).map(item => item.name), ['스페셜 토닝 1', '스페셜 토닝 2', '스페셜 토닝 3', '스페셜 토닝 4', '듀얼 토닝', '트리플 토닝', '흑자 제거']);
  await handleApi(request('/api/price-files', { action: 'edit-image', id: 'owner-one:toning-special1', name: '수정한 토닝', folderId: 'owner-one:skinbooster' }), env);
  await handleApi(request('/api/price-files', { action: 'delete-image', id: 'owner-one:toning-special2' }), env);
  const reloaded = await (await handleApi(request('/api/price-files'), env)).json();
  assert.equal(reloaded.images.length, 18);
  assert.ok(!reloaded.images.some(item => item.id === 'owner-one:toning-special2'));
  assert.equal(reloaded.images.find(item => item.id === 'owner-one:toning-special1').name, '수정한 토닝');
});

test('existing saved images receive orientation pairs without duplicating records or changing user organization', async () => {
  const env = environment();
  await handleApi(request('/api/price-files'), env);
  await handleApi(request('/api/price-files', { action: 'edit-image', id: 'owner-one:toning-special2', name: '상담용 토닝 2', folderId: 'owner-one:other' }), env);
  const data = await (await handleApi(request('/api/price-files'), env)).json();
  const paired = data.images.find(item => item.id === 'owner-one:toning-special2');
  assert.equal(paired.name, '상담용 토닝 2');
  assert.equal(paired.folderId, 'owner-one:other');
  assert.equal(data.images.length, 18);
  assert.deepEqual(paired.variants, {
    landscape: '/documents/toning-special2-landscape.png', portrait: '/documents/toning-special2-portrait.png',
  });
  assert.equal(paired.src, paired.variants.landscape);
  assert.equal(data.images.filter(item => item.variants?.portrait).length, 16);
  for (const id of ['toning-special1', 'toning-dual', 'acne-four', 'acne-six', 'acne-eight', 'acne-marks', 'skinbooster-overview', 'skinbooster-revive', 'skinbooster-re2o', 'skinbooster-hilowave', 'lifting-serf']) {
    const extension = id.startsWith('skinbooster-') || id === 'lifting-serf' ? 'jpg' : 'png';
    assert.deepEqual(data.images.find(item => item.id === `owner-one:${id}`).variants, {
      landscape: `/documents/${id}-landscape.${extension}`, portrait: `/documents/${id}-portrait.${extension}`,
    });
  }
  await handleApi(request('/api/price-files', { action: 'delete-image', id: paired.id }), env);
  const removed = await (await handleApi(request('/api/price-files'), env)).json();
  assert.ok(!removed.images.some(item => item.id === paired.id));
});

test('malformed requests are rejected as client errors instead of storage outages', async () => {
  const env = environment();
  const post = (path, body, type) => new Request(`https://site.test${path}`, { method: 'POST', body, headers: {
    Origin: 'https://site.test', 'Content-Type': type, 'oai-authenticated-user-id': 'owner-one', 'oai-authenticated-user-email': 'owner-one@test.invalid' } });
  for (const body of ['{bad', 'null', '"text"']) {
    const response = await worker.fetch(post('/api/price-files', body, 'application/json'), env);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /요청을 확인/);
  }
  assert.equal((await worker.fetch(post('/api/price-images', 'x', 'text/plain'), env)).status, 400);
  assert.equal((await worker.fetch(request('/api/price-images/%E0%A4%A'), env)).status, 404);
});

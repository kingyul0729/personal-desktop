const defaults = [
  ['toning', '색소·토닝', 'heart'], ['acne', '여드름·흉터', 'kitty'],
  ['lifting', '리프팅', 'flower'], ['skinbooster', '스킨부스터', 'heart'], ['other', '기타 프로그램', 'cherry'],
];
const defaultImages = [
  ['toning-special1', '스페셜 토닝 1', 'toning', '/documents/toning-special1.png', 'image/png'],
  ['toning-special2', '스페셜 토닝 2', 'toning', '/documents/toning-special2.png', 'image/png'],
  ['toning-special3', '스페셜 토닝 3', 'toning', '/documents/toning-special3.png', 'image/png'],
  ['toning-special4', '스페셜 토닝 4', 'toning', '/documents/toning-special4.png', 'image/png'],
  ['toning-dual', '듀얼 토닝', 'toning', '/documents/toning-dual.png', 'image/png'],
  ['toning-triple', '트리플 토닝', 'toning', '/documents/toning-triple.png', 'image/png'],
  ['toning-lentigo', '흑자 제거', 'toning', '/documents/toning-lentigo.png', 'image/png'],
  ['lifting-serf', '세르프', 'lifting', '/documents/lifting-serf-landscape.jpg', 'image/jpeg'],
  ['skinbooster-overview', '스킨부스터 3종', 'skinbooster', '/documents/skinbooster-overview.png', 'image/png'],
  ['skinbooster-revive', '리바이브', 'skinbooster', '/documents/skinbooster-revive.png', 'image/png'],
  ['skinbooster-re2o', '리투오', 'skinbooster', '/documents/skinbooster-re2o.png', 'image/png'],
  ['skinbooster-hilowave', '힐로웨이브', 'skinbooster', '/documents/skinbooster-hilowave.png', 'image/png'],
  ['acne-principle', '여드름 치료 원리', 'acne', '/documents/acne-principle.png', 'image/png'],
  ['acne-guide', '여드름 치료 안내', 'acne', '/documents/acne-guide.png', 'image/png'],
  ['acne-four', '여드름 4주 패키지', 'acne', '/documents/acne-four.png', 'image/png'],
  ['acne-six', '여드름 6주 패키지', 'acne', '/documents/acne-six.png', 'image/png'],
  ['acne-eight', '여드름 8주 패키지', 'acne', '/documents/acne-eight.png', 'image/png'],
  ['acne-marks', '여드름 자국 지우기', 'acne', '/documents/acne-marks.png', 'image/png'],
];
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
// Keep the stored source as the identity so existing names, folders and deletions stay intact.
const imageVariants = {
  '/documents/lifting-serf-landscape.jpg': { landscape: '/documents/lifting-serf-landscape.jpg', portrait: '/documents/lifting-serf-portrait.jpg' },
  '/documents/toning-special1.png': { landscape: '/documents/toning-special1-landscape.png', portrait: '/documents/toning-special1-portrait.png' },
  '/documents/toning-special2.png': { landscape: '/documents/toning-special2-landscape.png', portrait: '/documents/toning-special2-portrait.png' },
  '/documents/toning-special3.png': { landscape: '/documents/toning-special3-landscape.png', portrait: '/documents/toning-special3-portrait.png' },
  '/documents/toning-special4.png': { landscape: '/documents/toning-special4.png', portrait: '/documents/toning-special4-portrait.png' },
  '/documents/toning-dual.png': { landscape: '/documents/toning-dual-landscape.png', portrait: '/documents/toning-dual-portrait.png' },
  '/documents/toning-triple.png': { landscape: '/documents/toning-triple-landscape.png', portrait: '/documents/toning-triple-portrait.png' },
  '/documents/toning-lentigo.png': { landscape: '/documents/toning-lentigo.png', portrait: '/documents/toning-lentigo-portrait.png' },
  '/documents/acne-four.png': { landscape: '/documents/acne-four-landscape.png', portrait: '/documents/acne-four-portrait.png' },
  '/documents/acne-six.png': { landscape: '/documents/acne-six-landscape.png', portrait: '/documents/acne-six-portrait.png' },
  '/documents/acne-eight.png': { landscape: '/documents/acne-eight-landscape.png', portrait: '/documents/acne-eight-portrait.png' },
  '/documents/acne-marks.png': { landscape: '/documents/acne-marks-landscape.png', portrait: '/documents/acne-marks-portrait.png' },
  '/documents/skinbooster-overview.png': { landscape: '/documents/skinbooster-overview-landscape.jpg', portrait: '/documents/skinbooster-overview-portrait.jpg' },
  '/documents/skinbooster-revive.png': { landscape: '/documents/skinbooster-revive-landscape.jpg', portrait: '/documents/skinbooster-revive-portrait.jpg' },
  '/documents/skinbooster-re2o.png': { landscape: '/documents/skinbooster-re2o-landscape.jpg', portrait: '/documents/skinbooster-re2o-portrait.jpg' },
  '/documents/skinbooster-hilowave.png': { landscape: '/documents/skinbooster-hilowave-landscape.jpg', portrait: '/documents/skinbooster-hilowave-portrait.jpg' },
};
const imageSources = src => imageVariants[src] ? { src: imageVariants[src].landscape, variants: imageVariants[src] } : { src };
const cleanName = value => typeof value === 'string' ? value.trim().slice(0, 100) : '';
const statement = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
// Malformed requests are client errors, not storage outages.
const decodeId = value => { try { return decodeURIComponent(value); } catch { return null; } };
const publicFiles = () => ({ authenticated: false,
  folders: defaults.map(([id, name, variant]) => ({ id, name, variant })),
  images: defaultImages.map(([id, name, folderId, src]) => ({ id, name, folderId, ...imageSources(src) })),
});

async function seed(env, owner) {
  const existing = await statement(env, 'SELECT id FROM price_folders WHERE owner = ? LIMIT 1', owner).first();
  // Add this collection once for existing accounts; keep their edits and deletions.
  const hasSkinbooster = existing && await statement(env, 'SELECT id FROM price_folders WHERE id = ? AND owner = ?', `${owner}:skinbooster`, owner).first();
  const folders = existing ? defaults.filter(([id]) => id === 'skinbooster') : defaults;
  const images = existing ? defaultImages.filter(([, , folderId]) => folderId === 'skinbooster') : defaultImages;
  const now = Date.now();
  if (!hasSkinbooster) await env.DB.batch([
    ...folders.map(([id, name, variant]) => statement(env,
      'INSERT OR IGNORE INTO price_folders (id, owner, name, variant, created_at) VALUES (?, ?, ?, ?, ?)',
      `${owner}:${id}`, owner, name, variant, now)),
    ...images.map(([id, name, folderId, source, mime]) => statement(env,
      'INSERT OR IGNORE INTO price_images (id, owner, folder_id, name, source, mime, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      `${owner}:${id}`, owner, `${owner}:${folderId}`, name, source, mime, now)),
  ]);
  for (const collection of ['acne', 'toning', 'lifting']) {
    const folderId = `${owner}:${collection}`;
    const folder = await statement(env, 'SELECT catalog_version FROM price_folders WHERE id = ? AND owner = ?', folderId, owner).first();
    if ((folder?.catalog_version ?? 0) >= 1) continue;
    const [, folderName, variant] = defaults.find(([id]) => id === collection);
    // Import once; subsequent account edits, moves and deletions remain authoritative.
    await env.DB.batch([
      statement(env, 'INSERT OR IGNORE INTO price_folders (id, owner, name, variant, created_at) VALUES (?, ?, ?, ?, ?)',
        folderId, owner, folderName, variant, now),
      ...(collection === 'toning' ? [statement(env,
        'DELETE FROM price_images WHERE id = ? AND owner = ? AND source = ? AND object_key IS NULL',
        `${owner}:toning-original`, owner, '/documents/toning-program.jpeg')] : []),
      ...defaultImages.filter(([, , id]) => id === collection).map(([id, name, , source, mime]) => statement(env,
        'INSERT OR IGNORE INTO price_images (id, owner, folder_id, name, source, mime, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM price_folders WHERE id = ? AND owner = ? AND catalog_version < 1)',
        `${owner}:${id}`, owner, folderId, name, source, mime, now, folderId, owner)),
      statement(env, 'UPDATE price_folders SET catalog_version = 1 WHERE id = ? AND owner = ? AND catalog_version < 1', folderId, owner),
    ]);
  }
}
async function list(env, owner) {
  await seed(env, owner);
  const [folders, images] = await Promise.all([
    statement(env, 'SELECT id, name, variant FROM price_folders WHERE owner = ? ORDER BY created_at, rowid', owner).all(),
    statement(env, 'SELECT id, name, folder_id AS folderId, source FROM price_images WHERE owner = ? ORDER BY created_at, rowid', owner).all(),
  ]);
  return { authenticated: true, folders: folders.results,
    images: images.results.map(({ source, ...image }) => ({ ...image, ...imageSources(source || `/api/price-images/${encodeURIComponent(image.id)}`) })) };
}

export function imageType(bytes) {
  const b = new Uint8Array(bytes);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 && b[4] === 13 && b[5] === 10 && b[6] === 26 && b[7] === 10) return 'image/png';
  if (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

const MEMO_LIMIT = 100000;
const memoId = value => typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value) ? value : null;
const memoTitle = value => typeof value === 'string' ? value.trim().slice(0, 100) : '';
const memoPreview = content => content.replace(/\s+/g, ' ').trim().slice(0, 80);
const memoBody = body => body && typeof body === 'object' && typeof body.content === 'string'
  ? { title: memoTitle(body.title), content: body.content } : null;
async function memoState(env, owner) {
  const [rows, draft] = await Promise.all([
    statement(env, 'SELECT id, title, content, created_at AS createdAt, saved_at AS savedAt FROM memos WHERE owner = ? ORDER BY saved_at DESC, rowid DESC', owner).all(),
    statement(env, 'SELECT memo_id AS memoId, title, content, updated_at AS updatedAt FROM memo_drafts WHERE owner = ?', owner).first(),
  ]);
  return { authenticated: true, draft,
    memos: rows.results.map(({ content, ...memo }) => ({ ...memo, preview: memoPreview(content) })) };
}
async function handleMemos(request, env, owner, url) {
  if (url.pathname === '/api/memos' && request.method === 'GET') return json(await memoState(env, owner));
  if (url.pathname === '/api/memo-draft' && request.method === 'PUT') {
    const body = await request.json().catch(() => null);
    const id = memoId(body?.memoId);
    const memo = memoBody(body);
    if (!id || !memo) return json({ error: '요청을 확인할 수 없습니다.' }, 400);
    if (memo.content.length > MEMO_LIMIT) return json({ error: '메모는 10만 자까지 저장할 수 있습니다.' }, 413);
    await statement(env, `INSERT INTO memo_drafts (owner, memo_id, title, content, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(owner) DO UPDATE SET memo_id = excluded.memo_id, title = excluded.title, content = excluded.content, updated_at = excluded.updated_at`,
      owner, id, memo.title, memo.content, Date.now()).run();
    return json({ ok: true });
  }
  const match = url.pathname.match(/^\/api\/memos\/([^/]+)$/);
  const id = match && memoId(decodeId(match[1]));
  if (match && !id) return json({ error: '메모를 찾을 수 없습니다.' }, 404);
  if (id && request.method === 'GET') {
    const row = await statement(env, 'SELECT id, title, content, created_at AS createdAt, saved_at AS savedAt FROM memos WHERE id = ? AND owner = ?', id, owner).first();
    return row ? json(row) : json({ error: '메모를 찾을 수 없습니다.' }, 404);
  }
  if (id && request.method === 'PUT') {
    const memo = memoBody(await request.json().catch(() => null));
    if (!memo) return json({ error: '요청을 확인할 수 없습니다.' }, 400);
    if (!memo.content.trim()) return json({ error: '메모 내용을 입력해 주세요.' }, 400);
    if (memo.content.length > MEMO_LIMIT) return json({ error: '메모는 10만 자까지 저장할 수 있습니다.' }, 413);
    const now = Date.now();
    // The id comes from the editor, so saving again updates the same memo instead of adding a copy.
    const [saved] = await env.DB.batch([
      statement(env, `INSERT INTO memos (id, owner, title, content, created_at, saved_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content, saved_at = excluded.saved_at WHERE memos.owner = excluded.owner`,
        id, owner, memo.title, memo.content, now, now),
      statement(env, `INSERT INTO memo_drafts (owner, memo_id, title, content, updated_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM memos WHERE id = ? AND owner = ?)
        ON CONFLICT(owner) DO UPDATE SET memo_id = excluded.memo_id, title = excluded.title, content = excluded.content, updated_at = excluded.updated_at`,
        owner, id, memo.title, memo.content, now, id, owner),
    ]);
    if (!saved.meta.changes) return json({ error: '메모를 찾을 수 없습니다.' }, 404);
    const row = await statement(env, 'SELECT id, title, content, created_at AS createdAt, saved_at AS savedAt FROM memos WHERE id = ? AND owner = ?', id, owner).first();
    return json({ memo: row, ...(await memoState(env, owner)) });
  }
  if (id && request.method === 'DELETE') {
    // Drop the draft too when it belongs to this memo, so another device does not bring it back.
    const [removed] = await env.DB.batch([
      statement(env, 'DELETE FROM memos WHERE id = ? AND owner = ?', id, owner),
      statement(env, 'DELETE FROM memo_drafts WHERE owner = ? AND memo_id = ?', owner, id),
    ]);
    if (!removed.meta.changes) return json({ error: '메모를 찾을 수 없습니다.' }, 404);
    return json(await memoState(env, owner));
  }
  return null;
}

export async function handleApi(request, env) {
  const url = new URL(request.url);
  const owner = request.headers.get('oai-authenticated-user-id');
  const signedIn = owner && request.headers.get('oai-authenticated-user-email');
  if (!signedIn) return request.method === 'GET' && url.pathname === '/api/price-files' ? json(publicFiles())
    : request.method === 'GET' && url.pathname === '/api/memos' ? json({ authenticated: false, memos: [], draft: null })
      : json({ error: '로그인 후 이용해 주세요.' }, 401);
  if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('Origin') !== url.origin) return json({ error: '요청을 확인할 수 없습니다.' }, 403);
  if (url.pathname.startsWith('/api/memo')) {
    const response = await handleMemos(request, env, owner, url);
    if (response) return response;
  }
  if (url.pathname === '/api/price-files' && request.method === 'GET') return json(await list(env, owner));

  const imageMatch = url.pathname.match(/^\/api\/price-images\/([^/]+)$/);
  if (imageMatch && request.method === 'GET') {
    const id = decodeId(imageMatch[1]);
    if (id === null) return json({ error: '이미지를 찾을 수 없습니다.' }, 404);
    const row = await statement(env, 'SELECT object_key, mime FROM price_images WHERE id = ? AND owner = ?', id, owner).first();
    if (!row?.object_key) return json({ error: '이미지를 찾을 수 없습니다.' }, 404);
    const object = await env.BUCKET.get(row.object_key);
    if (!object) return json({ error: '이미지를 불러오지 못했습니다.' }, 404);
    return new Response(object.body, { headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (url.pathname === '/api/price-images' && request.method === 'POST') {
    if (Number(request.headers.get('Content-Length') || 0) > 12 * 1024 * 1024) return json({ error: '이미지는 10MB 이하로 추가해 주세요.' }, 413);
    const form = await request.formData().catch(() => null);
    if (!form) return json({ error: '이름과 10MB 이하 이미지를 확인해 주세요.' }, 400);
    const file = form.get('file');
    const name = cleanName(form.get('name'));
    const folderId = form.get('folderId');
    if (!(file instanceof File) || !name || file.size > 10 * 1024 * 1024 || file.size === 0) return json({ error: '이름과 10MB 이하 이미지를 확인해 주세요.' }, 400);
    const folder = await statement(env, 'SELECT id FROM price_folders WHERE id = ? AND owner = ?', folderId, owner).first();
    if (!folder) return json({ error: '저장할 폴더를 선택해 주세요.' }, 400);
    const bytes = await file.arrayBuffer();
    const mime = imageType(bytes);
    if (!mime) return json({ error: 'JPG, PNG, WEBP 이미지만 추가할 수 있습니다.' }, 400);
    const id = crypto.randomUUID();
    const objectKey = `price-images/${owner}/${id}`;
    await env.BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: mime } });
    try {
      await statement(env, 'INSERT INTO price_images (id, owner, folder_id, name, object_key, mime, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, owner, folderId, name, objectKey, mime, Date.now()).run();
    } catch (error) { await env.BUCKET.delete(objectKey); throw error; }
    return json(await list(env, owner), 201);
  }
  if (url.pathname === '/api/price-files' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: '요청을 확인할 수 없습니다.' }, 400);
    const name = cleanName(body.name);
    if (body.action === 'create-folder') {
      if (!name) return json({ error: '폴더 이름을 입력해 주세요.' }, 400);
      const variant = ['heart', 'kitty', 'flower', 'cherry'].includes(body.variant) ? body.variant : 'heart';
      await statement(env, 'INSERT INTO price_folders (id, owner, name, variant, created_at) VALUES (?, ?, ?, ?, ?)', crypto.randomUUID(), owner, name, variant, Date.now()).run();
    } else if (body.action === 'edit-image') {
      if (!name) return json({ error: '가격표 이름을 입력해 주세요.' }, 400);
      const folder = await statement(env, 'SELECT id FROM price_folders WHERE id = ? AND owner = ?', body.folderId, owner).first();
      if (!folder) return json({ error: '저장할 폴더를 선택해 주세요.' }, 400);
      const result = await statement(env, 'UPDATE price_images SET name = ?, folder_id = ? WHERE id = ? AND owner = ?', name, body.folderId, body.id, owner).run();
      if (!result.meta.changes) return json({ error: '가격표를 찾을 수 없습니다.' }, 404);
    } else if (body.action === 'rename-folder') {
      if (!name) return json({ error: '폴더 이름을 입력해 주세요.' }, 400);
      const result = await statement(env, 'UPDATE price_folders SET name = ? WHERE id = ? AND owner = ?', name, body.id, owner).run();
      if (!result.meta.changes) return json({ error: '폴더를 찾을 수 없습니다.' }, 404);
    } else if (body.action === 'delete-image') {
      const row = await statement(env, 'SELECT object_key FROM price_images WHERE id = ? AND owner = ?', body.id, owner).first();
      if (!row) return json({ error: '가격표를 찾을 수 없습니다.' }, 404);
      // Remove the record first so a storage cleanup failure never leaves a broken visible image.
      await statement(env, 'DELETE FROM price_images WHERE id = ? AND owner = ?', body.id, owner).run();
      if (row.object_key) await env.BUCKET.delete(row.object_key).catch(error => console.error('Image cleanup failed', error));
    } else return json({ error: '지원하지 않는 작업입니다.' }, 400);
    return json(await list(env, owner));
  }
  return json({ error: '요청한 기능을 찾을 수 없습니다.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await handleApi(request, env); }
      catch (error) { console.error('Storage request failed', error); return json({ error: '저장 공간에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503); }
    }
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404 || url.pathname.includes('.')) return response;
    return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
  },
};

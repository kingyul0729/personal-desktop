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
// Declare UTF-8 so Korean messages are never decoded with a legacy encoding (Safari guessed CP949).
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' } });
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

// Desktop: fixed programs can only be hidden or relabelled; shortcuts can be removed without
// touching their target; user files go to trash first and are deleted only by purge.
const PROGRAMS = [['terminal', 'Terminal'], ['fileExplorer', '가격표 보관함'], ['controlPanel', '환경설정'],
  ['programManager', '작업 캡슐'], ['notepad', '메모장'], ['priceCalculator', '금액 계산'], ['trash', '휴지통']];
const FILE_LIMIT = 100000;
const UNLOCK_MS = 30 * 60 * 1000;
const LOCK_ATTEMPTS = 5;
const LOCKOUT_MS = 60 * 1000;
const validIcon = value => value === null || (typeof value === 'string' && /^(folder:(heart|kitty|flower|cherry)|builtin:[a-z0-9-]{1,40}|asset:[A-Za-z0-9-]{8,64})$/.test(value));
const fileId = value => typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value) ? value : null;
const programTarget = target => typeof target === 'string' && PROGRAMS.some(([id]) => target === `program:${id}`);
const assetSrc = id => `/api/desktop-assets/${encodeURIComponent(id)}`;
const fail = (error, status = 400, extra = {}) => ({ error, status, ...extra });
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
async function sha256(text) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); }
async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256));
}
function sameText(a, b) { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
const validPassword = value => typeof value === 'string' && value.length >= 4 && value.length <= 64;

export function publicDesktop() {
  return { authenticated: false, settings: { wallpaper: null, fit: 'cover' }, assets: [], files: [], trash: [],
    items: PROGRAMS.map(([id, label], sort) => ({ id: `program:${id}`, kind: 'program', target: `program:${id}`, label, defaultLabel: label, icon: null, hidden: false, sort })) };
}
async function seedDesktop(env, owner) {
  const now = Date.now();
  await env.DB.batch(PROGRAMS.map(([id], sort) => statement(env,
    'INSERT OR IGNORE INTO desktop_items (id, owner, kind, target, label, icon, hidden, sort, created_at) VALUES (?, ?, ?, ?, NULL, NULL, 0, ?, ?)',
    `${owner}:program:${id}`, owner, 'program', `program:${id}`, sort, now)));
}
async function unlockedIds(env, owner, request) {
  const tokens = (request.headers.get('X-Unlock-Tokens') || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 20);
  if (!tokens.length) return new Set();
  const hashes = await Promise.all(tokens.map(sha256));
  const rows = await statement(env, `SELECT file_id FROM file_unlocks WHERE owner = ? AND expires_at > ? AND token_hash IN (${hashes.map(() => '?').join(',')})`,
    owner, Date.now(), ...hashes).all();
  return new Set(rows.results.map(row => row.file_id));
}
async function loadFiles(env, owner) {
  const rows = await statement(env, `SELECT id, parent_id AS parentId, kind, name, created_at AS createdAt, updated_at AS updatedAt,
    trashed_at AS trashedAt, lock_hash IS NOT NULL AS locked FROM user_files WHERE owner = ?`, owner).all();
  return new Map(rows.results.map(row => [row.id, { ...row, locked: !!row.locked }]));
}
// Walk from a file to the desktop; stops on a missing parent so a broken chain cannot loop forever.
function ancestors(files, id) {
  const chain = []; const seen = new Set();
  for (let current = files.get(id); current && !seen.has(current.id); current = current.parentId ? files.get(current.parentId) : null) {
    seen.add(current.id); chain.push(current);
  }
  return chain;
}
const blockedBy = (files, unlocked, id, includeSelf = true) =>
  ancestors(files, id).slice(includeSelf ? 0 : 1).find(item => item.locked && !unlocked.has(item.id))?.id ?? null;
const inTrash = (files, id) => ancestors(files, id).some(item => item.trashedAt);
const fileView = (file, unlocked) => ({ id: file.id, parentId: file.parentId, kind: file.kind, name: file.name,
  updatedAt: file.updatedAt, locked: file.locked, unlocked: file.locked && unlocked.has(file.id) });

async function desktopState(env, owner, unlocked) {
  await seedDesktop(env, owner);
  const [files, items, settings, assets] = await Promise.all([
    loadFiles(env, owner),
    statement(env, 'SELECT id, kind, target, label, icon, hidden, sort FROM desktop_items WHERE owner = ? ORDER BY sort, rowid', owner).all(),
    statement(env, 'SELECT wallpaper_asset_id AS assetId, wallpaper_fit AS fit FROM desktop_settings WHERE owner = ?', owner).first(),
    statement(env, 'SELECT id, kind FROM desktop_assets WHERE owner = ? ORDER BY created_at, rowid', owner).all(),
  ]);
  const programLabel = target => PROGRAMS.find(([id]) => target === `program:${id}`)?.[1] ?? '';
  const desktop = [];
  for (const item of items.results) {
    const base = { id: item.id, kind: item.kind, target: item.target, icon: item.icon, hidden: !!item.hidden, sort: item.sort };
    if (item.kind === 'program') { desktop.push({ ...base, label: item.label || programLabel(item.target), defaultLabel: programLabel(item.target) }); continue; }
    const linked = item.target.startsWith('file:') ? files.get(item.target.slice(5)) : null;
    if (item.kind === 'file') {
      // A desktop file shows only while the file itself sits on the desktop and is not in the trash.
      if (!linked || linked.parentId || inTrash(files, linked.id) || blockedBy(files, unlocked, linked.id, false)) continue;
      desktop.push({ ...base, label: linked.name, fileKind: linked.kind, locked: linked.locked });
      continue;
    }
    const missing = item.target.startsWith('file:') && (!linked || inTrash(files, linked.id));
    desktop.push({ ...base, label: item.label || programLabel(item.target), missing, fileKind: linked?.kind, locked: !!linked?.locked });
  }
  const visible = [...files.values()].filter(file => !inTrash(files, file.id) && !blockedBy(files, unlocked, file.id, false));
  const trash = [...files.values()].filter(file => file.trashedAt).sort((a, b) => b.trashedAt - a.trashedAt).map(file => {
    const parent = file.parentId ? files.get(file.parentId) : null;
    return { id: file.id, kind: file.kind, name: file.name, trashedAt: file.trashedAt, locked: file.locked,
      location: parent && !inTrash(files, parent.id) ? parent.name : '바탕화면' };
  });
  const wallpaper = settings?.assetId && assets.results.some(asset => asset.id === settings.assetId) ? { assetId: settings.assetId, src: assetSrc(settings.assetId) } : null;
  return { authenticated: true, items: desktop, trash,
    files: visible.map(file => fileView(file, unlocked)).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1) || a.name.localeCompare(b.name, 'ko')),
    settings: { wallpaper, fit: settings?.fit === 'contain' ? 'contain' : 'cover' },
    assets: assets.results.map(asset => ({ id: asset.id, kind: asset.kind, src: assetSrc(asset.id) })) };
}

async function checkPassword(env, owner, id, password) {
  const row = await statement(env, 'SELECT lock_hash AS hash, lock_salt AS salt, lock_failures AS failures, lock_retry_at AS retryAt FROM user_files WHERE id = ? AND owner = ?', id, owner).first();
  if (!row) return fail('파일을 찾을 수 없습니다.', 404);
  if (!row.hash) return fail('잠겨 있지 않은 항목입니다.');
  if (row.retryAt > Date.now()) return fail('비밀번호를 여러 번 틀렸습니다. 1분 뒤 다시 시도해 주세요.', 429);
  if (typeof password === 'string' && sameText(await hashPassword(password, row.salt), row.hash)) {
    if (row.failures) await statement(env, 'UPDATE user_files SET lock_failures = 0 WHERE id = ? AND owner = ?', id, owner).run();
    return null;
  }
  const failures = row.failures + 1;
  await statement(env, 'UPDATE user_files SET lock_failures = ?, lock_retry_at = ? WHERE id = ? AND owner = ?',
    failures >= LOCK_ATTEMPTS ? 0 : failures, failures >= LOCK_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0, id, owner).run();
  return fail('비밀번호가 맞지 않습니다.', 403);
}
async function ensureDesktopFile(env, owner, id) {
  const next = await statement(env, 'SELECT COALESCE(MAX(sort), -1) + 1 AS sort FROM desktop_items WHERE owner = ?', owner).first();
  await statement(env, 'INSERT OR IGNORE INTO desktop_items (id, owner, kind, target, label, icon, hidden, sort, created_at) VALUES (?, ?, ?, ?, NULL, NULL, 0, ?, ?)',
    `${owner}:file:${id}`, owner, 'file', `file:${id}`, next.sort, Date.now()).run();
}
function descendants(files, id) {
  const ids = [id];
  for (let i = 0; i < ids.length; i++) for (const file of files.values()) if (file.parentId === ids[i] && !ids.includes(file.id)) ids.push(file.id);
  return ids;
}
async function purge(env, owner, ids) {
  await env.DB.batch(ids.flatMap(id => [
    statement(env, 'DELETE FROM user_files WHERE id = ? AND owner = ?', id, owner),
    statement(env, 'DELETE FROM desktop_items WHERE owner = ? AND target = ?', owner, `file:${id}`),
    statement(env, 'DELETE FROM file_unlocks WHERE owner = ? AND file_id = ?', owner, id),
  ]));
}

// Each action returns null on success or a fail(...) object; the caller then returns fresh state.
async function desktopAction(env, owner, body, unlocked) {
  const files = await loadFiles(env, owner);
  const target = fileId(body.id) && files.get(body.id);
  const needAccess = () => {
    if (!target) return fail('파일을 찾을 수 없습니다.', 404);
    const locked = blockedBy(files, unlocked, target.id);
    return locked ? fail('잠긴 항목입니다. 비밀번호를 입력해 주세요.', 423, { lockedId: locked }) : null;
  };
  const item = typeof body.id === 'string' ? await statement(env, 'SELECT id, kind, target FROM desktop_items WHERE id = ? AND owner = ?', body.id, owner).first() : null;
  switch (body.action) {
    case 'set-wallpaper': {
      if (body.assetId !== null && !(await statement(env, 'SELECT id FROM desktop_assets WHERE id = ? AND owner = ?', body.assetId, owner).first())) return fail('배경 이미지를 찾을 수 없습니다.', 404);
      await statement(env, `INSERT INTO desktop_settings (owner, wallpaper_asset_id, wallpaper_fit, updated_at) VALUES (?, ?, 'cover', ?)
        ON CONFLICT(owner) DO UPDATE SET wallpaper_asset_id = excluded.wallpaper_asset_id, updated_at = excluded.updated_at`, owner, body.assetId, Date.now()).run();
      return null;
    }
    case 'set-fit': {
      if (!['cover', 'contain'].includes(body.fit)) return fail('표시 방식을 확인해 주세요.');
      await statement(env, `INSERT INTO desktop_settings (owner, wallpaper_asset_id, wallpaper_fit, updated_at) VALUES (?, NULL, ?, ?)
        ON CONFLICT(owner) DO UPDATE SET wallpaper_fit = excluded.wallpaper_fit, updated_at = excluded.updated_at`, owner, body.fit, Date.now()).run();
      return null;
    }
    case 'update-item': {
      if (!item) return fail('바탕화면 항목을 찾을 수 없습니다.', 404);
      if ('icon' in body && !validIcon(body.icon)) return fail('아이콘을 확인해 주세요.');
      if (typeof body.icon === 'string' && body.icon.startsWith('asset:') && !(await statement(env, 'SELECT id FROM desktop_assets WHERE id = ? AND owner = ?', body.icon.slice(6), owner).first())) return fail('아이콘 이미지를 찾을 수 없습니다.', 404);
      let label;
      if ('label' in body) {
        // A desktop label is only a display name; real files are renamed with rename-file.
        if (item.kind === 'file') return fail('파일 이름은 파일 이름 변경으로 바꿔 주세요.');
        label = cleanName(body.label);
        if (!label && item.kind === 'shortcut') return fail('이름을 입력해 주세요.');
      }
      await statement(env, `UPDATE desktop_items SET label = CASE WHEN ? THEN ? ELSE label END, icon = CASE WHEN ? THEN ? ELSE icon END,
        hidden = CASE WHEN ? THEN ? ELSE hidden END WHERE id = ? AND owner = ?`,
        'label' in body ? 1 : 0, label || null, 'icon' in body ? 1 : 0, body.icon ?? null,
        typeof body.hidden === 'boolean' ? 1 : 0, body.hidden ? 1 : 0, item.id, owner).run();
      return null;
    }
    case 'move-item': {
      if (!item || ![-1, 1].includes(body.direction)) return fail('바탕화면 항목을 찾을 수 없습니다.', 404);
      const rows = (await statement(env, 'SELECT id FROM desktop_items WHERE owner = ? ORDER BY sort, rowid', owner).all()).results.map(row => row.id);
      const at = rows.indexOf(item.id); const to = at + body.direction;
      if (to < 0 || to >= rows.length) return null;
      [rows[at], rows[to]] = [rows[to], rows[at]];
      await env.DB.batch(rows.map((id, sort) => statement(env, 'UPDATE desktop_items SET sort = ? WHERE id = ? AND owner = ?', sort, id, owner)));
      return null;
    }
    case 'add-shortcut': {
      const label = cleanName(body.label);
      if (!label) return fail('이름을 입력해 주세요.');
      if (!validIcon(body.icon ?? null)) return fail('아이콘을 확인해 주세요.');
      const linked = typeof body.target === 'string' && body.target.startsWith('file:') ? files.get(body.target.slice(5)) : null;
      if (!programTarget(body.target) && (!linked || inTrash(files, linked.id))) return fail('연결할 대상을 선택해 주세요.');
      const next = await statement(env, 'SELECT COALESCE(MAX(sort), -1) + 1 AS sort FROM desktop_items WHERE owner = ?', owner).first();
      await statement(env, 'INSERT INTO desktop_items (id, owner, kind, target, label, icon, hidden, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        crypto.randomUUID(), owner, 'shortcut', body.target, label, body.icon ?? null, body.hidden ? 1 : 0, next.sort, Date.now()).run();
      return null;
    }
    case 'remove-shortcut': {
      // Only shortcuts are removed; programs are hidden and real files go to the trash.
      if (!item) return fail('바탕화면 항목을 찾을 수 없습니다.', 404);
      if (item.kind !== 'shortcut') return fail(item.kind === 'program' ? '고정 프로그램은 숨기기만 할 수 있습니다.' : '파일은 휴지통으로 이동해 주세요.');
      await statement(env, 'DELETE FROM desktop_items WHERE id = ? AND owner = ? AND kind = ?', item.id, owner, 'shortcut').run();
      return null;
    }
    case 'create-file': {
      const name = cleanName(body.name);
      if (!['file', 'folder'].includes(body.kind) || !name) return fail('이름을 입력해 주세요.');
      const parentId = body.parentId ?? null;
      if (parentId !== null) {
        const parent = fileId(parentId) && files.get(parentId);
        if (!parent || parent.kind !== 'folder' || inTrash(files, parentId)) return fail('폴더를 찾을 수 없습니다.', 404);
        const locked = blockedBy(files, unlocked, parentId);
        if (locked) return fail('잠긴 폴더입니다. 비밀번호를 입력해 주세요.', 423, { lockedId: locked });
      }
      const id = crypto.randomUUID(); const now = Date.now();
      await statement(env, 'INSERT INTO user_files (id, owner, parent_id, kind, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id, owner, parentId, body.kind, name, '', now, now).run();
      if (parentId === null) await ensureDesktopFile(env, owner, id);
      return { created: id };
    }
    case 'rename-file': {
      const name = cleanName(body.name);
      if (!name) return fail('이름을 입력해 주세요.');
      const denied = needAccess(); if (denied) return denied;
      // Only the name changes; the id, content and every link to the file stay the same.
      await statement(env, 'UPDATE user_files SET name = ?, updated_at = ? WHERE id = ? AND owner = ?', name, Date.now(), target.id, owner).run();
      return null;
    }
    case 'move-file': {
      const denied = needAccess(); if (denied) return denied;
      const parentId = body.parentId ?? null;
      if (parentId !== null) {
        const parent = fileId(parentId) && files.get(parentId);
        if (!parent || parent.kind !== 'folder' || inTrash(files, parentId)) return fail('폴더를 찾을 수 없습니다.', 404);
        if (descendants(files, target.id).includes(parentId)) return fail('폴더를 자기 안으로 옮길 수 없습니다.');
        const locked = blockedBy(files, unlocked, parentId);
        if (locked) return fail('잠긴 폴더입니다. 비밀번호를 입력해 주세요.', 423, { lockedId: locked });
      }
      await statement(env, 'UPDATE user_files SET parent_id = ?, updated_at = ? WHERE id = ? AND owner = ?', parentId, Date.now(), target.id, owner).run();
      if (parentId === null) await ensureDesktopFile(env, owner, target.id);
      return null;
    }
    case 'save-file': {
      const denied = needAccess(); if (denied) return denied;
      if (target.kind !== 'file' || typeof body.content !== 'string') return fail('파일 내용을 확인해 주세요.');
      if (body.content.length > FILE_LIMIT) return fail('파일은 10만 자까지 저장할 수 있습니다.', 413);
      await statement(env, 'UPDATE user_files SET content = ?, updated_at = ? WHERE id = ? AND owner = ?', body.content, Date.now(), target.id, owner).run();
      return null;
    }
    case 'trash-file': {
      const denied = needAccess(); if (denied) return denied;
      if (inTrash(files, target.id)) return null;
      // The row and its content stay; parent_id is kept as the original location for restore.
      await statement(env, 'UPDATE user_files SET trashed_at = ? WHERE id = ? AND owner = ?', Date.now(), target.id, owner).run();
      return null;
    }
    case 'restore-file': {
      if (!target || !target.trashedAt) return fail('휴지통에서 항목을 찾을 수 없습니다.', 404);
      const parent = target.parentId ? files.get(target.parentId) : null;
      const parentId = parent && parent.kind === 'folder' && !inTrash(files, parent.id) ? parent.id : null;
      await statement(env, 'UPDATE user_files SET trashed_at = NULL, parent_id = ? WHERE id = ? AND owner = ?', parentId, target.id, owner).run();
      if (parentId === null) await ensureDesktopFile(env, owner, target.id);
      return { restoredTo: parentId };
    }
    case 'purge-file': {
      if (!target || !target.trashedAt) return fail('휴지통에서 항목을 찾을 수 없습니다.', 404);
      const denied = needAccess(); if (denied) return denied;
      // A locked file inside a folder is not deleted without its own password either.
      const inner = descendants(files, target.id).find(id => files.get(id).locked && !unlocked.has(id));
      if (inner) return fail('잠긴 항목이 들어 있습니다. 비밀번호를 입력해 주세요.', 423, { lockedId: inner });
      await purge(env, owner, descendants(files, target.id));
      return null;
    }
    case 'empty-trash': {
      let skipped = 0;
      for (const file of files.values()) {
        if (!file.trashedAt) continue;
        if (descendants(files, file.id).some(id => blockedBy(files, unlocked, id))) { skipped++; continue; }
        await purge(env, owner, descendants(files, file.id));
      }
      return { skipped };
    }
    case 'lock-set': {
      const denied = needAccess(); if (denied) return denied;
      if (target.locked) return fail('이미 잠긴 항목입니다.');
      if (!validPassword(body.password)) return fail('비밀번호는 4~64자로 입력해 주세요.');
      const salt = crypto.randomUUID();
      await statement(env, 'UPDATE user_files SET lock_hash = ?, lock_salt = ?, lock_failures = 0, lock_retry_at = 0 WHERE id = ? AND owner = ?',
        await hashPassword(body.password, salt), salt, target.id, owner).run();
      await statement(env, 'DELETE FROM file_unlocks WHERE owner = ? AND file_id = ?', owner, target.id).run();
      return null;
    }
    case 'lock-change': {
      if (!target) return fail('파일을 찾을 수 없습니다.', 404);
      if (!validPassword(body.next)) return fail('새 비밀번호는 4~64자로 입력해 주세요.');
      const wrong = await checkPassword(env, owner, target.id, body.current); if (wrong) return wrong;
      const salt = crypto.randomUUID();
      await statement(env, 'UPDATE user_files SET lock_hash = ?, lock_salt = ? WHERE id = ? AND owner = ?', await hashPassword(body.next, salt), salt, target.id, owner).run();
      await statement(env, 'DELETE FROM file_unlocks WHERE owner = ? AND file_id = ?', owner, target.id).run();
      return null;
    }
    case 'lock-remove': {
      if (!target) return fail('파일을 찾을 수 없습니다.', 404);
      const wrong = await checkPassword(env, owner, target.id, body.password); if (wrong) return wrong;
      await statement(env, 'UPDATE user_files SET lock_hash = NULL, lock_salt = NULL, lock_failures = 0, lock_retry_at = 0 WHERE id = ? AND owner = ?', target.id, owner).run();
      await statement(env, 'DELETE FROM file_unlocks WHERE owner = ? AND file_id = ?', owner, target.id).run();
      return null;
    }
    case 'unlock': {
      if (!target) return fail('파일을 찾을 수 없습니다.', 404);
      const wrong = await checkPassword(env, owner, target.id, body.password); if (wrong) return wrong;
      const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
      await statement(env, 'DELETE FROM file_unlocks WHERE owner = ? AND expires_at <= ?', owner, Date.now()).run();
      await statement(env, 'INSERT INTO file_unlocks (token_hash, owner, file_id, expires_at) VALUES (?, ?, ?, ?)', await sha256(token), owner, target.id, Date.now() + UNLOCK_MS).run();
      return { token, fileId: target.id };
    }
    default: return fail('지원하지 않는 작업입니다.');
  }
}

async function handleDesktop(request, env, owner, url) {
  const unlocked = await unlockedIds(env, owner, request);
  if (url.pathname === '/api/desktop' && request.method === 'GET') return json(await desktopState(env, owner, unlocked));
  if (url.pathname === '/api/desktop' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: '요청을 확인할 수 없습니다.' }, 400);
    const result = await desktopAction(env, owner, body, unlocked);
    if (result?.error) { const { status, ...rest } = result; return json(rest, status); }
    if (result?.token) unlocked.add(result.fileId);
    return json({ ...(result ?? {}), ...(await desktopState(env, owner, unlocked)) });
  }
  const fileMatch = url.pathname.match(/^\/api\/files\/([^/]+)$/);
  if (fileMatch && request.method === 'GET') {
    const id = fileId(decodeId(fileMatch[1]));
    const files = await loadFiles(env, owner);
    if (!id || !files.has(id)) return json({ error: '파일을 찾을 수 없습니다.' }, 404);
    // The server, not the window, decides: locked content is never sent without a valid unlock token.
    const locked = blockedBy(files, unlocked, id);
    if (locked) return json({ error: '잠긴 항목입니다. 비밀번호를 입력해 주세요.', lockedId: locked }, 423);
    const row = await statement(env, 'SELECT id, kind, name, content, updated_at AS updatedAt FROM user_files WHERE id = ? AND owner = ?', id, owner).first();
    return json(row);
  }
  const assetMatch = url.pathname.match(/^\/api\/desktop-assets\/([^/]+)$/);
  if (assetMatch && request.method === 'GET') {
    const row = await statement(env, 'SELECT object_key, mime FROM desktop_assets WHERE id = ? AND owner = ?', decodeId(assetMatch[1]) ?? '', owner).first();
    const object = row && await env.BUCKET.get(row.object_key);
    if (!object) return json({ error: '이미지를 찾을 수 없습니다.' }, 404);
    return new Response(object.body, { headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (url.pathname === '/api/desktop-assets' && request.method === 'POST') {
    if (Number(request.headers.get('Content-Length') || 0) > 12 * 1024 * 1024) return json({ error: '이미지는 10MB 이하로 추가해 주세요.' }, 413);
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    const kind = form?.get('kind');
    if (!(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024 || !['wallpaper', 'icon'].includes(kind)) return json({ error: '10MB 이하 이미지를 선택해 주세요.' }, 400);
    const bytes = await file.arrayBuffer();
    const mime = imageType(bytes);
    if (!mime) return json({ error: 'JPG, PNG, WEBP 이미지만 추가할 수 있습니다.' }, 400);
    const id = crypto.randomUUID();
    const objectKey = `desktop-assets/${owner}/${id}`;
    await env.BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: mime } });
    try {
      await statement(env, 'INSERT INTO desktop_assets (id, owner, kind, object_key, mime, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, owner, kind, objectKey, mime, Date.now()).run();
    } catch (error) { await env.BUCKET.delete(objectKey); throw error; }
    return json({ asset: { id, kind, src: assetSrc(id) }, ...(await desktopState(env, owner, unlocked)) }, 201);
  }
  return null;
}

// Work capsules store a window arrangement and nothing else; opening one never rewrites app data.
const CAPSULE_WINDOWS = ['terminal', 'fileExplorer', 'controlPanel', 'notepad', 'priceCalculator', 'trash', 'files'];
const CAPSULE_LIMIT = 100;
export function cleanLayout(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.windows)) return null;
  const number = v => typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(-10000, Math.min(10000, v))) : null;
  const windows = [];
  for (const item of value.windows.slice(0, 20)) {
    if (!item || !CAPSULE_WINDOWS.includes(item.id) || windows.some(window => window.id === item.id)) continue;
    const [x, y, width, height] = ['x', 'y', 'width', 'height'].map(key => number(item[key]));
    if ([x, y, width, height].includes(null)) continue;
    windows.push({ id: item.id, x, y, width, height, minimized: item.minimized === true, maximized: item.maximized === true });
  }
  if (!windows.length) return null;
  const view = {};
  if (['wallpaper', 'desktop', 'files', 'security'].includes(value.view?.settingsTab)) view.settingsTab = value.view.settingsTab;
  if (value.view && 'filesViewing' in value.view && (value.view.filesViewing === null || fileId(value.view.filesViewing))) view.filesViewing = value.view.filesViewing;
  return { windows, active: windows.some(window => window.id === value.active) ? value.active : null, view };
}
async function capsuleList(env, owner) {
  const rows = await statement(env, 'SELECT id, name, layout, created_at AS createdAt FROM work_capsules WHERE owner = ? ORDER BY created_at DESC, rowid DESC', owner).all();
  return { authenticated: true, capsules: rows.results.map(({ layout, ...row }) => ({ ...row, layout: JSON.parse(layout) })) };
}
async function handleCapsules(request, env, owner) {
  if (request.method === 'GET') return json(await capsuleList(env, owner));
  if (request.method !== 'POST') return json({ error: '요청한 기능을 찾을 수 없습니다.' }, 404);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: '요청을 확인할 수 없습니다.' }, 400);
  const name = cleanName(body.name);
  if (body.action === 'create') {
    const layout = cleanLayout(body.layout);
    if (!layout) return json({ error: '저장할 창이 없습니다. 창을 연 뒤 저장해 주세요.' }, 400);
    if (!name) return json({ error: '작업 이름을 입력해 주세요.' }, 400);
    const count = await statement(env, 'SELECT count(*) AS n FROM work_capsules WHERE owner = ?', owner).first();
    if (count.n >= CAPSULE_LIMIT) return json({ error: `작업은 ${CAPSULE_LIMIT}개까지 저장할 수 있습니다.` }, 400);
    const now = Date.now();
    await statement(env, 'INSERT INTO work_capsules (id, owner, name, layout, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      crypto.randomUUID(), owner, name, JSON.stringify(layout), now, now).run();
  } else if (body.action === 'rename') {
    if (!name) return json({ error: '작업 이름을 입력해 주세요.' }, 400);
    const result = await statement(env, 'UPDATE work_capsules SET name = ?, updated_at = ? WHERE id = ? AND owner = ?', name, Date.now(), body.id, owner).run();
    if (!result.meta.changes) return json({ error: '작업을 찾을 수 없습니다.' }, 404);
  } else if (body.action === 'delete') {
    const result = await statement(env, 'DELETE FROM work_capsules WHERE id = ? AND owner = ?', body.id, owner).run();
    if (!result.meta.changes) return json({ error: '작업을 찾을 수 없습니다.' }, 404);
  } else return json({ error: '지원하지 않는 작업입니다.' }, 400);
  return json(await capsuleList(env, owner));
}

export async function handleApi(request, env) {
  const url = new URL(request.url);
  const owner = request.headers.get('oai-authenticated-user-id');
  const signedIn = owner && request.headers.get('oai-authenticated-user-email');
  if (!signedIn) return request.method === 'GET' && url.pathname === '/api/price-files' ? json(publicFiles())
    : request.method === 'GET' && url.pathname === '/api/memos' ? json({ authenticated: false, memos: [], draft: null })
      : request.method === 'GET' && url.pathname === '/api/desktop' ? json(publicDesktop())
        : request.method === 'GET' && url.pathname === '/api/capsules' ? json({ authenticated: false, capsules: [] })
          : json({ error: '로그인 후 이용해 주세요.' }, 401);
  if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('Origin') !== url.origin) return json({ error: '요청을 확인할 수 없습니다.' }, 403);
  if (url.pathname === '/api/capsules') return handleCapsules(request, env, owner);
  if (url.pathname.startsWith('/api/desktop') || url.pathname.startsWith('/api/files/')) {
    const response = await handleDesktop(request, env, owner, url);
    if (response) return response;
  }
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

// A person opening an /api/ address in the address bar (or a restored tab) is a page visit, not
// a request from the app. Safari sends Sec-Fetch-Mode only from 16.4, so Accept is checked too.
export function isPageVisit(request) {
  const mode = request.headers.get('Sec-Fetch-Mode');
  if (mode) return mode === 'navigate';
  return request.method === 'GET' && (request.headers.get('Accept') || '').includes('text/html');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      let response;
      try { response = await handleApi(request, env); }
      catch (error) { console.error('Storage request failed', error); response = json({ error: '저장 공간에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503); }
      // Never leave a visitor on a raw JSON page; images (price lists, icons) still open as images.
      if (isPageVisit(request) && (response.headers.get('Content-Type') || '').includes('application/json')) {
        return new Response(null, { status: 302, headers: { Location: '/', 'Cache-Control': 'no-store' } });
      }
      return response;
    }
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404 || url.pathname.includes('.')) return response;
    return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
  },
};

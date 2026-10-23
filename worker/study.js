const json = (value, status = 200) => Response.json(value, { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' } });
const sql = (env, query, ...values) => env.DB.prepare(query).bind(...values);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value);
const name = value => typeof value === 'string' ? value.trim() : '';
const missing = () => json({ error: '공부 자료를 찾을 수 없습니다.' }, 404);
const conflict = () => json({ error: '다른 창에서 변경되거나 휴지통으로 이동한 노트입니다. 작성 내용을 복사한 뒤 최신 노트를 다시 열어 주세요.' }, 409);
const fields = 'id, folder_id AS folderId, title, content, revision, created_at AS createdAt, updated_at AS updatedAt, trashed_at AS trashedAt';

export async function handleStudy(request, env, owner, url, imageType) {
  const path = url.pathname;
  if (path === '/api/study' && request.method === 'GET') {
    const trash = url.searchParams.get('trash') === '1';
    const folder = url.searchParams.get('folder');
    const query = (url.searchParams.get('q') || '').trim().slice(0, 200);
    const [folders, notes, counts] = await Promise.all([
      sql(env, `SELECT f.id, f.name, (SELECT count(*) FROM study_notes n WHERE n.folder_id = f.id AND n.owner = f.owner AND n.trashed_at IS NULL) AS count FROM study_folders f WHERE f.owner = ? ORDER BY f.created_at, f.id`, owner).all(),
      sql(env, `SELECT id, folder_id AS folderId, title, substr(content, 1, 180) AS preview, revision, updated_at AS updatedAt, trashed_at AS trashedAt FROM study_notes WHERE owner = ? AND trashed_at IS ${trash ? 'NOT NULL' : 'NULL'}
        ${folder === 'unfiled' ? 'AND folder_id IS NULL' : folder ? 'AND folder_id = ?' : ''}
        AND instr(lower(title || char(10) || content), lower(?)) > 0 ORDER BY updated_at DESC, id`, owner, ...(folder && folder !== 'unfiled' ? [folder] : []), query).all(),
      sql(env, `SELECT count(CASE WHEN trashed_at IS NULL THEN 1 END) AS total, count(CASE WHEN trashed_at IS NOT NULL THEN 1 END) AS trash, count(CASE WHEN trashed_at IS NULL AND folder_id IS NULL THEN 1 END) AS unfiled FROM study_notes WHERE owner = ?`, owner).first(),
    ]);
    return json({ authenticated: true, folders: folders.results, notes: notes.results, counts });
  }
  if (path === '/api/study/folders' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!name(body?.name) || name(body.name).length > 100) return json({ error: '폴더 이름을 1~100자로 입력해 주세요.' }, 400);
    const id = crypto.randomUUID();
    await sql(env, 'INSERT INTO study_folders (id, owner, name, created_at) VALUES (?, ?, ?, ?)', id, owner, name(body.name), Date.now()).run();
    return json({ id }, 201);
  }
  const folderMatch = path.match(/^\/api\/study\/folders\/([A-Za-z0-9-]{8,64})$/);
  if (folderMatch && ['PATCH', 'DELETE'].includes(request.method)) {
    const id = folderMatch[1];
    if (request.method === 'DELETE') {
      // Even trashed notes retain their folder for restoration. Only truly empty folders go.
      const result = await sql(env, 'DELETE FROM study_folders WHERE id = ? AND owner = ? AND NOT EXISTS (SELECT 1 FROM study_notes WHERE folder_id = ?)', id, owner, id).run();
      return result.meta.changes ? json({ ok: true }) : json({ error: '빈 폴더만 삭제할 수 있습니다. 휴지통의 노트도 복원해 다른 폴더로 옮겨 주세요.' }, 409);
    }
    const body = await request.json().catch(() => null);
    if (!name(body?.name) || name(body.name).length > 100) return json({ error: '폴더 이름을 1~100자로 입력해 주세요.' }, 400);
    const result = await sql(env, 'UPDATE study_folders SET name = ? WHERE id = ? AND owner = ?', name(body.name), id, owner).run();
    return result.meta.changes ? json({ ok: true }) : missing();
  }
  const noteMatch = path.match(/^\/api\/study\/notes\/([A-Za-z0-9-]{8,64})$/);
  if (noteMatch) {
    const id = noteMatch[1];
    if (request.method === 'GET') {
      const row = await sql(env, `SELECT ${fields} FROM study_notes WHERE id = ? AND owner = ?`, id, owner).first();
      return row ? json(row) : missing();
    }
    if (request.method === 'PUT') {
      const body = await request.json().catch(() => null);
      if (!name(body?.title) || name(body.title).length > 100 || typeof body?.content !== 'string' || !body.content.trim() || !Number.isInteger(body?.revision) || body.revision < 0 || !(body.folderId === null || validId(body.folderId))) return json({ error: '제목, 본문, 저장할 폴더를 확인해 주세요.' }, 400);
      if (body.content.length > 200000) return json({ error: '공부노트는 20만 자까지 저장할 수 있습니다.' }, 413);
      if (body.folderId && !(await sql(env, 'SELECT id FROM study_folders WHERE id = ? AND owner = ?', body.folderId, owner).first())) return missing();
      const now = Date.now();
      // Revision zero creates; all updates require the exact version read by this editor.
      const result = body.revision === 0
        ? await sql(env, `INSERT OR IGNORE INTO study_notes (id, owner, folder_id, title, content, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`, id, owner, body.folderId, name(body.title), body.content, now, now).run()
        : await sql(env, `UPDATE study_notes SET folder_id = ?, title = ?, content = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND owner = ? AND revision = ? AND trashed_at IS NULL`, body.folderId, name(body.title), body.content, now, id, owner, body.revision).run();
      if (!result.meta.changes) return conflict();
      return json(await sql(env, `SELECT ${fields} FROM study_notes WHERE id = ? AND owner = ?`, id, owner).first());
    }
    if (request.method === 'PATCH') {
      const body = await request.json().catch(() => null);
      if (!['trash', 'restore'].includes(body?.action) || !Number.isInteger(body?.revision)) return json({ error: '요청을 확인해 주세요.' }, 400);
      const restore = body.action === 'restore';
      const result = await sql(env, `UPDATE study_notes SET trashed_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND owner = ? AND revision = ? AND trashed_at IS ${restore ? 'NOT NULL' : 'NULL'}`, restore ? null : Date.now(), Date.now(), id, owner, body.revision).run();
      return result.meta.changes ? json({ ok: true }) : conflict();
    }
  }
  if (path === '/api/study/assets' && request.method === 'POST') {
    if (Number(request.headers.get('Content-Length') || 0) > 9 * 1024 * 1024) return json({ error: '8MB 이하 이미지를 선택해 주세요.' }, 413);
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file.arrayBuffer !== 'function' || !file.size || file.size > 8 * 1024 * 1024) return json({ error: '8MB 이하의 PNG·JPG·WebP 이미지를 선택해 주세요.' }, 400);
    const bytes = await file.arrayBuffer();
    const mime = imageType(bytes);
    if (!mime) return json({ error: 'PNG·JPG·WebP 이미지만 추가할 수 있습니다.' }, 400);
    const id = crypto.randomUUID();
    const objectKey = `study-assets/${owner}/${id}`;
    await env.BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: mime } });
    try { await sql(env, 'INSERT INTO study_assets (id, owner, object_key, mime, created_at) VALUES (?, ?, ?, ?, ?)', id, owner, objectKey, mime, Date.now()).run(); }
    catch (error) { await env.BUCKET.delete(objectKey); throw error; }
    return json({ src: `/api/study/assets/${id}` }, 201);
  }
  const assetMatch = path.match(/^\/api\/study\/assets\/([A-Za-z0-9-]{8,64})$/);
  if (assetMatch && request.method === 'GET') {
    const asset = await sql(env, 'SELECT object_key, mime FROM study_assets WHERE id = ? AND owner = ?', assetMatch[1], owner).first();
    if (!asset) return missing();
    const object = await env.BUCKET.get(asset.object_key);
    return object ? new Response(object.body, { headers: { 'Content-Type': asset.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }) : missing();
  }
  return missing();
}

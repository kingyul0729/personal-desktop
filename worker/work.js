// 다채움피부과 업무 공간(B): 피부팀 업무 매뉴얼과 환자 상담자료.
// Separate tables (work_docs, work_doc_attachments) and R2 prefix (work/) from the personal study archive.
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' } });
const stmt = (env, sql, ...values) => env.DB.prepare(sql).bind(...values);
const columns = 'id, kind, title, summary, content, created_at AS createdAt, updated_at AS updatedAt, trashed_at AS trashedAt';
const KINDS = ['manual', 'consult'];
const missing = () => json({ error: '자료를 찾을 수 없습니다.' }, 404);
const conflict = () => json({ error: '다른 창에서 자료가 변경되었습니다. 목록에서 다시 열어 확인해 주세요. 입력한 내용은 유지됩니다.' }, 409);
const attachmentView = ({ objectKey, ...file }) => ({ ...file, url: `/api/work/attachments/${file.id}` });
async function attachments(env, owner, id) {
  return (await stmt(env, 'SELECT id, name, mime, size, object_key AS objectKey FROM work_doc_attachments WHERE owner = ? AND doc_id = ? ORDER BY created_at, rowid', owner, id).all()).results;
}
async function detail(env, owner, id) {
  const doc = await stmt(env, `SELECT ${columns} FROM work_docs WHERE owner = ? AND id = ?`, owner, id).first();
  return doc ? { ...doc, attachments: (await attachments(env, owner, id)).map(attachmentView) } : null;
}
function mimeOf(bytes) {
  const b = new Uint8Array(bytes); const text = (a, z) => String.fromCharCode(...b.slice(a, z));
  if (b[0] === 137 && text(1, 4) === 'PNG' && b[4] === 13 && b[5] === 10) return 'image/png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp';
  if (text(0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

export async function handleWork(request, env, owner, url) {
  if (url.pathname === '/api/work' && request.method === 'GET') {
    const [docs, files] = await Promise.all([
      stmt(env, `SELECT ${columns} FROM work_docs WHERE owner = ? ORDER BY updated_at DESC`, owner).all(),
      stmt(env, 'SELECT id, doc_id AS docId, name, mime, size FROM work_doc_attachments WHERE owner = ? ORDER BY created_at, rowid', owner).all(),
    ]);
    const byDoc = new Map();
    for (const file of files.results) { const items = byDoc.get(file.docId) || []; items.push(attachmentView(file)); byDoc.set(file.docId, items); }
    return json({ authenticated: true, docs: docs.results.map(doc => ({ ...doc, attachments: byDoc.get(doc.id) || [] })) });
  }
  const fileMatch = url.pathname.match(/^\/api\/work\/attachments\/([A-Za-z0-9-]{8,64})$/);
  if (fileMatch && request.method === 'GET') {
    const file = await stmt(env, 'SELECT a.object_key, a.mime, a.name FROM work_doc_attachments a JOIN work_docs d ON d.id = a.doc_id AND d.owner = a.owner WHERE a.id = ? AND a.owner = ? AND d.trashed_at IS NULL', fileMatch[1], owner).first();
    if (!file) return missing();
    const object = await env.BUCKET.get(file.object_key);
    if (!object) return json({ error: '첨부파일을 불러오지 못했습니다.' }, 404);
    return new Response(object.body, { headers: { 'Content-Type': file.mime, 'Content-Disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none';" } });
  }
  const match = url.pathname.match(/^\/api\/work\/docs\/([A-Za-z0-9-]{8,64})$/);
  if (!match) return missing();
  const id = match[1];
  if (request.method === 'GET') { const doc = await detail(env, owner, id); return doc ? json(doc) : missing(); }
  const current = await detail(env, owner, id);
  if (request.method === 'PATCH') {
    if (!current) return missing();
    const body = await request.json().catch(() => null);
    if (!body || !['trash', 'restore'].includes(body.action)) return json({ error: '요청을 확인해 주세요.' }, 400);
    if (body.version !== current.updatedAt) return conflict();
    const now = Math.max(Date.now(), current.updatedAt + 1);
    const result = await stmt(env, 'UPDATE work_docs SET trashed_at = ?, updated_at = ? WHERE id = ? AND owner = ? AND updated_at = ?',
      body.action === 'trash' ? now : null, now, id, owner, current.updatedAt).run();
    return result.meta.changes ? json(await detail(env, owner, id)) : conflict();
  }
  if (request.method === 'DELETE') {
    // 휴지통에서 완전 삭제: 휴지통에 있는 것만, 첨부 파일까지 지운다.
    if (!current) return missing();
    if (!current.trashedAt) return json({ error: '휴지통에 있는 자료만 완전히 삭제할 수 있습니다.' }, 409);
    const files = await attachments(env, owner, id);
    await stmt(env, 'DELETE FROM work_doc_attachments WHERE owner = ? AND doc_id = ?', owner, id).run();
    await stmt(env, 'DELETE FROM work_docs WHERE owner = ? AND id = ? AND trashed_at IS NOT NULL', owner, id).run();
    for (const file of files) await env.BUCKET.delete(file.objectKey).catch(error => console.error('Attachment cleanup failed', error));
    return json({ purged: id });
  }
  if (request.method !== 'PUT') return json({ error: '지원하지 않는 작업입니다.' }, 405);
  if (Number(request.headers.get('Content-Length') || 0) > 27 * 1024 * 1024) return json({ error: '한 번에 첨부하는 파일은 총 25MB 이하로 선택해 주세요.' }, 413);
  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: '자료 내용을 확인해 주세요.' }, 400);
  const value = name => typeof form.get(name) === 'string' ? form.get(name) : '';
  const title = value('title').trim(), kind = value('kind'), version = Number(value('version'));
  const summary = value('summary').replace(/\r\n?/g, '\n'), content = value('content').replace(/\r\n?/g, '\n');
  if (!KINDS.includes(kind)) return json({ error: '자료 종류를 선택해 주세요.' }, 400);
  if (!title || title.length > 100 || summary.length > 1000 || content.length > 100000) return json({ error: '제목 100자, 설명 1천 자, 본문 10만 자 이내로 입력해 주세요.' }, 400);
  if (current ? (current.trashedAt || version !== current.updatedAt) : version !== 0) return conflict();
  // A caller may not adopt another account's id, even for a fresh document.
  if (!current && await stmt(env, 'SELECT id FROM work_docs WHERE id = ?', id).first()) return conflict();
  const files = form.getAll('files');
  const existing = current ? await attachments(env, owner, id) : [];
  let keep;
  try { keep = JSON.parse(value('keep') || '[]'); } catch { return json({ error: '첨부 목록을 확인해 주세요.' }, 400); }
  if (!Array.isArray(keep) || new Set(keep).size !== keep.length || keep.some(key => !existing.some(file => file.id === key))) return json({ error: '첨부 목록을 확인해 주세요.' }, 400);
  if (files.length + keep.length > 12 || files.some(file => !(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 25 * 1024 * 1024) return json({ error: '첨부는 최대 12개, 파일당 10MB, 한 번에 총 25MB까지 가능합니다.' }, 413);
  const uploads = [];
  for (const file of files) {
    const bytes = await file.arrayBuffer(), mime = mimeOf(bytes);
    if (!mime) return json({ error: 'JPG, PNG, WEBP 이미지 또는 PDF만 첨부할 수 있습니다.' }, 400);
    const fileId = crypto.randomUUID();
    uploads.push({ id: fileId, name: file.name.slice(0, 200), mime, size: file.size, bytes, key: `work/${owner}/${id}/${fileId}` });
  }
  const now = Math.max(Date.now(), (current?.updatedAt || 0) + 1), uploaded = [];
  const removed = existing.filter(file => !keep.includes(file.id));
  try {
    for (const file of uploads) { await env.BUCKET.put(file.key, file.bytes, { httpMetadata: { contentType: file.mime } }); uploaded.push(file.key); }
    // A stale version fails the NOT NULL constraint and rolls back the whole batch.
    const statements = [current
      ? stmt(env, 'UPDATE work_docs SET kind = ?, title = ?, summary = ?, content = ?, updated_at = CASE WHEN updated_at = ? AND trashed_at IS NULL THEN ? ELSE NULL END WHERE id = ? AND owner = ?', kind, title, summary, content, version, now, id, owner)
      : stmt(env, 'INSERT INTO work_docs (id, owner, kind, title, summary, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, owner, kind, title, summary, content, now, now)];
    for (const file of removed) statements.push(stmt(env, 'DELETE FROM work_doc_attachments WHERE id = ? AND owner = ? AND doc_id = ?', file.id, owner, id));
    for (const file of uploads) statements.push(stmt(env, 'INSERT INTO work_doc_attachments (id, owner, doc_id, name, object_key, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', file.id, owner, id, file.name, file.key, file.mime, file.size, now));
    await env.DB.batch(statements);
  } catch (error) {
    await Promise.all(uploaded.map(key => env.BUCKET.delete(key).catch(() => {})));
    if (/NOT NULL constraint failed: work_docs.updated_at|UNIQUE constraint failed: work_docs.id/.test(String(error))) return conflict();
    throw error;
  }
  await Promise.all(removed.map(file => env.BUCKET.delete(file.objectKey).catch(() => {})));
  return json(await detail(env, owner, id), current ? 200 : 201);
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' } });
const stmt = (env, sql, ...values) => env.DB.prepare(sql).bind(...values);
const columns = 'id, title, category, studied_on AS studiedOn, content, tags, keywords, summary, favorite, created_at AS createdAt, updated_at AS updatedAt, trashed_at AS trashedAt';
const idValid = value => /^[A-Za-z0-9-]{8,64}$/.test(value);
const missing = () => json({ error: '공부 기록을 찾을 수 없습니다.' }, 404);
const conflict = () => json({ error: '다른 창에서 기록이 변경되었습니다. 목록에서 다시 열어 확인해 주세요. 입력한 내용은 유지됩니다.' }, 409);
const attachmentView = ({ objectKey, ...file }) => ({ ...file, url: `/api/study/attachments/${file.id}` });
async function attachments(env, owner, id) {
  return (await stmt(env, 'SELECT id, name, mime, size, object_key AS objectKey FROM study_attachments WHERE owner = ? AND record_id = ? ORDER BY created_at, rowid', owner, id).all()).results;
}
async function detail(env, owner, id) {
  const record = await stmt(env, `SELECT ${columns} FROM study_records WHERE owner = ? AND id = ?`, owner, id).first();
  return record ? { ...record, attachments: (await attachments(env, owner, id)).map(attachmentView) } : null;
}
function mimeOf(bytes) {
  const b = new Uint8Array(bytes); const text = (a, z) => String.fromCharCode(...b.slice(a, z));
  if (b[0] === 137 && text(1, 4) === 'PNG' && b[4] === 13 && b[5] === 10) return 'image/png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp';
  if (text(0, 5) === '%PDF-') return 'application/pdf';
  return null;
}
export async function handleStudy(request, env, owner, url) {
  if (url.pathname === '/api/study' && request.method === 'GET') {
    const [records, files] = await Promise.all([
      stmt(env, `SELECT ${columns} FROM study_records WHERE owner = ? ORDER BY studied_on DESC, updated_at DESC`, owner).all(),
      stmt(env, 'SELECT id, record_id AS recordId, name, mime, size FROM study_attachments WHERE owner = ? ORDER BY created_at, rowid', owner).all(),
    ]);
    const byRecord = new Map();
    for (const file of files.results) { const items = byRecord.get(file.recordId) || []; items.push(attachmentView(file)); byRecord.set(file.recordId, items); }
    return json({ authenticated: true, owner, records: records.results.map(record => ({ ...record, attachments: byRecord.get(record.id) || [] })) });
  }
  const fileMatch = url.pathname.match(/^\/api\/study\/attachments\/([A-Za-z0-9-]{8,64})$/);
  if (fileMatch && request.method === 'GET') {
    const file = await stmt(env, 'SELECT a.object_key, a.mime, a.name FROM study_attachments a JOIN study_records r ON r.id = a.record_id AND r.owner = a.owner WHERE a.id = ? AND a.owner = ? AND r.trashed_at IS NULL', fileMatch[1], owner).first();
    if (!file) return missing();
    const object = await env.BUCKET.get(file.object_key);
    if (!object) return json({ error: '첨부파일을 불러오지 못했습니다.' }, 404);
    return new Response(object.body, { headers: { 'Content-Type': file.mime, 'Content-Disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none';" } });
  }
  const match = url.pathname.match(/^\/api\/study\/records\/([A-Za-z0-9-]{8,64})$/);
  if (!match || !idValid(match[1])) return missing();
  const id = match[1];
  if (request.method === 'GET') { const record = await detail(env, owner, id); return record ? json(record) : missing(); }
  const current = await detail(env, owner, id);
  if (request.method === 'PATCH') {
    if (!current) return missing();
    const body = await request.json().catch(() => null);
    if (!body || !['trash', 'restore', 'favorite'].includes(body.action)) return json({ error: '요청을 확인해 주세요.' }, 400);
    if (body.version !== current.updatedAt) return conflict();
    const now = Math.max(Date.now(), current.updatedAt + 1);
    const result = await stmt(env, 'UPDATE study_records SET favorite = ?, trashed_at = ?, updated_at = ? WHERE id = ? AND owner = ? AND updated_at = ?',
      body.action === 'favorite' ? (current.favorite ? 0 : 1) : current.favorite,
      body.action === 'trash' ? now : body.action === 'restore' ? null : current.trashedAt, now, id, owner, current.updatedAt).run();
    return result.meta.changes ? json(await detail(env, owner, id)) : conflict();
  }
  if (request.method !== 'PUT') return json({ error: '지원하지 않는 작업입니다.' }, 405);
  if (Number(request.headers.get('Content-Length') || 0) > 27 * 1024 * 1024) return json({ error: '한 번에 첨부하는 파일은 총 25MB 이하로 선택해 주세요.' }, 413);
  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: '기록 내용을 확인해 주세요.' }, 400);
  const value = name => typeof form.get(name) === 'string' ? form.get(name) : '';
  const title = value('title').trim(), category = value('category').trim(), studiedOn = value('studiedOn');
  const keywords = form.has('keywords') ? value('keywords').replace(/\r\n?/g, '\n') : current?.keywords || '';
  const summary = form.has('summary') ? value('summary').replace(/\r\n?/g, '\n') : current?.summary || '';
  if (keywords.length > 5000 || summary.length > 10000) return json({ error: '키워드는 5천 자, 요약은 1만 자 이내로 입력해 주세요.' }, 400);
  const content = value('content'), tags = value('tags').trim(), version = Number(value('version'));
  if (!title || title.length > 100 || !category || category.length > 40 || tags.length > 300 || content.length > 100000) return json({ error: '제목 100자, 분류 40자, 태그 300자, 메모 10만 자 이내로 입력해 주세요.' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(studiedOn) || !Number.isFinite(Date.parse(studiedOn)) || new Date(studiedOn).toISOString().slice(0, 10) !== studiedOn) return json({ error: '올바른 공부 날짜를 입력해 주세요.' }, 400);
  if (current ? (current.trashedAt || version !== current.updatedAt) : version !== 0) return conflict();
  // A caller may not adopt another account's UUID, even for a fresh record.
  if (!current && await stmt(env, 'SELECT id FROM study_records WHERE id = ?', id).first()) return conflict();
  const files = form.getAll('files');
  const existing = current ? await attachments(env, owner, id) : [];
  let keep;
  try { keep = JSON.parse(value('keep') || '[]'); } catch { return json({ error: '첨부 목록을 확인해 주세요.' }, 400); }
  if (!Array.isArray(keep) || new Set(keep).size !== keep.length || keep.some(key => !existing.some(file => file.id === key))) return json({ error: '첨부 목록을 확인해 주세요.' }, 400);
  if (files.length + keep.length > 12 || files.some(file => !(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 25 * 1024 * 1024) return json({ error: '첨부는 최대 12개, 파일당 10MB, 한 번에 총 25MB까지 가능합니다.' }, 413);
  // Validate all bytes before writing any object.
  const uploads = [];
  for (const file of files) {
    const bytes = await file.arrayBuffer(), mime = mimeOf(bytes);
    if (!mime) return json({ error: 'JPG, PNG, WEBP 이미지 또는 PDF만 첨부할 수 있습니다.' }, 400);
    const fileId = crypto.randomUUID();
    uploads.push({ id: fileId, name: file.name.slice(0, 200), mime, size: file.size, bytes, key: `study/${owner}/${id}/${fileId}` });
  }
  const now = Math.max(Date.now(), (current?.updatedAt || 0) + 1), uploaded = [];
  const removed = existing.filter(file => !keep.includes(file.id));
  try {
    for (const file of uploads) { await env.BUCKET.put(file.key, file.bytes, { httpMetadata: { contentType: file.mime } }); uploaded.push(file.key); }
    // A stale version deliberately fails the NOT NULL constraint, rolling back the entire
    // batch including attachment changes. No concurrent editor can silently overwrite data.
    const statements = [current
      ? stmt(env, 'UPDATE study_records SET title = ?, category = ?, studied_on = ?, content = ?, tags = ?, keywords = ?, summary = ?, updated_at = CASE WHEN updated_at = ? AND trashed_at IS NULL THEN ? ELSE NULL END WHERE id = ? AND owner = ?', title, category, studiedOn, content, tags, keywords, summary, version, now, id, owner)
      : stmt(env, 'INSERT INTO study_records (id, owner, title, category, studied_on, content, tags, keywords, summary, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)', id, owner, title, category, studiedOn, content, tags, keywords, summary, now, now)];
    for (const file of removed) statements.push(stmt(env, 'DELETE FROM study_attachments WHERE id = ? AND owner = ? AND record_id = ?', file.id, owner, id));
    for (const file of uploads) statements.push(stmt(env, 'INSERT INTO study_attachments (id, owner, record_id, name, object_key, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', file.id, owner, id, file.name, file.key, file.mime, file.size, now));
    await env.DB.batch(statements);
  } catch (error) {
    await Promise.all(uploaded.map(key => env.BUCKET.delete(key).catch(() => {})));
    if (/NOT NULL constraint failed: study_records.updated_at|UNIQUE constraint failed: study_records.id/.test(String(error))) return conflict();
    throw error;
  }
  await Promise.all(removed.map(file => env.BUCKET.delete(file.objectKey).catch(() => {})));
  return json(await detail(env, owner, id), current ? 200 : 201);
}

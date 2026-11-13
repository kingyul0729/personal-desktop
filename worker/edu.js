// 신입교육(2026-11-14 사용자 지정) — 20일 교육 일정의 항목 체크(팀장/가르친 직원 이름), 평가일 결과, 항목별 매뉴얼 자료.
// 교육 일정 자체는 화면 코드(src/app/eduPlan.ts)에 있고, 여기는 신입·체크·평가·자료만 저장한다(팀 공용 D1 INV_DB).
// 자료 파일은 명세서와 같은 저장소(BUCKET)에 'edu-docs/…'로, 로그인한 사람만 받는다.
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const bad = (error, status = 400) => json({ error }, status);
const okDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const KEY = /^d([1-9]|1\d|20)-[ls]\d{1,2}$/;
const name = v => String(v ?? '').trim().slice(0, 40);

async function all(db, sql, ...args) { return (await db.prepare(sql).bind(...args).all()).results || []; }
async function one(db, sql, ...args) { return db.prepare(sql).bind(...args).first(); }

const ready = new WeakSet();
async function ensureEduSchema(db) {
  if (ready.has(db)) return;
  await db.exec([
    'CREATE TABLE IF NOT EXISTS edu_trainees (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, start_date TEXT, created_by TEXT, created_at INTEGER, deleted_at INTEGER)',
    'CREATE TABLE IF NOT EXISTS edu_checks (trainee_id INTEGER NOT NULL, item_key TEXT NOT NULL, teacher TEXT NOT NULL, checked_by TEXT, checked_at INTEGER, PRIMARY KEY (trainee_id, item_key))',
    'CREATE TABLE IF NOT EXISTS edu_evals (trainee_id INTEGER NOT NULL, day INTEGER NOT NULL, result TEXT NOT NULL, checked_by TEXT, checked_at INTEGER, PRIMARY KEY (trainee_id, day))',
    'CREATE TABLE IF NOT EXISTS edu_docs (id INTEGER PRIMARY KEY AUTOINCREMENT, item_key TEXT NOT NULL, name TEXT NOT NULL, object_key TEXT NOT NULL, mime TEXT, size INTEGER, created_by TEXT, created_at INTEGER)',
  ].join(';\n'));
  ready.add(db);
}

function fileType(bytes) {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'image/heic';
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  return null;
}

async function state(db) {
  const trainees = await all(db, 'SELECT id, name, start_date FROM edu_trainees WHERE deleted_at IS NULL ORDER BY id');
  const checks = await all(db, 'SELECT trainee_id, item_key, teacher, checked_at FROM edu_checks');
  const evals = await all(db, 'SELECT trainee_id, day, result, checked_at FROM edu_evals');
  for (const t of trainees) {
    t.checks = Object.fromEntries(checks.filter(c => c.trainee_id === t.id).map(c => [c.item_key, { teacher: c.teacher, at: c.checked_at }]));
    t.evals = Object.fromEntries(evals.filter(e => e.trainee_id === t.id).map(e => [String(e.day), { result: e.result, at: e.checked_at }]));
  }
  const docs = await all(db, 'SELECT id, item_key, name, mime FROM edu_docs ORDER BY id');
  return { trainees, docs };
}

export async function handleEdu(request, env, url, user) {
  const db = env.INV_DB;
  if (!db) return json({ error: '데이터베이스가 연결되지 않았어요.', unavailable: true }, 503);
  await ensureEduSchema(db);
  const path = url.pathname.slice('/api/edu'.length) || '/';
  const m = request.method;
  const now = Date.now();
  const traineeOk = async id => !!(await one(db, 'SELECT id FROM edu_trainees WHERE id = ? AND deleted_at IS NULL', id));

  if (m === 'GET' && path === '/state') return json(await state(db));

  if (m === 'POST' && path === '/docs') {
    if (!env.BUCKET) return bad('파일 저장소가 연결되지 않았어요.', 503);
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    const key = String(form?.get('item_key') || '');
    if (!KEY.test(key)) return bad('자료를 붙일 항목을 확인해 주세요.');
    if (!(file && typeof file.arrayBuffer === 'function') || !file.size) return bad('파일을 골라 주세요.');
    if (file.size > 15 * 1024 * 1024) return bad('15MB 이하 파일만 올릴 수 있어요.');
    const bytes = await file.arrayBuffer();
    const mime = fileType(bytes);
    if (!mime) return bad('사진(JPG·PNG·HEIC) 또는 PDF만 올릴 수 있어요.');
    const objectKey = `edu-docs/${crypto.randomUUID()}`;
    await env.BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: mime } });
    try {
      await db.prepare('INSERT INTO edu_docs (item_key, name, object_key, mime, size, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
        .bind(key, name(form.get('name') || file.name || '자료') || '자료', objectKey, mime, bytes.byteLength, user, now).run();
    } catch (e) { await env.BUCKET.delete(objectKey).catch(() => {}); throw e; }
    return json({ ok: true, ...(await state(db)) });
  }
  if (m === 'GET' && /^\/docs\/\d+\/file$/.test(path)) {
    const row = await one(db, 'SELECT object_key, mime FROM edu_docs WHERE id = ?', Number(path.split('/')[2]));
    const obj = row && env.BUCKET && await env.BUCKET.get(row.object_key);
    if (!obj) return bad('파일을 찾을 수 없어요.', 404);
    return new Response(obj.body, { headers: { 'content-type': row.mime || 'application/octet-stream', 'cache-control': 'private, max-age=86400' } });
  }
  if (m === 'DELETE' && /^\/docs\/\d+$/.test(path)) {
    const row = await one(db, 'SELECT id, object_key FROM edu_docs WHERE id = ?', Number(path.split('/')[2]));
    if (!row) return bad('자료를 찾을 수 없어요.', 404);
    await db.prepare('DELETE FROM edu_docs WHERE id = ?').bind(row.id).run();
    if (env.BUCKET) await env.BUCKET.delete(row.object_key).catch(() => {});
    return json({ ok: true, ...(await state(db)) });
  }

  const body = m === 'GET' ? {} : await request.json().catch(() => ({}));
  if (m === 'POST' && path === '/trainees') {
    const n = name(body.name);
    if (!n) return bad('이름을 적어 주세요.');
    if (body.start_date && !okDate(body.start_date)) return bad('교육 시작일을 확인해 주세요.');
    await db.prepare('INSERT INTO edu_trainees (name, start_date, created_by, created_at) VALUES (?,?,?,?)').bind(n, body.start_date || null, user, now).run();
    const row = await one(db, 'SELECT max(id) AS id FROM edu_trainees');
    return json({ ok: true, id: row.id, ...(await state(db)) });
  }
  if ((m === 'PATCH' || m === 'DELETE') && /^\/trainees\/\d+$/.test(path)) {
    const id = Number(path.split('/')[2]);
    if (!(await traineeOk(id))) return bad('신입을 찾을 수 없어요.', 404);
    if (m === 'DELETE') await db.prepare('UPDATE edu_trainees SET deleted_at = ? WHERE id = ?').bind(now, id).run(); // 체크 기록은 남김
    else {
      const n = name(body.name);
      if (!n) return bad('이름을 적어 주세요.');
      if (body.start_date && !okDate(body.start_date)) return bad('교육 시작일을 확인해 주세요.');
      await db.prepare('UPDATE edu_trainees SET name = ?, start_date = ? WHERE id = ?').bind(n, body.start_date || null, id).run();
    }
    return json({ ok: true, ...(await state(db)) });
  }
  if (m === 'POST' && path === '/check') {
    const id = Number(body.trainee_id), key = String(body.key || '');
    if (!KEY.test(key) || !(await traineeOk(id))) return bad('항목을 확인해 주세요.');
    if (!body.on) await db.prepare('DELETE FROM edu_checks WHERE trainee_id = ? AND item_key = ?').bind(id, key).run();
    else {
      // 팀장 교육은 '팀장', 직원 교육은 가르친 직원 이름을 꼭 적는다(2026-11-14 사용자)
      const teacher = /-l\d+$/.test(key) ? '팀장' : name(body.teacher);
      if (!teacher) return bad('가르친 직원 이름을 적어 주세요.');
      await db.prepare('INSERT INTO edu_checks (trainee_id, item_key, teacher, checked_by, checked_at) VALUES (?,?,?,?,?) ON CONFLICT(trainee_id, item_key) DO UPDATE SET teacher = excluded.teacher, checked_by = excluded.checked_by, checked_at = excluded.checked_at')
        .bind(id, key, teacher, user, now).run();
    }
    return json({ ok: true, ...(await state(db)) });
  }
  if (m === 'POST' && path === '/eval') {
    const id = Number(body.trainee_id), day = Number(body.day);
    if (![5, 9, 12, 15, 20].includes(day) || !(await traineeOk(id))) return bad('평가일을 확인해 주세요.');
    if (body.result == null) await db.prepare('DELETE FROM edu_evals WHERE trainee_id = ? AND day = ?').bind(id, day).run();
    else if (!['pass', 'more'].includes(body.result)) return bad('평가 결과를 확인해 주세요.');
    else await db.prepare('INSERT INTO edu_evals (trainee_id, day, result, checked_by, checked_at) VALUES (?,?,?,?,?) ON CONFLICT(trainee_id, day) DO UPDATE SET result = excluded.result, checked_by = excluded.checked_by, checked_at = excluded.checked_at')
      .bind(id, day, body.result, user, now).run();
    return json({ ok: true, ...(await state(db)) });
  }
  return bad('찾을 수 없는 요청이에요.', 404);
}

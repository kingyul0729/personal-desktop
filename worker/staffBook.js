// 일일 예약표(2026-11-13 사용자 지정): 그날 피부팀 예약 줄(시간·고객명·레이저)에 관리담당·관리 종류(S·M·더마·히알·X)·취소를 표시하고,
// 당일예약·신환은 화면에서 직접 더한다. 월말·연말 보고에는 예약 / 당일예약 / 신환을 각각 따로 센다.
// 성과표의 '당일 관리 수'·'지정 환자 수'와는 연결하지 않는다(사용자 선택 '따로 둠') — 여기 숫자는 성과 계산에 쓰이지 않는다.
// 고객 이름은 로그인 뒤에만 열리는 팀 DB에만 있고 저장소에는 넣지 않는다.
export const BOOK_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS staff_book (id INTEGER PRIMARY KEY, date TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'book', time TEXT, customer TEXT NOT NULL, laser TEXT,
    staff_id INTEGER, care TEXT NOT NULL DEFAULT '', cancelled INTEGER NOT NULL DEFAULT 0, created_at INTEGER, updated_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS staff_book_date ON staff_book (date)`,
];
export const BOOK_KINDS = ['book', 'day_book', 'day_care']; // 예약 · 당일예약 · 신환
export const BOOK_CARE = ['S', 'M', '더마', '히알', 'X']; // X = 팩 같은 진료 뒷관리 없음
const WORKING = `(a.attendance = '정상근무' OR (a.attendance = '기타' AND a.etc_type = 'time'))`;

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const bad = msg => json({ error: msg }, 400);
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const timeOf = v => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim()); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; };
// X(뒷관리 없음)는 다른 관리와 같이 고를 수 없다 — 마지막에 고른 쪽만 남는다(화면도 같은 규칙)
export function cleanCare(list) {
  const picked = BOOK_CARE.filter(k => Array.isArray(list) && list.includes(k));
  return picked.includes('X') && picked.length > 1 ? picked.filter(k => k !== 'X') : picked;
}
const rowOut = r => ({ id: r.id, date: r.date, kind: r.kind, time: r.time || '', customer: r.customer, laser: r.laser || '', staff_id: r.staff_id ?? null, care: r.care ? r.care.split(',') : [], cancelled: !!r.cancelled });

export async function handleBook(request, db, sub, url) {
  const m = request.method;
  if (m === 'GET' && sub === '/book') {
    const date = url.searchParams.get('date');
    if (!isDate(date)) return bad('날짜를 확인해 주세요');
    const rows = (await db.prepare(`SELECT * FROM staff_book WHERE date = ? ORDER BY CASE kind WHEN 'book' THEN 0 WHEN 'day_book' THEN 1 ELSE 2 END, time, id`).bind(date).all()).results || [];
    const staff = (await db.prepare(`SELECT id, name, is_leader FROM staff WHERE status IS NULL OR status = 'active' ORDER BY is_leader DESC, id`).all()).results || [];
    // 관리담당은 그날 출근한 사람 위주: 근태가 정상근무·출퇴근 기타인 직원. 그날 근태가 하나도 없으면 모두 보인다.
    const working = ((await db.prepare(`SELECT a.staff_id FROM staff_attendance a WHERE a.work_date = ? AND ${WORKING}`).bind(date).all()).results || []).map(r => r.staff_id);
    return json({ date, rows: rows.map(rowOut), staff, working });
  }
  if (m === 'GET' && sub === '/book/summary') {
    const period = url.searchParams.get('period') || '';
    if (!/^\d{4}(-\d{2})?$/.test(period)) return bad('기간을 확인해 주세요');
    const rows = (await db.prepare(`SELECT b.kind, b.staff_id, b.care, b.cancelled, s.name FROM staff_book b LEFT JOIN staff s ON s.id = b.staff_id WHERE b.date LIKE ?`).bind(`${period}-%`).all()).results || [];
    return json({ period, kinds: summarize(rows) });
  }
  if (m !== 'POST') return json({ error: 'not found' }, 404);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return bad('보낸 내용을 읽지 못했어요');
  const now = Date.now();

  if (sub === '/book/import') {
    if (!isDate(body.date) || !Array.isArray(body.rows) || body.rows.length > 200) return bad('예약표 파일을 확인해 주세요');
    const have = new Set(((await db.prepare(`SELECT time, customer FROM staff_book WHERE date = ? AND kind = 'book'`).bind(body.date).all()).results || []).map(r => `${r.time || ''}|${r.customer}`));
    const add = [];
    for (const r of body.rows) {
      const customer = text(r?.name ?? r?.customer, 40); if (!customer) continue;
      const time = timeOf(r?.time), key = `${time}|${customer}`;
      if (have.has(key)) continue; // 같은 시간·같은 고객은 다시 넣지 않는다(표시해 둔 담당·관리·취소가 그대로 남게)
      have.add(key);
      add.push(db.prepare(`INSERT INTO staff_book (date, kind, time, customer, laser, created_at, updated_at) VALUES (?, 'book', ?, ?, ?, ?, ?)`).bind(body.date, time, customer, text(r?.laser, 200), now, now));
    }
    if (add.length) await db.batch(add);
    return json({ ok: true, added: add.length, skipped: body.rows.length - add.length });
  }
  if (sub === '/book/add') {
    const customer = text(body.customer, 40);
    if (!isDate(body.date) || !['day_book', 'day_care'].includes(body.kind) || !customer) return bad('날짜·고객명을 확인해 주세요');
    const r = await db.prepare(`INSERT INTO staff_book (date, kind, time, customer, laser, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`)
      .bind(body.date, body.kind, timeOf(body.time), customer, text(body.laser, 200), now, now).first();
    return json({ ok: true, row: rowOut(r) });
  }
  if (sub === '/book/update') {
    const cur = await db.prepare('SELECT * FROM staff_book WHERE id = ?').bind(Number(body.id)).first();
    if (!cur) return json({ error: '없는 줄이에요' }, 404);
    const next = { ...cur };
    if ('staff_id' in body) {
      if (body.staff_id == null || body.staff_id === '') next.staff_id = null;
      else { const s = await db.prepare('SELECT id FROM staff WHERE id = ?').bind(Number(body.staff_id)).first(); if (!s) return bad('직원을 확인해 주세요'); next.staff_id = s.id; }
    }
    if ('care' in body) next.care = cleanCare(body.care).join(',');
    if ('cancelled' in body) next.cancelled = body.cancelled ? 1 : 0;
    if ('time' in body) next.time = timeOf(body.time);
    if ('laser' in body) next.laser = text(body.laser, 200);
    if ('customer' in body) { const c = text(body.customer, 40); if (!c) return bad('고객명을 적어 주세요'); next.customer = c; }
    await db.prepare('UPDATE staff_book SET staff_id = ?, care = ?, cancelled = ?, time = ?, laser = ?, customer = ?, updated_at = ? WHERE id = ?')
      .bind(next.staff_id, next.care, next.cancelled, next.time, next.laser, next.customer, now, cur.id).run();
    return json({ ok: true, row: rowOut(next) });
  }
  if (sub === '/book/delete') {
    await db.prepare('DELETE FROM staff_book WHERE id = ?').bind(Number(body.id)).run();
    return json({ ok: true });
  }
  return json({ error: 'not found' }, 404);
}

// 예약 / 당일예약 / 신환을 각각 따로: 직원마다 고객 수(취소 뺀 줄 수)·관리 종류별 건수·취소 수. 담당을 안 고른 줄은 '담당 없음'.
export function summarize(rows) {
  const out = {};
  for (const kind of BOOK_KINDS) {
    const by = new Map();
    for (const r of rows) {
      if (r.kind !== kind) continue;
      const key = r.staff_id ?? 0;
      const x = by.get(key) || { staff_id: r.staff_id ?? null, name: r.staff_id ? (r.name || `직원 ${r.staff_id}`) : '담당 없음', count: 0, cancelled: 0, care: Object.fromEntries(BOOK_CARE.map(k => [k, 0])) };
      if (r.cancelled) x.cancelled++;
      else { x.count++; for (const k of (r.care || '').split(',')) if (k in x.care) x.care[k]++; }
      by.set(key, x);
    }
    out[kind] = [...by.values()].sort((a, b) => (a.staff_id == null ? 1 : 0) - (b.staff_id == null ? 1 : 0) || (a.staff_id || 0) - (b.staff_id || 0));
  }
  return out;
}

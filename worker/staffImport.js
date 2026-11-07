// 예전 재고관리 앱(Genspark 호스팅)에서 직원 자료를 끌어와 이 사이트의 직원 DB(INV_DB)에 넣는다.
// 예전 앱의 공개 API(/api/staff/*)를 읽기만 한다. 주문·결제 자료는 가져오지 않는다.
// 화면이 단계별로 부른다: start(표 준비 + 직원·연차 이력) → month(달마다 근태·병원 휴일). 요청 하나당 외부 호출을 적게 유지.
import { INV_STAFF_SCHEMA } from './invSchema.js';

export const OLD_APP_URL = 'https://8ce98084-2f64-4a7f-bee9-80d23abd07b2.vip.gensparksite.com';
export const FIRST_MONTH = '2025-01';
const TABLES = ['staff', 'staff_attendance', 'staff_day_status', 'staff_leave_log', 'staff_info_log'];

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

async function oldGet(env, path) {
  const base = (env.OLD_INVENTORY_URL || OLD_APP_URL).replace(/\/$/, '');
  const res = await fetch(base + path, { headers: { accept: 'application/json' } });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error(`예전 앱이 자료 대신 다른 화면을 보냈어요(${res.status}). 예전 앱에 로그인이 걸려 있는지 확인해 주세요.`); }
  if (!res.ok) throw new Error(`예전 앱 오류(${res.status}): ${data?.error || ''}`.trim());
  return data;
}

async function ensureSchema(db) {
  const has = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='staff'`).first();
  if (has) return;
  for (const s of INV_STAFF_SCHEMA) await db.prepare(s).run();
}

const columnCache = new Map();
async function columns(db, table) {
  if (!columnCache.has(table)) columnCache.set(table, ((await db.prepare(`PRAGMA table_info(${table})`).all()).results || []).map(r => r.name));
  return columnCache.get(table);
}
// 예전 행의 키 중 이 표에 있는 칸만 그대로 넣는다(표 구조가 조금 달라도 들어가게)
async function upserts(db, table, rows) {
  const cols = await columns(db, table);
  return rows.map(row => {
    const keys = Object.keys(row).filter(k => cols.includes(k));
    return db.prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...keys.map(k => row[k] ?? null));
  });
}
async function runAll(db, statements) {
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
}

export function monthsUntil(last, first = FIRST_MONTH) {
  const out = [];
  let [y, m] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

export async function handleStaffImport(request, env) {
  if (!env.INV_DB) return json({ error: '직원 자료 데이터베이스가 연결되지 않았어요.' }, 503);
  if (request.method !== 'POST') return json({ error: '요청한 기능을 찾을 수 없습니다.' }, 404);
  const db = env.INV_DB;
  const body = await request.json().catch(() => ({}));
  try {
    if (body.step === 'start') {
      await ensureSchema(db);
      const staff = await oldGet(env, '/api/staff/list?include_retired=1');
      if (!Array.isArray(staff) || !staff.length) throw new Error('예전 앱에서 직원 목록을 받지 못했어요.');
      const logs = [], infos = [];
      for (const s of staff) {
        logs.push(...(await oldGet(env, `/api/staff/leave-log/${s.id}`) || []));
        infos.push(...(await oldGet(env, `/api/staff/info-log/${s.id}`) || []));
      }
      await runAll(db, TABLES.map(t => db.prepare(`DELETE FROM ${t}`)));
      await runAll(db, [...await upserts(db, 'staff', staff), ...await upserts(db, 'staff_leave_log', logs), ...await upserts(db, 'staff_info_log', infos)]);
      const now = new Date(Date.now() + 9 * 3600e3);
      const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      return json({ ok: true, staff: staff.length, leaveLogs: logs.length, months: monthsUntil(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`) });
    }
    if (body.step === 'month') {
      const month = String(body.month || '');
      if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: '월을 확인해 주세요.' }, 400);
      const ids = ((await db.prepare('SELECT id FROM staff').all()).results || []).map(r => r.id);
      const att = [], days = new Map();
      for (const id of ids) {
        const d = await oldGet(env, `/api/staff/month?staff_id=${id}&month=${month}`);
        att.push(...(d.attendance || []));
        for (const r of d.day_status || []) days.set(r.work_date, r);
      }
      await runAll(db, [...await upserts(db, 'staff_attendance', att), ...await upserts(db, 'staff_day_status', [...days.values()])]);
      return json({ ok: true, month, attendance: att.length });
    }
    return json({ error: '알 수 없는 단계예요.' }, 400);
  } catch (e) {
    return json({ error: String(e?.message || e).slice(0, 300) }, 502);
  }
}

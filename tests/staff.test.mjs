import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { handleApi } from '../worker/index.js';

function d1(sqlite) {
  return {
    prepare(sql) { const s = sqlite.prepare(sql); const b = (...v) => ({
      async first() { return s.get(...v) ?? null; }, async all() { return { results: s.all(...v) }; },
      async run() { return { meta: { changes: s.run(...v).changes } }; },
    }); return { bind: b, ...b() }; },
    async batch(list) { const r = []; for (const s of list) r.push(await s.run()); return r; },
  };
}
export function d1Exec(sqlite) { const db = d1(sqlite); db.exec = async sql => { sqlite.exec(sql); }; return db; }
// 빈 DB(실제 사이트와 같음) → 첫 요청 때 예전 앱 자료가 들어간다
function env() {
  const inv = new DatabaseSync(':memory:');
  return { inv, INV_DB: d1Exec(inv), DB: d1(new DatabaseSync(':memory:')) };
}
function req(path, { method = 'GET', body, owner = 'u1' } = {}) {
  const h = new Headers({ Origin: 'https://site.test' });
  if (owner) { h.set('oai-authenticated-user-id', owner); h.set('oai-authenticated-user-email', 'u1@test.invalid'); }
  if (body) { h.set('Content-Type', 'application/json'); body = JSON.stringify(body); }
  return new Request(`https://site.test${path}`, { method, headers: h, body });
}
const call = async (e, p, o) => { const r = await handleApi(req(p, o), e); return { status: r.status, data: await r.json() }; };

test('staff api needs login and works on an empty database', async () => {
  const e = env();
  assert.equal((await call(e, '/api/staff/list', { owner: null })).status, 401);
  const list = await call(e, '/api/staff/list');
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.length, 5);
  assert.equal((await call(e, '/api/staff/month?staff_id=1&month=2026-10')).status, 200);
});

test('recording a leave day deducts one leave like the old app', async () => {
  const e = env();
  await call(e, '/api/staff/list');
  const before = e.inv.prepare('SELECT used_leave FROM staff WHERE id = 2').get().used_leave;
  const r = await call(e, '/api/staff/attendance', { method: 'POST', body: { staff_id: 2, work_date: '2026-11-04', attendance: '연차' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(e.inv.prepare('SELECT used_leave FROM staff WHERE id = 2').get().used_leave, before + 1);
  const month = await call(e, '/api/staff/month?staff_id=2&month=2026-11');
  assert.equal(month.status, 200);
  assert.ok(JSON.stringify(month.data).includes('2026-11-04'));
  const dates = await call(e, '/api/staff/leave-dates?year=2026');
  assert.ok(JSON.stringify(dates.data).includes('2026-11-04'));
});

test('staff api says when the inventory database is not connected', async () => {
  const e = env(); delete e.INV_DB;
  const r = await call(e, '/api/staff/list');
  assert.equal(r.status, 503); assert.equal(r.data.unavailable, true);
});

test('a broken inventory database reports the cause and its tables', async () => {
  const e = env(); await call(e, '/api/staff/list'); e.inv.exec('DROP TABLE staff_leave_log');
  const r = await call(e, '/api/staff/list');
  assert.equal(r.status, 500);
  assert.match(r.data.detail, /staff_leave_log/);
  assert.ok(r.data.tables.includes('staff') && !r.data.tables.includes('staff_leave_log'));
});


test('full consultation day: leader managed stays empty, designated is recorded but left out of every performance number', async () => {
  const e = env(); await call(e, '/api/staff/list');
  const post = body => call(e, '/api/staff/attendance', { method: 'POST', body });
  // 팀장 풀상담, 관리인원 넣어도 저장 안 됨(0도 아님), 지정환자수는 기록
  await post({ staff_id: 1, work_date: '2026-10-05', attendance: '상담', managed_count: 4, designated_count: 3 });
  const lead = e.inv.prepare(`SELECT managed_count, designated_count FROM staff_attendance WHERE staff_id = 1 AND work_date = '2026-10-05'`).get();
  assert.deepEqual([lead.managed_count, lead.designated_count], [null, 3]);
  // 같은 날 직원 기록도 성과에서 빠짐
  await post({ staff_id: 2, work_date: '2026-10-05', attendance: '정상근무', start_time: '10:00', end_time: '19:30', managed_count: 5, designated_count: 2 });
  // 평소 날
  await post({ staff_id: 1, work_date: '2026-10-06', attendance: '정상근무', start_time: '10:00', end_time: '19:30', managed_count: 6, designated_count: 1 });
  await post({ staff_id: 2, work_date: '2026-10-06', attendance: '정상근무', start_time: '10:00', end_time: '19:30', managed_count: 4, designated_count: 1 });
  const perf = (await call(e, '/api/staff/performance?month=2026-10')).data;
  const kim = perf.find(r => r.id === 1), yoon = perf.find(r => r.id === 2);
  assert.deepEqual([kim.total_managed, kim.total_designated, kim.consult_designated], [6, 1, 3]);
  assert.deepEqual([yoon.total_managed, yoon.total_designated, yoon.consult_designated], [4, 1, 2]);
  assert.equal(yoon.total_hours, 9.5); // 풀상담일 근무시간도 빠짐
});

test('changing status keeps the original numbers; clinic closed day does not use leave', async () => {
  const e = env(); await call(e, '/api/staff/list');
  const post = body => call(e, '/api/staff/attendance', { method: 'POST', body });
  await post({ staff_id: 2, work_date: '2026-10-07', attendance: '정상근무', start_time: '10:00', end_time: '19:30', managed_count: 5, designated_count: 1 });
  await post({ staff_id: 2, work_date: '2026-10-07', attendance: '휴무' });
  const r = e.inv.prepare(`SELECT attendance, managed_count, designated_count, start_time FROM staff_attendance WHERE staff_id = 2 AND work_date = '2026-10-07'`).get();
  assert.deepEqual([r.attendance, r.managed_count, r.designated_count, r.start_time], ['휴무', 5, 1, '10:00']);
  const perf = (await call(e, '/api/staff/performance?month=2026-10')).data.find(x => x.id === 2);
  assert.equal(perf.total_managed, null); // 휴무 날 보존값은 성과에 안 들어감
  const before = e.inv.prepare('SELECT used_leave FROM staff WHERE id = 1').get().used_leave;
  await post({ staff_id: 1, work_date: '2026-10-08', attendance: '병원휴무' });
  assert.equal(e.inv.prepare('SELECT used_leave FROM staff WHERE id = 1').get().used_leave, before);
});

test('leave set and cleared on the schedule shows up the same on the leave screen data', async () => {
  const e = env();
  const used = async () => (await call(e, '/api/staff/list')).data.find(x => x.id === 3).used_leave;
  const has = async d => JSON.stringify((await call(e, '/api/staff/leave-dates?year=2026')).data.leave_dates?.['3'] || []).includes(d);
  const before = await used();
  assert.equal((await call(e, '/api/staff/attendance', { method: 'POST', body: { staff_id: 3, work_date: '2026-11-12', attendance: '연차' } })).status, 200);
  assert.equal(await used(), before + 1);
  assert.ok(await has('2026-11-12'));
  // 같은 날을 다시 정상근무로 바꾸면 연차가 되돌아가고 연차 날짜에서도 빠진다
  assert.equal((await call(e, '/api/staff/attendance', { method: 'POST', body: { staff_id: 3, work_date: '2026-11-12', attendance: '정상근무', start_time: '10:00', end_time: '19:30' } })).status, 200);
  assert.equal(await used(), before);
  assert.ok(!(await has('2026-11-12')));
});

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
  assert.deepEqual([kim.total_managed, kim.total_designated, kim.consult_designated], [7, 1, 3]); // 관리수 = 관리 6 + 지정 1
  assert.deepEqual([yoon.total_managed, yoon.total_designated, yoon.consult_designated], [5, 1, 2]);
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

test('performance follows the leader: designated adds to managed only on leader work days; partial leader day counts leader hours only', async () => {
  const e = env(); await call(e, '/api/staff/list');
  const post = body => call(e, '/api/staff/attendance', { method: 'POST', body });
  const perf = async () => (await call(e, '/api/staff/performance?month=2027-04')).data.find(x => x.id === 2);
  const staffDay = d => post({ staff_id: 2, work_date: d, attendance: '정상근무', start_time: '10:00', end_time: '19:30', managed_count: 6, designated_count: 2 });
  // 팀장 근태 미입력 → 근무시간·관리수 0(팀장 기준), 지정 환자 수는 지정 수에만
  await staffDay('2027-04-01');
  let p = await perf();
  assert.deepEqual([p.total_hours, p.total_managed, p.total_designated], [null, null, 2]);
  assert.match(p.exclusions[0].reason, /팀장 근태 미입력 · 팀장 기준 제외/);
  // 팀장 연차 → 같은 처리
  await post({ staff_id: 1, work_date: '2027-04-01', attendance: '연차' });
  p = await perf();
  assert.deepEqual([p.total_hours, p.total_managed, p.total_designated], [null, null, 2]);
  assert.match(p.exclusions[0].reason, /팀장 연차/);
  // 팀장 정상근무 → 관리수 = 6 + 2
  await post({ staff_id: 1, work_date: '2027-04-01', attendance: '정상근무', start_time: '10:00', end_time: '19:30' });
  p = await perf();
  assert.deepEqual([p.total_hours, p.total_managed, p.total_designated], [9.5, 8, 2]);
  // 팀장 2출(14:00~19:30) → 직원 근무시간은 팀장 근무시간과 겹친 5.5시간만
  await staffDay('2027-04-02');
  await post({ staff_id: 1, work_date: '2027-04-02', attendance: '기타', etc_type: 'time', etc_detail: '2시 출근', start_time: '14:00', end_time: '19:30' });
  p = await perf();
  assert.equal(p.total_hours, 15);
  assert.equal(p.total_managed, 16);
  // 팀장 2출 날은 관리 인원도 2시 이후만 적으므로 시간당 = 관리수 ÷ 실근무시간: 16 ÷ 15 = 1.1
  assert.equal(p.avg_managed, 1.1);
  assert.ok(p.exclusions.some(x => /팀장 2출 · 팀장 근무시간만 인정/.test(x.reason)));
});

test('on a full consultation day staff managed count is not taken either; designated is still recorded', async () => {
  const e = env(); await call(e, '/api/staff/list');
  const post = body => call(e, '/api/staff/attendance', { method: 'POST', body });
  await post({ staff_id: 1, work_date: '2027-05-03', attendance: '상담' });
  await post({ staff_id: 2, work_date: '2027-05-03', attendance: '정상근무', start_time: '10:00', end_time: '19:30', managed_count: 7, designated_count: 2 });
  const r = e.inv.prepare(`SELECT managed_count, designated_count FROM staff_attendance WHERE staff_id = 2 AND work_date = '2027-05-03'`).get();
  assert.deepEqual([r.managed_count, r.designated_count], [null, 2]);
});

test('leader off: staff managed is not taken, designated is; own day off closes both for anyone', async () => {
  const e = env(); await call(e, '/api/staff/list');
  const post = body => call(e, '/api/staff/attendance', { method: 'POST', body });
  const row = (id, d) => e.inv.prepare(`SELECT managed_count, designated_count FROM staff_attendance WHERE staff_id = ? AND work_date = ?`).get(id, d);
  await post({ staff_id: 1, work_date: '2027-06-02', attendance: '휴무', designated_count: 2 });
  assert.deepEqual([row(1, '2027-06-02').managed_count, row(1, '2027-06-02').designated_count], [null, null]);
  await post({ staff_id: 2, work_date: '2027-06-02', attendance: '기타', etc_type: 'time', etc_detail: '2시 출근', start_time: '14:00', end_time: '19:30', managed_count: 5, designated_count: 1 });
  assert.deepEqual([row(2, '2027-06-02').managed_count, row(2, '2027-06-02').designated_count], [null, 1]);
  const p = (await call(e, '/api/staff/performance?month=2027-06')).data.find(x => x.id === 2);
  assert.deepEqual([p.total_managed, p.total_designated], [null, 1]);
  // 직원 본인 연차면 지정 환자 수도 받지 않음
  await post({ staff_id: 3, work_date: '2027-06-03', attendance: '연차', designated_count: 2 });
  assert.equal(row(3, '2027-06-03').designated_count, null);
});

test('red days (sundays and 2026 public holidays) are clinic holidays on the schedule', async () => {
  const { build } = await import('esbuild');
  const out = await build({ entryPoints: ['src/app/staffRules.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
  const { isRedDay, calendarLines } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
  for (const d of ['2026-05-01', '2026-06-03', '2026-06-06', '2026-08-17', '2026-10-05', '2026-11-08']) assert.ok(isRedDay(d), d);
  assert.ok(!isRedDay('2026-11-09'));
  // 빨간 날에 아무도 기록이 없으면 '휴일'로만 보이고 '미입력'으로 세지 않음
  const staff = [{ id: 1, name: '김유리', is_leader: 1 }, { id: 2, name: '최윤희' }];
  const cell = calendarLines('2026-06-03', staff, () => null, isRedDay('2026-06-03'), {}, '2026-11-08');
  assert.deepEqual([cell.all, cell.none], ['휴일', 0]);
});

test('daily stock: leader work day check is reported, and saving is allowed any day', async () => {
  const e = env(); await call(e, '/api/staff/list');
  const daily = async d => (await call(e, `/api/inventory/daily?date=${d}`)).data;
  assert.deepEqual((await daily('2027-08-02')).check, { ok: false, label: '팀장 근태 미입력', skip: false });
  await call(e, '/api/staff/attendance', { method: 'POST', body: { staff_id: 1, work_date: '2027-08-02', attendance: '휴무' } });
  assert.deepEqual((await daily('2027-08-02')).check, { ok: false, label: '팀장 휴무', skip: true });
  // 팀장이 쉬는 날도 마감재고·총 피부관리 인원은 기록할 수 있다(화면이 당일 사용량만 닫음)
  const r = await call(e, '/api/inventory/daily', { method: 'POST', body: { date: '2027-08-02', patients: 5, used: {} } });
  assert.equal(r.status, 200);
  await call(e, '/api/staff/attendance', { method: 'POST', body: { staff_id: 1, work_date: '2027-08-03', attendance: '기타', etc_type: 'time', start_time: '14:00', end_time: '19:30' } });
  assert.equal((await daily('2027-08-03')).check.ok, true);
  assert.equal((await call(e, '/api/inventory/daily', { method: 'POST', body: { date: '2027-08-03', patients: 5, used: {} } })).status, 200);
  assert.equal((await daily('2026-05-01')).check.label, '휴일');
});

test('총 피부관리 인원 follows the managed counts entered in performance', async () => {
  const e = env(); await call(e, '/api/staff/list');
  const post = b => call(e, '/api/staff/attendance', { method: 'POST', body: b });
  await post({ staff_id: 1, work_date: '2027-09-01', attendance: '정상근무', start_time: '10:00', end_time: '19:30', managed_count: 6, designated_count: 2 });
  await post({ staff_id: 2, work_date: '2027-09-01', attendance: '정상근무', start_time: '10:00', end_time: '19:30', managed_count: 5 });
  const day = (await call(e, '/api/inventory/daily?date=2027-09-01')).data;
  assert.deepEqual([day.patients_auto, day.day.patients], [11, 11]);
  await post({ staff_id: 2, work_date: '2027-09-01', attendance: '정상근무', start_time: '10:00', end_time: '19:30', managed_count: 7 });
  assert.equal((await call(e, '/api/inventory/daily?date=2027-09-01')).data.day.patients, 13);
  // 일일재고에서 다른 숫자를 보내도 성과 합계가 우선
  await call(e, '/api/inventory/daily', { method: 'POST', body: { date: '2027-09-01', patients: 99, used: {} } });
  assert.equal((await call(e, '/api/inventory/daily?date=2027-09-01')).data.day.patients, 13);
  // 관리 인원이 없는 날은 직접 적은 값
  await call(e, '/api/inventory/daily', { method: 'POST', body: { date: '2027-09-02', patients: 15, used: {} } });
  assert.equal((await call(e, '/api/inventory/daily?date=2027-09-02')).data.day.patients, 15);
});

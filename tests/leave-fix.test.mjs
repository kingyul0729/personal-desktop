import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { handleApi } from '../worker/index.js';

// 연차 기록 수정·취소(2026-11-20 사용자 지정): 기록은 지우지 않고 취소 표시 + 정정 줄, 지급·사용연차는 차이만 반영, 잔여는 다시 계산.
function d1(sqlite) {
  return {
    prepare(sql) { const s = sqlite.prepare(sql); const b = (...v) => ({
      async first() { return s.get(...v) ?? null; }, async all() { return { results: s.all(...v) }; },
      async run() { const r = s.run(...v); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
    }); return { bind: b, ...b() }; },
    async batch(list) { const r = []; for (const s of list) r.push(await s.run()); return r; },
    async exec(sql) { sqlite.exec(sql); },
  };
}
const env = () => { const inv = new DatabaseSync(':memory:'); return { inv, INV_DB: d1(inv), DB: d1(new DatabaseSync(':memory:')) }; };
const call = async (e, p, body) => { const h = new Headers({ Origin: 'https://site.test', 'oai-authenticated-user-id': 'u1', 'oai-authenticated-user-email': 'a@b.c' });
  if (body) h.set('Content-Type', 'application/json');
  const r = await handleApi(new Request(`https://site.test/api/staff${p}`, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined }), e);
  return { status: r.status, data: await r.json() }; };
const me = async e => (await call(e, '/list')).data.find(x => x.id === 2);
const logs = async e => (await call(e, '/leave-log/2')).data;
const att = (date, attendance, extra = {}) => ({ staff_id: 2, work_date: date, attendance, etc_type: null, etc_detail: null, record_mode: null, start_time: null, end_time: null, manual_adjust: 0, work_minutes: null, adjust_reason: null, managed_count: null, designated_count: null, memo: null, ...extra });

test('연차 지급: 지급일·지급일수 수정, 취소 → 지급연차·잔여 다시 계산, 취소된 기록은 다시 못 고침', async () => {
  const e = env();
  const s0 = await me(e);
  await call(e, '/leave-grant/2', {});
  let g = (await logs(e)).find(l => l.log_type === 'grant');
  assert.equal(g.can_fix, true);
  assert.equal((await call(e, `/leave-fix/${g.id}`, { action: 'edit', amount: 2, date: '2026-11-01' })).status, 400); // 사유 필수
  const r = await call(e, `/leave-fix/${g.id}`, { action: 'edit', amount: 2, date: '2026-11-01', reason: '두 달치' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await me(e)).total_leave, s0.total_leave + 2);
  let ls = await logs(e);
  g = ls.find(l => l.id === g.id);
  assert.deepEqual([g.amount, g.log_date], [2, '2026-11-01']);
  const fix = ls.find(l => l.log_type === 'fix');
  assert.deepEqual([fix.before_total, fix.after_total, fix.reason], [s0.total_leave + 1, s0.total_leave + 2, '두 달치']);
  assert.equal(fix.can_fix, false);
  // 취소
  assert.equal((await call(e, `/leave-fix/${g.id}`, { action: 'cancel', reason: '중복 지급' })).status, 200);
  const s1 = await me(e);
  assert.equal(s1.total_leave, s0.total_leave);
  assert.equal(s1.remain_leave, s0.total_leave - s0.used_leave);
  ls = await logs(e);
  g = ls.find(l => l.id === g.id);
  assert.ok(g.cancelled_at); assert.equal(g.cancel_reason, '중복 지급'); assert.equal(g.can_fix, false);
  assert.equal((await call(e, `/leave-fix/${g.id}`, { action: 'cancel', reason: 'x' })).status, 409); // 재취소 불가
  // 맨 위 줄 잔여 = 지금 잔여, 그 아래는 뒤 기록 증감을 뺀 값
  assert.equal(ls[0].remain_now, s1.remain_leave);
});

test('연차 수동 수정: 수치 정정·취소, 잔여가 0보다 적어지면 막음', async () => {
  const e = env();
  const s0 = await me(e);
  await call(e, '/leave-adjust/2', { total_leave: s0.total_leave + 3, used_leave: s0.used_leave, reason: '포상 연차 지급' });
  let a = (await logs(e)).find(l => l.log_type === 'adjust');
  assert.equal((await call(e, `/leave-fix/${a.id}`, { action: 'edit', total: s0.total_leave + 1, used: s0.used_leave, reason: '1일만' })).status, 200);
  assert.equal((await me(e)).total_leave, s0.total_leave + 1);
  // 뒤에 다른 기록(월 지급)이 있어도 차이만 반영
  await call(e, '/leave-grant/2', {});
  assert.equal((await call(e, `/leave-fix/${a.id}`, { action: 'cancel', reason: '잘못 누름' })).status, 200);
  assert.equal((await me(e)).total_leave, s0.total_leave + 1); // +1(지급)만 남음
  // 잔여 0에서 지급 취소 → 막음
  const s1 = await me(e);
  await call(e, '/leave-adjust/2', { total_leave: s1.total_leave, used_leave: s1.total_leave, reason: '직접 입력' });
  const g = (await logs(e)).find(l => l.log_type === 'grant' && !l.cancelled_at);
  assert.equal((await call(e, `/leave-fix/${g.id}`, { action: 'cancel', reason: 'x' })).status, 409);
});

test('연차 사용: 사용일 수정(스케줄 같이 옮김)·취소(그날 근태 고름) → 사용연차 그대로/−1, 기록은 취소 표시', async () => {
  const e = env();
  await me(e);
  assert.equal((await call(e, '/attendance', att('2026-11-04', '연차'))).status, 200);
  const s0 = await me(e);
  let u = (await logs(e)).find(l => l.log_type === 'use' && l.log_date === '2026-11-04');
  assert.equal(u.can_fix, true);
  // 스케줄을 안 바꾸고 부르면 막음
  assert.equal((await call(e, `/leave-fix/${u.id}`, { action: 'use-cancel', reason: 'x' })).status, 409);
  // 사용일 11/4 → 11/5: 11/5 연차, 11/4 정상근무로 바꾼 뒤 표시
  await call(e, '/attendance', att('2026-11-05', '연차'));
  await call(e, '/attendance', att('2026-11-04', '정상근무', { start_time: '10:00', end_time: '19:30' }));
  assert.equal((await call(e, `/leave-fix/${u.id}`, { action: 'use-move', date: '2026-11-05', reason: '날짜 잘못 누름' })).status, 200);
  assert.equal((await me(e)).used_leave, s0.used_leave);
  let ls = await logs(e);
  assert.ok(ls.find(l => l.id === u.id).cancelled_at);
  const fix = ls.find(l => l.log_type === 'fix');
  assert.match(fix.memo, /11\/4 → 11\/5/);
  assert.equal(ls.find(l => l.log_type === 'revert' && l.log_date === '2026-11-04').ref_id, fix.id); // 자동 되돌림은 정정에 묶임
  // 11/5 사용 취소 → 휴무
  u = ls.find(l => l.log_type === 'use' && l.log_date === '2026-11-05');
  assert.equal(u.can_fix, true);
  await call(e, '/attendance', att('2026-11-05', '휴무'));
  assert.equal((await call(e, `/leave-fix/${u.id}`, { action: 'use-cancel', reason: '안 씀' })).status, 200);
  const s2 = await me(e);
  assert.equal(s2.used_leave, s0.used_leave - 1);
  ls = await logs(e);
  const f2 = ls.find(l => l.log_type === 'fix' && /취소/.test(l.memo));
  assert.deepEqual([f2.before_used, f2.after_used], [s0.used_leave, s0.used_leave - 1]);
});

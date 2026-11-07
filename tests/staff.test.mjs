import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
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
function env() {
  const inv = new DatabaseSync(':memory:');
  inv.exec(readFileSync(new URL('./fixtures/inv-staff.sql', import.meta.url), 'utf8'));
  return { inv, INV_DB: d1(inv), DB: d1(new DatabaseSync(':memory:')) };
}
function req(path, { method = 'GET', body, owner = 'u1' } = {}) {
  const h = new Headers({ Origin: 'https://site.test' });
  if (owner) { h.set('oai-authenticated-user-id', owner); h.set('oai-authenticated-user-email', 'u1@test.invalid'); }
  if (body) { h.set('Content-Type', 'application/json'); body = JSON.stringify(body); }
  return new Request(`https://site.test${path}`, { method, headers: h, body });
}
const call = async (e, p, o) => { const r = await handleApi(req(p, o), e); return { status: r.status, data: await r.json() }; };

test('staff api needs login and reads the old inventory database', async () => {
  const e = env();
  assert.equal((await call(e, '/api/staff/list', { owner: null })).status, 401);
  const list = await call(e, '/api/staff/list');
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.map(s => s.name).slice(0, 1), ['김유리']);
  assert.equal(list.data.length, 5);
});

test('recording a leave day deducts one leave like the old app', async () => {
  const e = env();
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
  const e = env(); e.inv.exec('DROP TABLE staff_leave_log');
  const r = await call(e, '/api/staff/list');
  assert.equal(r.status, 500);
  assert.match(r.data.detail, /staff_leave_log/);
  assert.ok(r.data.tables.includes('staff') && !r.data.tables.includes('staff_leave_log'));
});

test('importing from the old app fills an empty database with staff, attendance and leave history', async t => {
  const e = env(); e.inv.close();
  e.inv = new DatabaseSync(':memory:'); e.INV_DB = d1(e.inv); // 빈 DB(실제 사이트와 같은 상태)
  const old = {
    '/api/staff/list?include_retired=1': [{ id: 7, name: '김유리', position: '팀장', is_leader: 1, hire_date: '2018-03-02', status: 'active', total_leave: 16, used_leave: 3, remain_leave: 13, personal_color: '#EFA7B7' }],
    '/api/staff/leave-log/7': [{ id: 1, staff_id: 7, log_type: 'use', log_date: '2026-10-02', amount: 1, after_remain: 13 }],
    '/api/staff/info-log/7': [],
  };
  t.mock.method(globalThis, 'fetch', async url => {
    const path = new URL(url).pathname + new URL(url).search;
    if (path.startsWith('/api/staff/month')) {
      const m = new URL(url).searchParams.get('month');
      return Response.json(m === '2026-10' ? { attendance: [{ id: 9, staff_id: 7, work_date: '2026-10-02', attendance: '연차', summary_only: 1 }], day_status: [{ work_date: '2026-10-09', status: 'clinic_off' }] } : { attendance: [], day_status: [] });
    }
    return Response.json(old[path] ?? { error: 'nope' }, { status: old[path] ? 200 : 404 });
  });
  const start = await call(e, '/api/staff-import', { method: 'POST', body: { step: 'start' } });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  assert.equal(start.data.months[0], '2025-01');
  for (const month of start.data.months) assert.equal((await call(e, '/api/staff-import', { method: 'POST', body: { step: 'month', month } })).status, 200);
  const list = await call(e, '/api/staff/list');
  assert.deepEqual(list.data.map(s => [s.name, s.total_leave, s.used_leave]), [['김유리', 16, 3]]);
  assert.equal(e.inv.prepare("SELECT attendance FROM staff_attendance WHERE work_date='2026-10-02'").get().attendance, '연차');
  assert.equal(e.inv.prepare('SELECT COUNT(*) n FROM staff_day_status').get().n, 1);
  assert.equal(e.inv.prepare('SELECT COUNT(*) n FROM staff_leave_log').get().n, 1);
});

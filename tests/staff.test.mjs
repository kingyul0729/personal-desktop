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

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
    async exec(sql) { sqlite.exec(sql); },
  };
}
function bucket() {
  const m = new Map();
  return { m, async put(k, v) { m.set(k, new Uint8Array(v)); }, async get(k) { return m.has(k) ? { body: m.get(k) } : null; }, async delete(k) { m.delete(k); } };
}
const env = () => ({ INV_DB: d1(new DatabaseSync(':memory:')), DB: d1(new DatabaseSync(':memory:')), BUCKET: bucket() });
const H = () => new Headers({ Origin: 'https://site.test', 'oai-authenticated-user-id': 'u1', 'oai-authenticated-user-email': 'lead@clinic.test' });
async function call(e, path, method = 'GET', body) {
  const h = H(); if (body) h.set('Content-Type', 'application/json');
  const r = await handleApi(new Request(`https://site.test/api/edu${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), e);
  return { status: r.status, data: await r.json() };
}

test('신입교육: trainee, lead/staff checks with teacher name, eval days, attached manuals', async () => {
  const e = env();
  assert.deepEqual((await call(e, '/state')).data, { trainees: [], docs: [] });
  assert.equal((await call(e, '/trainees', 'POST', { name: '' })).status, 400);
  const add = await call(e, '/trainees', 'POST', { name: '지은', start_date: '2026-11-10' });
  const id = add.data.id;
  // 팀장 교육은 이름 없이 '팀장'
  const lead = await call(e, '/check', 'POST', { trainee_id: id, key: 'd1-l1', on: true });
  assert.equal(lead.data.trainees[0].checks['d1-l1'].teacher, '팀장');
  // 직원 교육은 가르친 직원 이름이 꼭 있어야 함
  assert.equal((await call(e, '/check', 'POST', { trainee_id: id, key: 'd1-s1', on: true })).status, 400);
  const st = await call(e, '/check', 'POST', { trainee_id: id, key: 'd1-s1', on: true, teacher: '하늘' });
  assert.equal(st.data.trainees[0].checks['d1-s1'].teacher, '하늘');
  // 체크 풀기
  const off = await call(e, '/check', 'POST', { trainee_id: id, key: 'd1-s1', on: false });
  assert.equal(off.data.trainees[0].checks['d1-s1'], undefined);
  assert.equal((await call(e, '/check', 'POST', { trainee_id: id, key: 'd21-l1', on: true })).status, 400);
  // 평가일만
  assert.equal((await call(e, '/eval', 'POST', { trainee_id: id, day: 4, result: 'pass' })).status, 400);
  assert.equal((await call(e, '/eval', 'POST', { trainee_id: id, day: 5, result: 'more' })).data.trainees[0].evals['5'].result, 'more');
  assert.equal((await call(e, '/eval', 'POST', { trainee_id: id, day: 5, result: null })).data.trainees[0].evals['5'], undefined);
  // 매뉴얼 자료(사진·PDF만)
  const fd = new FormData(); fd.set('item_key', 'd1-l2'); fd.set('file', new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3])], '장비 구별.pdf'));
  const up = await handleApi(new Request('https://site.test/api/edu/docs', { method: 'POST', headers: H(), body: fd }), e);
  const upd = await up.json();
  assert.equal(up.status, 200, JSON.stringify(upd));
  assert.deepEqual(upd.docs.map(d => [d.item_key, d.name, d.mime]), [['d1-l2', '장비 구별.pdf', 'application/pdf']]);
  const file = await handleApi(new Request(`https://site.test/api/edu/docs/${upd.docs[0].id}/file`, { headers: H() }), e);
  assert.equal(file.headers.get('content-type'), 'application/pdf');
  const txt = new FormData(); txt.set('item_key', 'd1-l2'); txt.set('file', new File(['hello'], 'a.txt'));
  assert.equal((await handleApi(new Request('https://site.test/api/edu/docs', { method: 'POST', headers: H(), body: txt }), e)).status, 400);
  const del = await call(e, `/docs/${upd.docs[0].id}`, 'DELETE');
  assert.equal(del.data.docs.length, 0);
  assert.equal(e.BUCKET.m.size, 0);
  // 신입 수정·삭제
  assert.equal((await call(e, `/trainees/${id}`, 'PATCH', { name: '지은', start_date: '2026-11-11' })).data.trainees[0].start_date, '2026-11-11');
  assert.equal((await call(e, `/trainees/${id}`, 'DELETE')).data.trainees.length, 0);
  // 로그인 안 하면 막힘
  const anon = await handleApi(new Request('https://site.test/api/edu/state'), e);
  assert.equal(anon.status, 401);
});

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
    // D1 batch는 한 트랜잭션: 하나라도 실패하면 모두 되돌린다
    async batch(list) { sqlite.exec('BEGIN'); try { const r = []; for (const s of list) r.push(await s.run()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } },
    async exec(sql) { sqlite.exec(sql); },
  };
}
function env(o = {}) { const inv = new DatabaseSync(':memory:'); return { inv, INV_DB: d1(inv), DB: d1(new DatabaseSync(':memory:')), SKIP_OLD_DAILY_FIX: !o.oldDailyFix }; }
const authH = () => new Headers({ Origin: 'https://site.test', 'oai-authenticated-user-id': 'u1', 'oai-authenticated-user-email': 'u1@test.invalid' });
async function call(e, path, method = 'GET', body) {
  const h = authH();
  if (body) h.set('Content-Type', 'application/json');
  const r = await handleApi(new Request(`https://site.test/api/inventory${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), e);
  return { status: r.status, data: await r.json() };
}

test('업체 잔액: 등록 → 주문 차감(모자라면 나머지만 결제) → 환급, 보고서는 실제 결제만 지출', async () => {
  const e = env();
  const st = (await call(e, '/state')).data;
  const ga = st.items.find(i => i.name === 'GA30%'), opt = ga.options[0]; // 중외(3) · 1개 47,272원
  const month = st.today.slice(0, 7), d = `${month}-01`;
  // 등록: 사유 꼭, 금액 > 0
  assert.equal((await call(e, '/vendor-bal', 'POST', { kind: 'add', vendor_id: 3, amount: 1000, date: d })).status, 400);
  const add = await call(e, '/vendor-bal', 'POST', { kind: 'add', vendor_id: 3, amount: 100000, date: d, reason: '중복 결제', memo: '2025-10-30 같은 금액 두 번' });
  assert.equal(add.status, 200, JSON.stringify(add.data));
  assert.equal(add.data.vendors.find(v => v.id === 3).balance, 100000);
  // 주문할 때 '업체 잔액에서 차감'(부가세 포함): 1개 47,272원 → 51,999 차감 → 잔액 48,001
  const o1 = await call(e, '/orders', 'POST', { item_id: ga.id, option_id: opt.id, count: 1, date: d, use_balance: true });
  assert.equal(o1.data.used, 51999);
  // 잔액보다 큰 주문: 3개 141,816원 → 48,001만 차감, 보고서에는 앱 가격 기준 48,001 ÷ 1.1 = 43,637만 빠짐
  const o2 = await call(e, '/orders', 'POST', { item_id: ga.id, option_id: opt.id, count: 3, date: d, use_balance: true });
  assert.equal(o2.data.used, 48001);
  let s = (await call(e, '/state')).data;
  assert.equal(s.vendors.find(v => v.id === 3).balance, 0);
  const rep = (await call(e, `/report?month=${month}`)).data;
  assert.equal(rep.spend_buy, 47272 * 4);
  assert.equal(rep.bal_used, 47272 + 43637);
  assert.equal(rep.spend_total, 47272 * 4 - 47272 - 43637); // 실제 결제 = 구매 − 잔액 차감(두 번 안 셈)
  const jw = rep.payments.find(p => p.vendor_id === 3);
  assert.equal(jw.amount, 47272 * 3 - 43637); assert.equal(jw.bal_used, 47272 + 43637);
  assert.deepEqual(rep.vendor_bal.map(r => [r.name, r.added, r.used, r.refund, r.after]), [['중외', 100000, 100000, 0, 0]]);
  // 주문 취소 → 그 주문의 차감이 돌아옴
  const orderId = s.orders.find(o => o.qty === 1 && o.item_id === ga.id).id;
  await call(e, `/orders/${orderId}/cancel`, 'POST');
  s = (await call(e, '/state')).data;
  assert.equal(s.vendors.find(v => v.id === 3).balance, 51999);
  // 이미 한 주문을 골라 차감(주문 때 체크 못 한 경우) — 남은 만큼만
  const o3 = await call(e, '/orders', 'POST', { item_id: ga.id, option_id: opt.id, count: 2, date: d });
  assert.equal(o3.data.used, 0);
  const vb = (await call(e, '/vendor-bal')).data;
  const pickable = vb.orders.find(o => o.amount === 94544);
  const use = await call(e, '/vendor-bal', 'POST', { kind: 'use', order_id: pickable.id });
  assert.equal(use.data.used, 51999);
  assert.equal((await call(e, '/vendor-bal', 'POST', { kind: 'use', order_id: pickable.id })).status, 409);
  // 환급: 남은 금액보다 많이 안 됨 / 등록을 지우면 마이너스가 되는 경우 막음
  await call(e, '/vendor-bal', 'POST', { kind: 'add', vendor_id: 3, amount: 30000, date: d, reason: '반품' });
  assert.equal((await call(e, '/vendor-bal', 'POST', { kind: 'refund', vendor_id: 3, amount: 30001, date: d })).status, 409);
  const rf = await call(e, '/vendor-bal', 'POST', { kind: 'refund', vendor_id: 3, amount: 30000, date: d, memo: '환급 입금' });
  assert.equal(rf.data.vendors.find(v => v.id === 3).balance, 0);
  const first = rf.data.rows.find(r => r.kind === 'add' && r.amount === 100000);
  assert.equal((await call(e, `/vendor-bal/${first.id}`, 'DELETE')).status, 409);
  const rep2 = (await call(e, `/report?month=${month}`)).data;
  assert.equal(rep2.bal_refund, 30000);
  assert.equal(rep2.spend_total, rep2.spend_buy - rep2.bal_used);
  const yr = (await call(e, `/report-year?year=${month.slice(0, 4)}`)).data;
  assert.equal(yr.vendor_bal[0].after, 0);
});

test('jwbal2: 실제 사이트만 — 2025-10-30 중복 결제 347,994 등록 + 5월 중화제 3개(54,543원, 병원재고 그대로)를 잔액으로 차감, jwbal1 줄은 지움', async () => {
  const { resetInvSchemaCache } = await import('../worker/invSchema.js');
  const e = env();
  const st = (await call(e, '/state')).data;
  assert.equal(st.vendors.find(v => v.id === 3).balance, 0); // 예전 자료가 없으면 안 함
  const ga = st.items.find(i => i.name === 'GA20%'), jh = st.items.find(i => i.name === '중화제');
  await call(e, '/orders', 'POST', { item_id: ga.id, option_id: ga.options[0].id, count: 1, date: '2026-11-12' });
  e.inv.prepare(`INSERT INTO inv_meta (key, value) VALUES ('import', 'x')`).run();
  resetInvSchemaCache();
  const vb = (await call(e, '/vendor-bal')).data;
  assert.equal(vb.vendors.find(v => v.id === 3).balance, 144001); // 5월 54,543 × 1.1 + 11월(jwnov1) 39,998 + 103,998
  assert.deepEqual(vb.rows.filter(r => r.date < '2026-11-01').map(r => [r.date, r.kind, r.amount]), [['2026-05-06', 'use', 59997], ['2025-10-30', 'add', 347994]]);
  const s2 = (await call(e, '/state')).data;
  assert.equal(s2.items.find(i => i.id === jh.id).hospital_stock, jh.hospital_stock); // 재고 그대로
  assert.equal(s2.orders.some(o => o.ordered_at === '2026-05-06'), false);
  assert.equal(s2.orders.filter(o => o.ordered_at === '2026-11-20' && o.qty === 2).length, 2); // 11월 받을 주문 // 받기 전 목록에 안 뜸
  const may = (await call(e, '/report?month=2026-05')).data;
  const p = may.payments.find(x => x.vendor_id === 3);
  assert.equal(p.status, '잔액 차감'); assert.equal(p.amount, 0); assert.equal(may.spend_total, 0);
  assert.deepEqual(p.lines.map(l => [l.item, l.qty, l.invoice]), [['중화제', 3, 'missing']]); // 명세서는 사용자가 올림
  assert.deepEqual(vb.rows.filter(r => r.kind === 'use').map(r => r.amount).sort(), [103998, 39998, 59997].sort());
  resetInvSchemaCache(); await call(e, '/state');
  assert.equal((await call(e, '/vendor-bal')).data.rows.length, 4);
});

test('jwvat1: 주문 금액 그대로 뺀 차감을 부가세 포함(× 1.1)으로 — 남은 금액이 0보다 적어지지 않게', async () => {
  const { resetInvSchemaCache } = await import('../worker/invSchema.js');
  const e = env();
  const st = (await call(e, '/state')).data;
  const ga = st.items.find(i => i.name === 'GA30%'), opt = ga.options[0];
  const d = `${st.today.slice(0, 7)}-01`;
  await call(e, '/vendor-bal', 'POST', { kind: 'add', vendor_id: 3, amount: 347994, date: d, reason: '중복 결제' });
  await call(e, '/orders', 'POST', { item_id: ga.id, option_id: opt.id, count: 1, date: d, use_balance: true });
  // 예전 방식 차감(주문 금액 그대로)으로 되돌려 둔 뒤 고치기를 다시 돌림
  e.inv.prepare(`UPDATE inv_vendor_bal SET amount = 47272 WHERE kind = 'use'`).run();
  e.inv.prepare(`UPDATE inv_meta SET value = replace(value, 'jwvat1', '') WHERE key = 'fixes'`).run();
  e.inv.prepare(`DELETE FROM inv_meta WHERE key = 'lock_jwvat1'`).run();
  resetInvSchemaCache();
  const vb = (await call(e, '/vendor-bal')).data;
  assert.equal(vb.vendors.find(v => v.id === 3).balance, 347994 - 51999);
  const rep = (await call(e, `/report?month=${d.slice(0, 7)}`)).data;
  assert.equal(rep.bal_used, 47272); assert.equal(rep.spend_total, 0); // 보고서는 앱 가격 기준: 다 잔액으로 냄
});

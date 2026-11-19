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
  // 주문할 때 '업체 잔액에서 차감': 1개 47,272원 → 잔액 52,728
  const o1 = await call(e, '/orders', 'POST', { item_id: ga.id, option_id: opt.id, count: 1, date: d, use_balance: true });
  assert.equal(o1.data.used, 47272);
  // 잔액보다 큰 주문: 3개 141,816원 → 52,728만 차감, 나머지 89,088원이 실제 결제
  const o2 = await call(e, '/orders', 'POST', { item_id: ga.id, option_id: opt.id, count: 3, date: d, use_balance: true });
  assert.equal(o2.data.used, 52728);
  let s = (await call(e, '/state')).data;
  assert.equal(s.vendors.find(v => v.id === 3).balance, 0);
  const rep = (await call(e, `/report?month=${month}`)).data;
  assert.equal(rep.spend_buy, 47272 * 4);
  assert.equal(rep.bal_used, 100000);
  assert.equal(rep.spend_total, 47272 * 4 - 100000); // 실제 결제 = 구매 − 잔액 차감(두 번 안 셈)
  const jw = rep.payments.find(p => p.vendor_id === 3);
  assert.equal(jw.amount, 47272 * 4 - 100000); assert.equal(jw.bal_used, 100000);
  assert.deepEqual(rep.vendor_bal.map(r => [r.name, r.added, r.used, r.refund, r.after]), [['중외', 100000, 100000, 0, 0]]);
  // 주문 취소 → 그 주문의 차감이 돌아옴
  const orderId = s.orders.find(o => o.qty === 1 && o.item_id === ga.id).id;
  await call(e, `/orders/${orderId}/cancel`, 'POST');
  s = (await call(e, '/state')).data;
  assert.equal(s.vendors.find(v => v.id === 3).balance, 47272);
  // 이미 한 주문을 골라 차감(주문 때 체크 못 한 경우) — 남은 만큼만
  const o3 = await call(e, '/orders', 'POST', { item_id: ga.id, option_id: opt.id, count: 2, date: d });
  assert.equal(o3.data.used, 0);
  const vb = (await call(e, '/vendor-bal')).data;
  const pickable = vb.orders.find(o => o.amount === 94544);
  const use = await call(e, '/vendor-bal', 'POST', { kind: 'use', order_id: pickable.id });
  assert.equal(use.data.used, 47272);
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

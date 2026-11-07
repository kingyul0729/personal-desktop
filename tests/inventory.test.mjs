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
function env() { const inv = new DatabaseSync(':memory:'); return { inv, INV_DB: d1(inv), DB: d1(new DatabaseSync(':memory:')) }; }
async function call(e, path, method = 'GET', body) {
  const h = new Headers({ Origin: 'https://site.test', 'oai-authenticated-user-id': 'u1', 'oai-authenticated-user-email': 'u1@test.invalid' });
  if (body) h.set('Content-Type', 'application/json');
  const r = await handleApi(new Request(`https://site.test/api/inventory${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), e);
  return { status: r.status, data: await r.json() };
}
const item = (e, name) => e.inv.prepare('SELECT * FROM inv_items WHERE name = ?').get(name);

test('starts with the confirmed price list; old app numbers come in once from a file', async () => {
  const e = env();
  const s = await call(e, '/state');
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.equal(s.data.imported, null);
  const by = n => s.data.items.find(i => i.name === n);
  assert.equal(by('GA30%').price, 47272);
  assert.equal(by('알라딘 필링 파우더').price, null); // 단가 미확인은 0원으로 바꾸지 않음
  assert.equal(by('면봉').price, null);
  assert.deepEqual(by('이온토P').options.map(o => [o.qty, o.amount]), [[1, 7000], [50, 350000]]);
  assert.deepEqual(by('카프리가스').options.map(o => [o.qty, o.amount]), [[1, 44000], [5, 220000]]);
  assert.equal(s.data.vendors.length, 16);
  assert.equal(s.data.vendors.find(v => v.name === '하라셀').contact, null); // 연락처는 공개 코드에 없음
  // 예전 자료 넣기
  const pack = by('보관용 3종 시트팩');
  assert.equal((await call(e, '/import', 'POST', { step: 'rows', table: 'inv_items', rows: [] })).status, 400); // start 먼저
  assert.equal((await call(e, '/import', 'POST', { step: 'start' })).status, 200);
  await call(e, '/import', 'POST', { step: 'rows', table: 'inv_vendors', rows: [{ id: 4, name: '하라셀', contact: '010-0000-0000', bogus: 1 }] });
  await call(e, '/import', 'POST', { step: 'rows', table: 'inv_items', rows: [{ ...pack, options: undefined, hospital_stock: 6, vendor_stock: 300 }] });
  await call(e, '/import', 'POST', { step: 'rows', table: 'inv_tx', rows: [{ id: 1, date: '2026-10-01', kind: 'in', item_id: pack.id, qty: 6, amount: 264000, hospital_delta: 6, invoice: 1 }] });
  await call(e, '/import', 'POST', { step: 'rows', table: 'inv_daily', rows: [{ date: '2026-10-01', patients: 19 }] });
  assert.equal((await call(e, '/import', 'POST', { step: 'rows', table: 'users', rows: [{}] })).status, 400); // 정해진 표만
  await call(e, '/import', 'POST', { step: 'finish', label: 'old-app-data.json' });
  const after = await call(e, '/state');
  assert.ok(after.data.imported);
  assert.deepEqual([after.data.items[0].hospital_stock, after.data.items[0].vendor_stock], [6, 300]);
  assert.equal(after.data.vendors[0].contact, '010-0000-0000');
  const oct = await call(e, '/report?month=2026-10');
  assert.deepEqual([oct.data.patients, oct.data.spend_general], [19, 264000]);
  assert.equal((await call(e, '/import', 'POST', { step: 'start' })).status, 409); // 한 번만
});

test('general purchase: the chosen condition sets the price, only the arrived quantity enters stock, bonus is free', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, '이온토P');
  const box = e.inv.prepare('SELECT id FROM inv_options WHERE item_id = ? AND qty = 50').get(it.id);
  const opt = (await call(e, '/options', 'POST', { item_id: it.id, label: '10+1 행사', qty: 10, bonus_qty: 1, amount: 70000 })).data.items.find(i => i.id === it.id).options.find(o => o.label === '10+1 행사');
  assert.equal((await call(e, '/orders', 'POST', { item_id: it.id, option_id: opt.id, count: 2 })).status, 200);
  const order = (await call(e, '/state')).data.orders.find(o => o.item_id === it.id);
  assert.deepEqual([order.qty, order.bonus_qty, order.amount], [20, 2, 140000]);
  // 22개 올 예정이었지만 21개 도착 → 병원재고 +21, 결제금액은 그대로
  assert.equal((await call(e, '/receive', 'POST', { order_id: order.id, actual_qty: 21, date: '2026-11-09' })).status, 200);
  assert.equal(item(e, '이온토P').hospital_stock, it.hospital_stock + 21);
  const tx = e.inv.prepare(`SELECT * FROM inv_tx WHERE order_id = ?`).get(order.id);
  assert.deepEqual([tx.amount, tx.hospital_delta, tx.vendor_delta], [140000, 21, 0]);
  // 박스 단위 조건은 등록된 구성수량 50으로 계산
  await call(e, '/orders', 'POST', { item_id: it.id, option_id: box.id, count: 1 });
  assert.equal((await call(e, '/state')).data.orders.find(o => o.option_id === box.id).qty, 50);
  // 입고 삭제 → 병원재고 다시 차감, 주문은 받기 전으로
  assert.equal((await call(e, `/tx/${tx.id}`, 'DELETE')).status, 200);
  assert.equal(item(e, '이온토P').hospital_stock, it.hospital_stock);
  assert.equal(e.inv.prepare('SELECT status FROM inv_orders WHERE id = ?').get(order.id).status, 'ordered');
});

test('prepaid: paying creates the keep balance, receive confirm deducts it and adds hospital stock together', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, '보관용 3종 시트팩');
  await call(e, '/adjust', 'POST', { item_id: it.id, vendor_stock: 300, hospital_stock: it.hospital_stock });
  assert.equal(item(e, '보관용 3종 시트팩').vendor_stock, 300);
  // 사용자 예시: 킵잔량 300 sheet, 실제 도착 200 → 남은 킵잔량 100, 병원재고 +200
  const r = await call(e, '/receive', 'POST', { from_prepaid: true, item_id: it.id, actual_qty: 200, date: '2026-11-09' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([item(e, '보관용 3종 시트팩').vendor_stock, item(e, '보관용 3종 시트팩').hospital_stock], [100, it.hospital_stock + 200]);
  const inTx = e.inv.prepare(`SELECT * FROM inv_tx WHERE kind = 'prepaid_in' ORDER BY id DESC`).get();
  assert.equal(inTx.amount, 0); // 추가 결제 없음
  // 잔량보다 많이는 못 받음
  assert.equal((await call(e, '/receive', 'POST', { from_prepaid: true, item_id: it.id, actual_qty: 101 })).status, 400);
  // 선결제 구매: 결제 시 잔량 생성, 병원재고는 그대로
  const opt = e.inv.prepare(`SELECT id FROM inv_options WHERE item_id = ? AND qty = 500`).get(it.id);
  await call(e, '/orders', 'POST', { item_id: it.id, option_id: opt.id, count: 1, date: '2026-11-09' });
  assert.deepEqual([item(e, '보관용 3종 시트팩').vendor_stock, item(e, '보관용 3종 시트팩').hospital_stock], [600, it.hospital_stock + 200]);
  const nov = await call(e, '/report?month=2026-11');
  assert.equal(nov.data.spend_prepaid, 500000);
  assert.equal(nov.data.prepaid.find(p => p.id === it.id).vendor_stock, 600); // 보고서에도 바로 반영
  // 반입 기록 삭제 → 병원재고 -200, 잔량 +200 (반입 전으로)
  await call(e, `/tx/${inTx.id}`, 'DELETE');
  assert.deepEqual([item(e, '보관용 3종 시트팩').vendor_stock, item(e, '보관용 3종 시트팩').hospital_stock], [800, it.hospital_stock]);
});

test('out reduces only hospital stock, deleting it restores; daily close replaces the same day usage', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, '카프리가스');
  await call(e, '/out', 'POST', { item_id: it.id, qty: 2, date: '2026-11-09' });
  assert.deepEqual([item(e, '카프리가스').hospital_stock, item(e, '카프리가스').vendor_stock], [it.hospital_stock - 2, 0]);
  const out = e.inv.prepare(`SELECT id, amount FROM inv_tx WHERE kind = 'out' ORDER BY id DESC`).get();
  assert.equal(out.amount, null);
  await call(e, `/tx/${out.id}`, 'DELETE');
  assert.equal(item(e, '카프리가스').hospital_stock, it.hospital_stock);
  const pack = item(e, '더마 하이드로 팩');
  await call(e, '/daily', 'POST', { date: '2026-11-09', patients: 15, used: { [pack.id]: 3 } });
  await call(e, '/daily', 'POST', { date: '2026-11-09', patients: 16, used: { [pack.id]: 1 } }); // 고쳐 저장
  assert.equal(item(e, '더마 하이드로 팩').hospital_stock, pack.hospital_stock - 1);
  const d = await call(e, '/daily?date=2026-11-09');
  assert.equal(d.data.day.patients, 16);
  assert.equal(d.data.items.find(i => i.id === pack.id).used, 1);
});

test('inventory needs login', async () => {
  const e = env();
  const r = await handleApi(new Request('https://site.test/api/inventory/state'), e);
  assert.equal(r.status, 401);
});

test('more old attendance numbers fill only empty cells and add missing days', async () => {
  const e = env(); await call(e, '/state');
  const sq = e.inv;
  sq.prepare(`INSERT INTO staff_attendance (staff_id, work_date, attendance, start_time, end_time, managed_count, designated_count) VALUES (1, '2026-06-01', '정상근무', '10:00', '19:30', NULL, 2)`).run();
  const r = await call(e, '/import-merge', 'POST', { rows: [
    { id: 99, staff_id: 1, work_date: '2026-06-01', attendance: '정상근무', managed_count: 3, designated_count: 5 },
    { id: 98, staff_id: 2, work_date: '2026-06-02', attendance: '정상근무', start_time: '10:00', end_time: '19:30', work_minutes: 570, managed_count: 4 },
    { staff_id: 3, work_date: '2026-06-02', attendance: '연차' },
  ] });
  assert.deepEqual([r.data.added, r.data.filled, r.data.skipped], [1, 1, 1]);
  const a = sq.prepare(`SELECT managed_count, designated_count FROM staff_attendance WHERE staff_id = 1 AND work_date = '2026-06-01'`).get();
  assert.deepEqual([a.managed_count, a.designated_count], [3, 2]); // 비어 있던 관리 인원만 채움, 지정 2는 그대로
  assert.equal(sq.prepare(`SELECT managed_count FROM staff_attendance WHERE staff_id = 2 AND work_date = '2026-06-02'`).get().managed_count, 4);
  const again = await call(e, '/import-merge', 'POST', { rows: [{ staff_id: 2, work_date: '2026-06-02', attendance: '정상근무', managed_count: 9 }] });
  assert.deepEqual([again.data.added, again.data.filled], [0, 0]); // 두 번 넣어도 그대로
});

test('3종 시트팩 선결제 300장 is 450,000 (also fixed on an existing database)', async () => {
  const e = env(); await call(e, '/state');
  const opt = () => e.inv.prepare(`SELECT amount FROM inv_options WHERE item_id = 1010 AND qty = 300`).get().amount;
  assert.equal(opt(), 450000);
  e.inv.prepare(`UPDATE inv_options SET amount = 360000 WHERE item_id = 1010 AND qty = 300`).run();
  e.inv.prepare(`DELETE FROM inv_meta WHERE key = 'fixes'`).run();
  const { resetInvSchemaCache } = await import('../worker/invSchema.js'); resetInvSchemaCache();
  await call(e, '/state');
  assert.equal(opt(), 450000);
});

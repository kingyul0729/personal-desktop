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
const authH = () => new Headers({ Origin: 'https://site.test', 'oai-authenticated-user-id': 'u1', 'oai-authenticated-user-email': 'u1@test.invalid' });
async function call(e, path, method = 'GET', body) {
  const h = authH();
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
  // 일일재고는 팀장 출근일에만(2026-11-08 규칙)
  e.inv.prepare(`INSERT INTO staff_attendance (staff_id, work_date, attendance, start_time, end_time) VALUES (1, '2026-11-09', '정상근무', '10:00', '19:30')`).run();
  await call(e, '/daily', 'POST', { date: '2026-11-09', patients: 15, used: { [pack.id]: 3 } });
  await call(e, '/daily', 'POST', { date: '2026-11-09', patients: 16, used: { [pack.id]: 1 } }); // 고쳐 저장
  assert.equal(item(e, '더마 하이드로 팩').hospital_stock, pack.hospital_stock - 1);
  const d = await call(e, '/daily?date=2026-11-09');
  assert.equal(d.data.day.patients, 16);
  assert.equal(d.data.items.find(i => i.id === pack.id).used, 1);
});

test('prepaid items only move through prepaid payment and prepaid 반입 (never a plain receive, not even 0 won)', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, '보관용 모델링팩');
  for (const amount of [undefined, 0, 1000]) assert.equal((await call(e, '/receive', 'POST', { item_id: it.id, actual_qty: 5, amount, date: '2026-11-06' })).status, 400);
  assert.equal(item(e, '보관용 모델링팩').hospital_stock, it.hospital_stock);
});

test('prepaid order rule (user spec 2026-11-09): use keep first, new prepaid only for the shortage, deduct only at 입고확정', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, '보관용 3종 시트팩');
  const o500 = e.inv.prepare('SELECT id FROM inv_options WHERE item_id = ? AND prepaid = 1 AND qty = 500').get(it.id).id;
  const o300 = e.inv.prepare('SELECT id, amount FROM inv_options WHERE item_id = ? AND prepaid = 1 AND qty = 300').get(it.id);
  const h0 = it.hospital_stock;
  await call(e, '/adjust', 'POST', { item_id: it.id, vendor_stock: 50, date: '2026-11-01' });
  // 킵 50 · 주문 100 → 옵션 없이는 막힘
  assert.equal((await call(e, '/prepaid-order', 'POST', { item_id: it.id, qty: 100, date: '2026-11-09' })).status, 400);
  // 500 선택 → 주문 후 킵잔량 450, 결제 500,000
  const r = await call(e, '/prepaid-order', 'POST', { item_id: it.id, qty: 100, option_id: o500, date: '2026-11-09' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.keep, r.data.after, r.data.pay], [50, 450, 500000]);
  // 주문 때는 차감 없음: 잔량 = 50 + 500(신규 결제분), 병원재고 그대로
  assert.deepEqual([item(e, '보관용 3종 시트팩').vendor_stock, item(e, '보관용 3종 시트팩').hospital_stock], [550, h0]);
  const pend = (await call(e, '/state')).data.orders.find(o => o.item_id === it.id && o.prepaid);
  assert.equal(pend.qty, 100);
  // 입고확정(실제 100) 때만 킵잔량 − 100, 병원재고 + 100
  assert.equal((await call(e, '/receive', 'POST', { order_id: pend.id, actual_qty: 100, date: '2026-11-10' })).status, 200);
  assert.deepEqual([item(e, '보관용 3종 시트팩').vendor_stock, item(e, '보관용 3종 시트팩').hospital_stock], [450, h0 + 100]);
  // 킵 450 · 주문 200 → 신규 선결제 없음(옵션을 주면 막힘), 결제 0원, 주문 후 250
  assert.equal((await call(e, '/prepaid-order', 'POST', { item_id: it.id, qty: 200, option_id: o300.id })).status, 400);
  const r2 = await call(e, '/prepaid-order', 'POST', { item_id: it.id, qty: 200, date: '2026-11-11' });
  assert.deepEqual([r2.data.after, r2.data.pay, r2.data.option], [250, 0, null]);
  assert.equal(item(e, '보관용 3종 시트팩').vendor_stock, 450); // 주문만으로는 안 줄어듦
  // 받기 전 주문(200)은 킵잔량에서 예약된 것으로 봄: 킵 450 − 200 = 250 · 주문 300 → 50 모자람 → 300 옵션 → 주문 후 250
  const r3 = await call(e, '/prepaid-order', 'POST', { item_id: it.id, qty: 300, option_id: o300.id, date: '2026-11-12' });
  assert.deepEqual([r3.data.keep, r3.data.after, r3.data.pay], [250, 250, o300.amount]);
  // 결제는 이달 지출에 한 번씩만(500,000 + 300 옵션)
  assert.equal((await call(e, '/report?month=2026-11')).data.spend_prepaid, 500000 + o300.amount);
});

test('gifts and promotions: bought + bonus quantities, price from bought only unless a promo price is typed', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, 'GA20%'); // 40,000원 / 1개
  const h0 = it.hospital_stock;
  // 10+10: 산 10 + 증정 10 → 20개, 금액은 산 10개만큼
  let r = await call(e, '/receive', 'POST', { item_id: it.id, actual_qty: 20, bonus_qty: 10, date: '2026-11-09', memo: '10+10' });
  assert.equal(r.data.amount, 400000);
  // 5+2 행사가(직접 입력) → 7개, 금액은 입력한 값
  r = await call(e, '/receive', 'POST', { item_id: it.id, actual_qty: 7, bonus_qty: 2, amount: 180000, date: '2026-11-09', memo: '5+2 행사' });
  assert.equal(r.data.amount, 180000);
  // 증정만 3개 → 0원
  r = await call(e, '/receive', 'POST', { item_id: it.id, actual_qty: 3, bonus_qty: 3, date: '2026-11-09', memo: '증정' });
  assert.equal(r.data.amount, 0);
  assert.equal(item(e, 'GA20%').hospital_stock, h0 + 30);
  assert.equal((await call(e, '/report?month=2026-11')).data.spend_general, 580000);
});

test('split arrivals: each arrival keeps its own date, the payment is counted once', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, 'GA20%');
  const opt = e.inv.prepare('SELECT * FROM inv_options WHERE item_id = ? ORDER BY id LIMIT 1').get(it.id);
  assert.equal((await call(e, '/orders', 'POST', { item_id: it.id, option_id: opt.id, count: 10, date: '2026-11-02' })).status, 200);
  const order = (await call(e, '/state')).data.orders.find(o => o.item_id === it.id);
  const total = order.qty + order.bonus_qty;
  // 11/3 에 6개 → 주문은 남아 있고 받음 6
  assert.equal((await call(e, '/receive', 'POST', { order_id: order.id, actual_qty: 6, date: '2026-11-03' })).status, 200);
  const mid = (await call(e, '/state')).data.orders.find(o => o.id === order.id);
  assert.equal(mid.received_qty, 6);
  // 11/5 에 나머지 → 주문 끝
  assert.equal((await call(e, '/receive', 'POST', { order_id: order.id, actual_qty: total - 6, date: '2026-11-05' })).status, 200);
  assert.equal((await call(e, '/state')).data.orders.filter(o => o.id === order.id).length, 0);
  const txs = e.inv.prepare(`SELECT date, qty, amount FROM inv_tx WHERE order_id = ? AND kind = 'in' ORDER BY id`).all(order.id).map(r => ({ ...r }));
  assert.deepEqual(txs.map(t => t.date), ['2026-11-03', '2026-11-05']);
  assert.deepEqual(txs.map(t => t.amount), [order.amount, 0]); // 결제금액은 한 번만
  assert.equal(item(e, 'GA20%').hospital_stock, it.hospital_stock + total);
  const rep = (await call(e, '/report?month=2026-11')).data;
  assert.equal(rep.spend_general, order.amount);
  // 금액이 걸린 첫 기록은 뒤 도착분보다 먼저 못 지움
  const [firstTx, secondTx] = e.inv.prepare(`SELECT id FROM inv_tx WHERE order_id = ? AND kind = 'in' ORDER BY id`).all(order.id);
  assert.equal((await call(e, `/tx/${firstTx.id}`, 'DELETE')).status, 409);
  assert.equal((await call(e, `/tx/${secondTx.id}`, 'DELETE')).status, 200);
  // 남은 것이 안 오면 '마감'(취소 대신 받은 만큼으로 끝)
  assert.equal((await call(e, `/orders/${order.id}/cancel`, 'POST')).status, 200);
  assert.equal(e.inv.prepare('SELECT status FROM inv_orders WHERE id = ?').get(order.id).status, 'received');
});

test('invoice photos: one photo on several same-day rows; 0-won rows are not counted as missing', async () => {
  const e = env(); const objects = new Map();
  e.BUCKET = { async put(k, v) { objects.set(k, v); }, async get(k) { return objects.has(k) ? { body: objects.get(k) } : null; }, async delete(k) { objects.delete(k); } };
  await call(e, '/state');
  const a = item(e, 'GA20%'), b = item(e, 'GA30%');
  const ra = await call(e, '/receive', 'POST', { item_id: a.id, actual_qty: 1, amount: 40000, date: '2026-11-04', invoice: true });
  assert.ok(ra.data.tx_id > 0);
  // 받음 체크만으로는 '명세서 받음'이 안 됨(사진을 올려야만)
  assert.equal(e.inv.prepare('SELECT invoice FROM inv_tx WHERE id = ?').get(ra.data.tx_id).invoice, 0);
  assert.equal((await call(e, `/tx/${ra.data.tx_id}`, 'PATCH', { invoice: true })).status, 200);
  assert.equal(e.inv.prepare('SELECT invoice FROM inv_tx WHERE id = ?').get(ra.data.tx_id).invoice, 0);
  await call(e, '/receive', 'POST', { item_id: b.id, actual_qty: 1, amount: 0, date: '2026-11-04', memo: '교환' });
  const [ta, tb] = e.inv.prepare(`SELECT id FROM inv_tx WHERE kind = 'in' ORDER BY id`).all();
  // 돈이 나간 기록 1건만 미등록(0원 교환은 안 셈)
  assert.equal((await call(e, '/report?month=2026-11')).data.no_invoice, 1);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const fd = new FormData(); fd.append('file', new File([jpg], 'inv.jpg', { type: 'image/jpeg' })); fd.append('tx_ids', `${ta.id},${tb.id}`);
  const up = await handleApi(new Request('https://site.test/api/inventory/invoices', { method: 'POST', headers: authH(), body: fd }), e);
  assert.equal(up.status, 200, await up.clone().text());
  const { id } = await up.json();
  const rows = (await call(e, '/tx?from=2026-11-01&to=2026-11-30')).data.rows;
  assert.deepEqual(rows.filter(r => r.invoice_ids).map(r => r.invoice_ids).sort(), [String(id), String(id)]);
  assert.equal((await call(e, '/report?month=2026-11')).data.no_invoice, 0);
  assert.equal(e.inv.prepare('SELECT invoice FROM inv_tx WHERE id = ?').get(ta.id).invoice, 1); // 사진이 올라가서 받음
  const file = await handleApi(new Request(`https://site.test/api/inventory/invoices/${id}/file`, { headers: authH() }), e);
  assert.equal(file.status, 200); assert.equal(file.headers.get('content-type'), 'image/jpeg');
  // 사진이 아닌 파일은 막음
  const bad = new FormData(); bad.append('file', new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])], 'x.txt')); bad.append('tx_ids', String(ta.id));
  assert.equal((await handleApi(new Request('https://site.test/api/inventory/invoices', { method: 'POST', headers: authH(), body: bad }), e)).status, 400);
  // 사진 지우기 → 파일도 지움, 다시 미등록 1
  await call(e, `/invoices/${id}`, 'DELETE');
  assert.equal(objects.size, 0);
  assert.equal(e.inv.prepare('SELECT invoice FROM inv_tx WHERE id = ?').get(ta.id).invoice, 0); // 사진을 지우면 받음도 풀림
  assert.equal((await call(e, '/report?month=2026-11')).data.no_invoice, 1);
});

test('prepaid order with a hospital delivery amount: stays in keep stock until the arrival is confirmed', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, '보관용 3종 시트팩');
  const opt = e.inv.prepare(`SELECT id FROM inv_options WHERE item_id = ? AND qty = 500`).get(it.id);
  assert.equal((await call(e, '/orders', 'POST', { item_id: it.id, option_id: opt.id, count: 1, date: '2026-11-09', ship_qty: 9999 })).status, 400);
  const r = await call(e, '/orders', 'POST', { item_id: it.id, option_id: opt.id, count: 1, date: '2026-11-09', ship_qty: 200 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // 주문 직후: 업체재고에 전부, 병원재고는 그대로, 반입 예정 200 한 줄
  const v0 = it.vendor_stock;
  assert.deepEqual([item(e, '보관용 3종 시트팩').vendor_stock, item(e, '보관용 3종 시트팩').hospital_stock], [v0 + 500, it.hospital_stock]);
  const pend = (await call(e, '/state')).data.orders.filter(o => o.item_id === it.id);
  assert.deepEqual(pend.map(o => [o.prepaid, o.qty, o.option_label]), [[1, 200, '반입 예정']]);
  // 같은 물건을 선결제 반입으로 또 받는 건 막음
  assert.equal((await call(e, '/receive', 'POST', { from_prepaid: true, item_id: it.id, actual_qty: 10 })).status, 409);
  // 실제 180 도착 → 업체 −180, 병원 +180, 예정은 끝, 금액 없음
  assert.equal((await call(e, '/receive', 'POST', { order_id: pend[0].id, actual_qty: 180, date: '2026-11-10' })).status, 200);
  assert.deepEqual([item(e, '보관용 3종 시트팩').vendor_stock, item(e, '보관용 3종 시트팩').hospital_stock], [v0 + 320, it.hospital_stock + 180]);
  assert.equal((await call(e, '/state')).data.orders.filter(o => o.item_id === it.id).length, 0);
  const inTx = e.inv.prepare(`SELECT * FROM inv_tx WHERE kind = 'prepaid_in' ORDER BY id DESC`).get();
  assert.equal(inTx.amount, 0);
  // 입고확정 기록을 지우면 되돌리고 예정도 다시 받기 전으로
  await call(e, `/tx/${inTx.id}`, 'DELETE');
  assert.deepEqual([item(e, '보관용 3종 시트팩').vendor_stock, item(e, '보관용 3종 시트팩').hospital_stock], [v0 + 500, it.hospital_stock]);
  assert.equal((await call(e, '/state')).data.orders.filter(o => o.item_id === it.id).length, 1);
  // 선결제 결제 기록을 지우면 받기 전 반입 예정도 함께 취소
  const buy = e.inv.prepare(`SELECT id FROM inv_tx WHERE kind = 'prepaid_buy' ORDER BY id DESC`).get();
  await call(e, `/tx/${buy.id}`, 'DELETE');
  assert.equal((await call(e, '/state')).data.orders.filter(o => o.item_id === it.id).length, 0);
  assert.equal(item(e, '보관용 3종 시트팩').vendor_stock, v0);
});

test('daily close is computed by the chosen date, not by when it was typed in', async () => {
  const e = env(); await call(e, '/state');
  const pack = item(e, '더마 하이드로 팩');
  await call(e, '/adjust', 'POST', { item_id: pack.id, hospital_stock: 6, date: '2026-11-08' });
  // 11/9 마감을 못 적은 채로 11/10에 300 입고(재고 맞추기로 대신) → 지금 재고 306
  await call(e, '/adjust', 'POST', { item_id: pack.id, hospital_stock: 306, date: '2026-11-10' });
  // 나중에 11/9 마감을 연다: 마감 전 재고는 그날 기준 6
  const d = await call(e, '/daily?date=2026-11-09');
  assert.equal(d.data.items.find(i => i.id === pack.id).stock_at, 6);
  // 11/9 마감재고 4 → 그날 사용 2, 11/10 입고 300은 그대로
  const r = await call(e, '/daily', 'POST', { date: '2026-11-09', closing: { [pack.id]: 4 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(e.inv.prepare(`SELECT qty FROM inv_tx WHERE kind = 'out' AND daily_date = '2026-11-09' AND deleted_at IS NULL`).get().qty, 2);
  assert.equal(item(e, '더마 하이드로 팩').hospital_stock, 304);
  // 같은 날 다시 고쳐 저장(마감재고 5) → 사용 1로 바뀜, 재고 305
  await call(e, '/daily', 'POST', { date: '2026-11-09', closing: { [pack.id]: 5 } });
  assert.equal(item(e, '더마 하이드로 팩').hospital_stock, 305);
  assert.equal((await call(e, '/daily?date=2026-11-09')).data.items.find(i => i.id === pack.id).stock_at, 5);
  // 그날 재고보다 많이 적으면 막음(11/10 입고분은 11/9에 없었음)
  assert.equal((await call(e, '/daily', 'POST', { date: '2026-11-09', closing: { [pack.id]: 50 } })).status, 400);
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

test('general items use the registered unit price; prepaid purchase and receipt are separate records', async () => {
  const e = env(); await call(e, '/state');
  const gel = item(e, '클렌징 젤 300ml'), iono = item(e, '이온토P'), pack = item(e, '보관용 3종 시트팩');
  // 금액을 안 넣으면 구매단가 × 수량(증정은 금액 제외, 재고는 포함)
  const r1 = await call(e, '/receive', 'POST', { item_id: gel.id, actual_qty: 6, bonus_qty: 1, date: '2026-11-09' });
  assert.equal(r1.data.amount, 5 * 29000);
  assert.equal(item(e, '클렌징 젤 300ml').hospital_stock, gel.hospital_stock + 6);
  assert.equal(item(e, '클렌징 젤 300ml').vendor_stock, 0);
  // 주문단위(box 50) ≠ 재고단위(ea): 구성수량으로 환산
  assert.equal((await call(e, '/receive', 'POST', { item_id: iono.id, actual_qty: 50, date: '2026-11-09' })).data.amount, 350000);
  // 단가 미확인은 금액 없음(0원으로 만들지 않음)
  const powder = item(e, '알라딘 필링 파우더');
  assert.equal((await call(e, '/receive', 'POST', { item_id: powder.id, actual_qty: 3, date: '2026-11-09' })).data.amount, null);
  // 선결제 품목은 일반 입고로 받지 않음
  assert.equal((await call(e, '/receive', 'POST', { item_id: pack.id, actual_qty: 10 })).status, 400);
  // 선결제 구매: 금액 1회, 구매+증정 수량이 잔량, 개당원가 = 금액 ÷ 증정 포함 수량
  const optId = (await call(e, '/options', 'POST', { item_id: pack.id, label: '500+50', qty: 500, bonus_qty: 50, amount: 550000, prepaid: true })).data.items.find(i => i.id === pack.id).options.find(o => o.label === '500+50').id;
  await call(e, '/orders', 'POST', { item_id: pack.id, option_id: optId, count: 1, date: '2026-11-09' });
  let st = (await call(e, '/state')).data.items.find(i => i.id === pack.id);
  assert.deepEqual([st.vendor_stock, st.hospital_stock, st.unit_cost], [550, pack.hospital_stock, 1000]);
  // 반입은 재고 이동만: 금액·지출 그대로
  const before = (await call(e, '/report?month=2026-11')).data;
  await call(e, '/receive', 'POST', { from_prepaid: true, item_id: pack.id, actual_qty: 200, date: '2026-11-10' });
  const after = (await call(e, '/report?month=2026-11')).data;
  assert.equal(after.spend_total, before.spend_total);
  st = (await call(e, '/state')).data.items.find(i => i.id === pack.id);
  assert.deepEqual([st.vendor_stock, st.hospital_stock, st.unit_cost], [350, pack.hospital_stock + 200, 1000]);
  // 출고는 병원재고만
  await call(e, '/out', 'POST', { item_id: pack.id, qty: 5, date: '2026-11-10' });
  st = (await call(e, '/state')).data.items.find(i => i.id === pack.id);
  assert.deepEqual([st.vendor_stock, st.hospital_stock], [350, pack.hospital_stock + 195]);
  assert.equal((await call(e, '/report?month=2026-11')).data.spend_total, before.spend_total);
});

test('an item saved with a price but no purchase condition gets one so it can be ordered', async () => {
  const e = env(); await call(e, '/state');
  const r = await call(e, '/items', 'POST', { name: '테스트 크림', stock_unit: 'ea', order_unit: 'box', pack_qty: 10, price: 50000 });
  const it = r.data.items.find(i => i.name === '테스트 크림');
  assert.deepEqual(it.options.map(o => [o.qty, o.amount]), [[10, 50000]]);
});

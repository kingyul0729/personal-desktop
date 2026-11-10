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
  await call(e, '/adjust', 'POST', { item_id: item(e, '카프리가스').id, hospital_stock: 10, date: '2026-11-08' });
  await call(e, '/adjust', 'POST', { item_id: item(e, '더마 하이드로 팩').id, hospital_stock: 10, date: '2026-11-08' });
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
  assert.equal(e.inv.prepare('SELECT status FROM inv_orders WHERE id = ?').get(order.id).status, 'closed');
  // 마감한 주문은 도착 기록을 지워도 다시 열리지 않음
  await call(e, `/tx/${firstTx.id}`, 'DELETE');
  assert.equal(e.inv.prepare('SELECT status FROM inv_orders WHERE id = ?').get(order.id).status, 'closed');
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
  assert.deepEqual(pend.map(o => [o.prepaid, o.qty, o.option_label]), [[1, 200, '입고 예정']]);
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
  // 그날 장부보다 많이 세면 센 수량이 그날 재고가 됨(11/10 입고 300은 그대로 더해짐)
  assert.equal((await call(e, '/daily', 'POST', { date: '2026-11-09', closing: { [pack.id]: 50 } })).status, 200);
  assert.equal(item(e, '더마 하이드로 팩').hospital_stock, 350);
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

// 2026-11-09 사용자 문서(재고관리 최종 수정 1~23)
async function callId(e, path, method, body, id) {
  const h = authH(); h.set('Content-Type', 'application/json'); h.set('x-req-id', id);
  const r = await handleApi(new Request(`https://site.test/api/inventory${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), e);
  return { status: r.status, data: await r.json() };
}
test('spec example: prepaid 500 → 100 in → same request again → 30 out → same again → cancel out', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, '보관용 3종 시트팩');
  const o500 = e.inv.prepare('SELECT id, amount FROM inv_options WHERE item_id = ? AND prepaid = 1 AND qty = 500').get(it.id);
  await call(e, '/adjust', 'POST', { item_id: it.id, hospital_stock: 0, date: '2026-11-01' });
  const st = () => { const x = item(e, '보관용 3종 시트팩'); return [x.hospital_stock, x.vendor_stock]; };
  const r = await call(e, '/prepaid-order', 'POST', { item_id: it.id, qty: 100, option_id: o500.id, date: '2026-11-02' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(st(), [0, 500]);
  const pend = (await call(e, '/state')).data.orders.find(o => o.item_id === it.id && o.prepaid);
  const a = await callId(e, '/receive', 'POST', { order_id: pend.id, actual_qty: 100, date: '2026-11-03' }, 'req-in-0001');
  const b = await callId(e, '/receive', 'POST', { order_id: pend.id, actual_qty: 100, date: '2026-11-03' }, 'req-in-0001');
  assert.equal(b.data.duplicate, true); assert.equal(b.data.tx_id, a.data.tx_id);
  assert.deepEqual(st(), [100, 400]);
  await callId(e, '/out', 'POST', { item_id: it.id, qty: 30, date: '2026-11-04' }, 'req-out-0001');
  await callId(e, '/out', 'POST', { item_id: it.id, qty: 30, date: '2026-11-04' }, 'req-out-0001');
  assert.deepEqual(st(), [70, 400]);
  const out = e.inv.prepare(`SELECT id FROM inv_tx WHERE kind = 'out' AND item_id = ? AND deleted_at IS NULL`).all(it.id);
  assert.equal(out.length, 1);
  await call(e, `/tx/${out[0].id}`, 'DELETE');
  assert.deepEqual(st(), [100, 400]);
  // 결제는 처음 한 번만, 반입·출고는 0원
  assert.equal((await call(e, '/report?month=2026-11')).data.spend_prepaid, o500.amount);
});

test('stock never goes below zero: out, deleting a paid prepaid record already brought in, and the database itself', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, '카프리가스');
  await call(e, '/adjust', 'POST', { item_id: it.id, hospital_stock: 3, date: '2026-11-01' });
  assert.equal((await call(e, '/out', 'POST', { item_id: it.id, qty: 4, date: '2026-11-02' })).status, 400);
  assert.equal(item(e, '카프리가스').hospital_stock, 3);
  const pp = item(e, '보관용 3종 시트팩');
  const o300 = e.inv.prepare('SELECT id FROM inv_options WHERE item_id = ? AND prepaid = 1 AND qty = 300').get(pp.id);
  await call(e, '/prepaid-order', 'POST', { item_id: pp.id, qty: 300, option_id: o300.id, date: '2026-11-06' });
  const pend = (await call(e, '/state')).data.orders.find(o => o.item_id === pp.id && o.prepaid);
  await call(e, '/receive', 'POST', { order_id: pend.id, actual_qty: 300, date: '2026-11-06' });
  const buy = e.inv.prepare(`SELECT id FROM inv_tx WHERE kind = 'prepaid_buy' AND item_id = ?`).get(pp.id);
  const del = await call(e, `/tx/${buy.id}`, 'DELETE');
  assert.equal(del.status, 409); // 그대로 두면 선결제 잔량 −300이 됨
  assert.equal(item(e, '보관용 3종 시트팩').vendor_stock, 0);
  assert.throws(() => e.inv.prepare('UPDATE inv_items SET hospital_stock = -1 WHERE id = ?').run(it.id), /INV_NEGATIVE/);
  // 이미 마이너스인 예전 값은 더 줄어들 때만 막음(다른 칸은 고칠 수 있음)
  e.inv.exec('DROP TRIGGER inv_items_no_negative'); e.inv.prepare('UPDATE inv_items SET vendor_stock = -300 WHERE id = ?').run(pp.id);
  e.inv.exec(`CREATE TRIGGER inv_items_no_negative BEFORE UPDATE OF hospital_stock, vendor_stock ON inv_items WHEN (NEW.hospital_stock < -0.0005 AND NEW.hospital_stock < OLD.hospital_stock) OR (NEW.vendor_stock < -0.0005 AND NEW.vendor_stock < OLD.vendor_stock) BEGIN SELECT RAISE(ABORT, 'INV_NEGATIVE'); END`);
  assert.equal((await call(e, '/out', 'POST', { item_id: pp.id, qty: 1, date: '2026-11-07' })).status, 200);
});

test('editing a quantity applies only the difference, the payment stays', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, 'GA20%');
  const r = await call(e, '/receive', 'POST', { item_id: it.id, actual_qty: 5, date: '2026-11-03' });
  const h = item(e, 'GA20%').hospital_stock;
  const amount = e.inv.prepare('SELECT amount FROM inv_tx WHERE id = ?').get(r.data.tx_id).amount;
  assert.equal((await call(e, `/tx/${r.data.tx_id}`, 'PATCH', { actual_qty: 3 })).status, 200);
  assert.equal(item(e, 'GA20%').hospital_stock, h - 2);
  const t = e.inv.prepare('SELECT qty, hospital_delta, amount FROM inv_tx WHERE id = ?').get(r.data.tx_id);
  assert.deepEqual([t.qty, t.hospital_delta, t.amount], [3, 3, amount]);
  await call(e, '/out', 'POST', { item_id: it.id, qty: 1, date: '2026-11-04' });
  const out = e.inv.prepare(`SELECT id FROM inv_tx WHERE kind = 'out' ORDER BY id DESC`).get();
  await call(e, `/tx/${out.id}`, 'PATCH', { actual_qty: 2 });
  assert.equal(item(e, 'GA20%').hospital_stock, h - 4);
  assert.equal((await call(e, `/tx/${out.id}`, 'PATCH', { actual_qty: 99 })).status, 400);
});

test('daily record: 작성제외 on leader days off, 미작성 on work days, every save is kept with who and when', async () => {
  const e = env(); await call(e, '/state');
  e.inv.prepare(`INSERT INTO staff_attendance (staff_id, work_date, attendance) VALUES (1, '2026-11-03', '연차')`).run();
  e.inv.prepare(`INSERT INTO staff_attendance (staff_id, work_date, attendance, start_time, end_time) VALUES (1, '2026-11-04', '정상근무', '10:00', '19:30')`).run();
  assert.equal((await call(e, '/daily?date=2026-11-03')).data.record.state, 'skip');
  assert.equal((await call(e, '/daily?date=2026-11-04')).data.record.state, 'missing');
  assert.equal((await call(e, '/daily?date=2026-11-08')).data.record.state, 'skip'); // 일요일
  await call(e, '/daily', 'POST', { date: '2026-11-04', patients: 10, used: {} });
  await call(e, '/daily', 'POST', { date: '2026-11-04', patients: 12, used: {} });
  const d = (await call(e, '/daily?date=2026-11-04')).data.record;
  assert.equal(d.state, 'done');
  assert.deepEqual(d.log.map(l => l.patients), [10, 12]);
  assert.ok(d.first_at && d.first_by);
});

// 2026-11-09 사용자: 휴무·연차·상담 날은 건너뛰고 다음 근무일에 센 마감재고가 병원재고가 된다(검증 기준 0~9)
test('daily count after skipped days: the counted number becomes hospital stock, once, without touching vendor stock', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, '일회용해면');
  const pp = item(e, '보관용 3종 시트팩');
  await call(e, '/adjust', 'POST', { item_id: it.id, hospital_stock: 100, date: '2026-11-02' });
  await call(e, '/adjust', 'POST', { item_id: pp.id, hospital_stock: 50, vendor_stock: 200, date: '2026-11-02' });
  for (const [d, st] of [['2026-11-03', '미기록'], ['2026-11-04', '휴무'], ['2026-11-05', '연차'], ['2026-11-06', '상담']])
    e.inv.prepare(`INSERT INTO staff_attendance (staff_id, work_date, attendance) VALUES (1, ?, ?)`).run(d, st);
  e.inv.prepare(`INSERT INTO staff_attendance (staff_id, work_date, attendance, start_time, end_time) VALUES (1, '2026-11-07', '정상근무', '10:00', '19:30')`).run();
  // 0~3: 미기록·휴무·연차·상담 날 미작성 → 변동 없음
  for (const d of ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']) await call(e, `/daily?date=${d}`);
  assert.equal(item(e, '일회용해면').hospital_stock, 100);
  // 그 사이 입고 10은 그대로(9)
  await call(e, '/receive', 'POST', { item_id: it.id, actual_qty: 10, date: '2026-11-05' });
  assert.equal(item(e, '일회용해면').hospital_stock, 110);
  // 4: 다음 근무일 마감재고 80 → 병원재고 80(차이 30만 한 번)
  const r = await call(e, '/daily', 'POST', { date: '2026-11-07', closing: { [it.id]: 80 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(item(e, '일회용해면').hospital_stock, 80);
  // 5: 같은 기록 재저장 → 그대로 80
  await call(e, '/daily', 'POST', { date: '2026-11-07', closing: { [it.id]: 80 } });
  assert.equal(item(e, '일회용해면').hospital_stock, 80);
  // 6: 마감재고 수정 75 → 75, 장부보다 많은 120으로 수정 → 120
  await call(e, '/daily', 'POST', { date: '2026-11-07', closing: { [it.id]: 75 } });
  assert.equal(item(e, '일회용해면').hospital_stock, 75);
  await call(e, '/daily', 'POST', { date: '2026-11-07', closing: { [it.id]: 120 } });
  assert.equal(item(e, '일회용해면').hospital_stock, 120);
  // 비운 칸(이번에 안 셈)은 손대지 않음
  await call(e, '/daily', 'POST', { date: '2026-11-07', patients: 9, used: {}, closing: {} });
  assert.equal(item(e, '일회용해면').hospital_stock, 120);
  // 9: 입고 기록은 한 번만, 일일재고 기록은 그날 한 줄만
  assert.equal(e.inv.prepare(`SELECT count(*) AS n FROM inv_tx WHERE item_id = ? AND kind = 'in' AND deleted_at IS NULL`).get(it.id).n, 1);
  assert.equal(e.inv.prepare(`SELECT count(*) AS n FROM inv_tx WHERE item_id = ? AND daily_date = '2026-11-07' AND deleted_at IS NULL`).get(it.id).n, 1);
  // 8: 일일재고 입력은 업체재고(선결제 잔량)를 바꾸지 않음
  await call(e, '/daily', 'POST', { date: '2026-11-07', closing: { [pp.id]: 30 } });
  assert.deepEqual([item(e, '보관용 3종 시트팩').hospital_stock, item(e, '보관용 3종 시트팩').vendor_stock], [30, 200]);
  // 7: 선결제 반입 → 업체재고 −, 병원재고 +
  await call(e, '/receive', 'POST', { item_id: pp.id, from_prepaid: true, actual_qty: 100, date: '2026-11-08' });
  assert.deepEqual([item(e, '보관용 3종 시트팩').hospital_stock, item(e, '보관용 3종 시트팩').vendor_stock], [130, 100]);
  // 날짜 기준: 11/7 마감을 다시 저장해도 11/8 반입은 그대로
  await call(e, '/daily', 'POST', { date: '2026-11-07', closing: { [pp.id]: 30 } });
  assert.deepEqual([item(e, '보관용 3종 시트팩').hospital_stock, item(e, '보관용 3종 시트팩').vendor_stock], [130, 100]);
});

test('one-time fix: a negative prepaid balance from a deleted purchase is restored, otherwise set to 0', async () => {
  const e = env(); await call(e, '/state');
  const pp = item(e, '보관용 3종 시트팩');
  const o300 = e.inv.prepare('SELECT id, amount FROM inv_options WHERE item_id = ? AND prepaid = 1 AND qty = 300').get(pp.id);
  await call(e, '/prepaid-order', 'POST', { item_id: pp.id, qty: 300, option_id: o300.id, date: '2026-11-06' });
  const pend = (await call(e, '/state')).data.orders.find(o => o.item_id === pp.id && o.prepaid);
  await call(e, '/receive', 'POST', { order_id: pend.id, actual_qty: 300, date: '2026-11-09' });
  // 실제 사이트처럼 결제 기록이 지워져 −300이 된 상태를 만든다(지금은 화면으로는 못 지움)
  const buy = e.inv.prepare(`SELECT id FROM inv_tx WHERE kind = 'prepaid_buy' AND item_id = ?`).get(pp.id);
  e.inv.exec('DROP TRIGGER inv_items_no_negative');
  e.inv.prepare('UPDATE inv_tx SET deleted_at = 1, deleted_by = ? WHERE id = ?').run('u1', buy.id);
  e.inv.prepare('UPDATE inv_items SET vendor_stock = -300 WHERE id = ?').run(pp.id);
  const ga = item(e, 'GA20%'); e.inv.prepare('UPDATE inv_items SET vendor_stock = -5 WHERE id = ?').run(ga.id);
  e.inv.prepare(`UPDATE inv_meta SET value = replace(value, 'negfix1', '') WHERE key = 'fixes'`).run();
  const e2 = { ...e, INV_DB: d1(e.inv) }; // 다음 접속(새 연결)
  const h = item(e, '보관용 3종 시트팩').hospital_stock;
  await call(e2, '/state');
  assert.deepEqual([item(e, '보관용 3종 시트팩').vendor_stock, item(e, '보관용 3종 시트팩').hospital_stock], [0, h]);
  assert.equal(e.inv.prepare('SELECT deleted_at FROM inv_tx WHERE id = ?').get(buy.id).deleted_at, null); // 결제 기록 되살림
  assert.equal((await call(e2, '/report?month=2026-11')).data.spend_prepaid, o300.amount);
  assert.equal(item(e, 'GA20%').vendor_stock, 0); // 메울 기록이 없으면 0으로 맞춤
  // 한 번만
  e.inv.prepare('UPDATE inv_items SET vendor_stock = -1 WHERE id = ?').run(ga.id);
  await call({ ...e, INV_DB: d1(e.inv) }, '/state');
  assert.equal(item(e, 'GA20%').vendor_stock, -1);
});


// 2026-11-09 점검에서 찾은 것
test('check: over-receiving an order is blocked (general, prepaid, and by editing)', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, 'GA20%');
  const opt = e.inv.prepare('SELECT id FROM inv_options WHERE item_id = ? AND prepaid = 0').get(it.id);
  await call(e, '/orders', 'POST', { item_id: it.id, option_id: opt.id, count: 3, date: '2026-11-03' });
  const o = (await call(e, '/state')).data.orders[0];
  assert.equal((await call(e, '/receive', 'POST', { order_id: o.id, actual_qty: 30, date: '2026-11-04' })).status, 400);
  const r = await call(e, '/receive', 'POST', { order_id: o.id, actual_qty: 1, date: '2026-11-04' });
  assert.equal((await call(e, `/tx/${r.data.tx_id}`, 'PATCH', { actual_qty: 4 })).status, 400);
  assert.equal((await call(e, `/tx/${r.data.tx_id}`, 'PATCH', { actual_qty: 3 })).status, 200);
  const pp = item(e, '보관용 3종 시트팩');
  await call(e, '/adjust', 'POST', { item_id: pp.id, vendor_stock: 100, date: '2026-11-01' });
  await call(e, '/prepaid-order', 'POST', { item_id: pp.id, qty: 40, date: '2026-11-05' });
  const po = (await call(e, '/state')).data.orders.find(x => x.prepaid);
  assert.equal((await call(e, '/receive', 'POST', { order_id: po.id, actual_qty: 41, date: '2026-11-06' })).status, 400);
});

test('check: replaying a long saved response does not crash', async () => {
  const e = env(); await call(e, '/state');
  const body = { name: '점검 품목', stock_unit: 'ea', price: 1000, min_stock: 1 };
  const a = await callId(e, '/items', 'POST', body, 'req-item-0001');
  const b = await callId(e, '/items', 'POST', body, 'req-item-0001');
  assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(b.data.duplicate, true);
  assert.equal(e.inv.prepare(`SELECT count(*) n FROM inv_items WHERE name = '점검 품목'`).get().n, 1);
});

test('check: a failing schema read never rebuilds (wipes) the inventory tables', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, 'GA20%');
  await call(e, '/adjust', 'POST', { item_id: it.id, hospital_stock: 40, date: '2026-11-01' });
  const base = d1(e.inv);
  const flaky = { ...base, prepare(sql) { if (/key = 'schema'/.test(sql)) throw new Error('D1_ERROR: network'); return base.prepare(sql); } };
  const r = await call({ ...e, INV_DB: flaky }, '/state');
  assert.notEqual(r.status, 200);
  assert.equal(item(e, 'GA20%').hospital_stock, 40);
  assert.ok(e.inv.prepare('SELECT count(*) n FROM inv_tx').get().n > 0);
});

test('check: filling in an earlier daily count keeps a later count true', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, '일회용해면');
  await call(e, '/adjust', 'POST', { item_id: it.id, hospital_stock: 10, date: '2026-11-01' });
  await call(e, '/daily', 'POST', { date: '2026-11-10', closing: { [it.id]: 6 } });
  assert.equal(item(e, '일회용해면').hospital_stock, 6);
  await call(e, '/daily', 'POST', { date: '2026-11-08', closing: { [it.id]: 7 } });
  const at = d => call(e, `/daily?date=${d}`).then(r => r.data.items.find(x => x.id === it.id).stock_at);
  assert.equal(await at('2026-11-08'), 7);
  assert.equal(await at('2026-11-10'), 6);
  assert.equal(item(e, '일회용해면').hospital_stock, 6);
  // 앞 날짜를 장부보다 많게 고쳐도(12) 뒤 날짜 6은 그대로
  await call(e, '/daily', 'POST', { date: '2026-11-08', closing: { [it.id]: 12 } });
  assert.deepEqual([await at('2026-11-08'), await at('2026-11-10'), item(e, '일회용해면').hospital_stock], [12, 6, 6]);
  const s = e.inv.prepare('SELECT coalesce(sum(hospital_delta),0) h FROM inv_tx WHERE item_id = ? AND deleted_at IS NULL').get(it.id).h;
  assert.equal(s, 6);
});

test('check: a prepaid order links its payment and planned delivery in one step', async () => {
  const e = env(); await call(e, '/state');
  const pp = item(e, '보관용 3종 시트팩');
  const o300 = e.inv.prepare('SELECT id FROM inv_options WHERE item_id = ? AND prepaid = 1 AND qty = 300').get(pp.id);
  await call(e, '/prepaid-order', 'POST', { item_id: pp.id, qty: 100, option_id: o300.id, date: '2026-11-05' });
  const buy = e.inv.prepare(`SELECT * FROM inv_tx WHERE kind = 'prepaid_buy'`).get();
  const paid = e.inv.prepare(`SELECT id FROM inv_orders WHERE status = 'paid'`).get();
  const pend = e.inv.prepare(`SELECT memo FROM inv_orders WHERE status = 'ordered'`).get();
  assert.equal(buy.order_id, paid.id); assert.equal(pend.memo, `from:${paid.id}`);
});

test('check: replacing a big earlier correction never dips stock below 0 midway, and an exact count still marks the day', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, '보관용 3종 시트팩');
  await call(e, '/adjust', 'POST', { item_id: it.id, hospital_stock: 4, date: '2026-11-01' });
  await call(e, '/out', 'POST', { item_id: it.id, qty: 4, date: '2026-11-05' }); // 지금 0, 11/3 장부 4
  await call(e, '/daily', 'POST', { date: '2026-11-09', closing: { [it.id]: 0 } }); // 장부와 같음 → 0 표시만
  assert.equal(e.inv.prepare(`SELECT count(*) n FROM inv_tx WHERE daily_date = '2026-11-09' AND deleted_at IS NULL`).get().n, 1);
  assert.equal((await call(e, '/daily', 'POST', { date: '2026-11-03', closing: { [it.id]: 40 } })).status, 200); // +36
  assert.equal((await call(e, '/daily', 'POST', { date: '2026-11-03', closing: { [it.id]: 2 } })).status, 200); // 큰 + 기록을 바꿔도 막히지 않음
  const at = d => call(e, `/daily?date=${d}`).then(r => r.data.items.find(x => x.id === it.id).stock_at);
  assert.deepEqual([await at('2026-11-03'), await at('2026-11-09'), item(e, '보관용 3종 시트팩').hospital_stock], [2, 0, 0]);
  assert.equal((await call(e, '/tx?from=2026-11-01&to=2026-11-30')).data.rows.some(r => r.daily_date === '2026-11-09'), true); // 11/9 기록이 0이 아니면 보임
});

test('daily: correcting 마감 전 재고 makes the month usage right; hospital stock is still the counted number', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, '일회용해면');
  await call(e, '/adjust', 'POST', { item_id: it.id, hospital_stock: 10, date: '2026-11-01' });
  const usage = async () => ((await call(e, '/report?month=2026-11')).data.usage.find(u => u.id === it.id)?.used) ?? 0;
  // 장부 10, 실제 시작 20, 센 마감재고 16 → 병원재고 16, 사용량 4
  assert.equal((await call(e, '/daily', 'POST', { date: '2026-11-04', closing: { [it.id]: 16 }, opening: { [it.id]: 20 } })).status, 200);
  assert.equal(item(e, '일회용해면').hospital_stock, 16);
  assert.equal(await usage(), 4);
  const g = (await call(e, '/daily?date=2026-11-04')).data.items.find(x => x.id === it.id);
  assert.equal(g.stock_at + g.used + g.open_fix, 20); // 화면에 다시 열면 20
  // 같은 내용 다시 저장 → 그대로
  await call(e, '/daily', 'POST', { date: '2026-11-04', closing: { [it.id]: 16 }, opening: { [it.id]: 20 } });
  assert.deepEqual([item(e, '일회용해면').hospital_stock, await usage()], [16, 4]);
  // 마감 전 재고를 비우고 저장 → 장부 기준(10 → 16, 사용량 0)
  await call(e, '/daily', 'POST', { date: '2026-11-04', closing: { [it.id]: 16 } });
  assert.deepEqual([item(e, '일회용해면').hospital_stock, await usage()], [16, 0]);
  // 마감재고가 고친 마감 전 재고보다 많으면 막음
  assert.equal((await call(e, '/daily', 'POST', { date: '2026-11-04', closing: { [it.id]: 30 }, opening: { [it.id]: 20 } })).status, 400);
  // 뒤 날짜 실사가 있을 때 앞 날짜의 마감 전 재고를 고쳐도 뒤 실사는 그대로
  await call(e, '/daily', 'POST', { date: '2026-11-07', closing: { [it.id]: 12 } });
  await call(e, '/daily', 'POST', { date: '2026-11-04', closing: { [it.id]: 15 }, opening: { [it.id]: 25 } });
  const at = d => call(e, `/daily?date=${d}`).then(r => r.data.items.find(x => x.id === it.id).stock_at);
  assert.deepEqual([await at('2026-11-04'), await at('2026-11-07'), item(e, '일회용해면').hospital_stock], [15, 12, 12]);
});

test('check: moving a receipt date before a counted day keeps that count (no double add)', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, '더마 하이드로 팩');
  assert.equal((await call(e, '/receive', 'POST', { item_id: it.id, actual_qty: 6, amount: 1000, date: '2026-11-01' })).status, 200);
  // 11/6 실사: 300장이 이미 들어와 있었는데 입고 기록이 없어 마감재고 290 + 사용 6
  assert.equal((await call(e, '/daily', 'POST', { date: '2026-11-06', closing: { [it.id]: 290 }, opening: { [it.id]: 296 } })).status, 200);
  assert.equal(item(e, '더마 하이드로 팩').hospital_stock, 290);
  // 같은 300장을 11/9로 입고확정 → 두 번 더해짐
  const r = await call(e, '/receive', 'POST', { item_id: it.id, actual_qty: 300, amount: 1000, date: '2026-11-09' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(item(e, '더마 하이드로 팩').hospital_stock, 590);
  const tx = e.inv.prepare(`SELECT id FROM inv_tx WHERE item_id = ? AND kind = 'in' AND date = '2026-11-09'`).get(it.id);
  const p = await call(e, `/tx/${tx.id}`, 'PATCH', { date: '2026-11-06' });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(item(e, '더마 하이드로 팩').hospital_stock, 290);
  const d = (await call(e, '/daily?date=2026-11-06')).data.items.find(x => x.id === it.id);
  assert.equal(d.stock_at, 290);
  assert.equal(Math.round((d.used + d.open_fix) * 1000) / 1000, 6); // 사용량은 적은 그대로
  // 되돌려 옮기면 다시 590
  assert.equal((await call(e, `/tx/${tx.id}`, 'PATCH', { date: '2026-11-09' })).status, 200);
  assert.equal(item(e, '더마 하이드로 팩').hospital_stock, 590);
});

test('check: one-time datefix1 moves the 11/9 prepaid receipt of 3종 시트팩 to 11/6 (590 → 290)', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, '보관용 3종 시트팩');
  e.inv.prepare('UPDATE inv_items SET hospital_stock = 6 WHERE id = ?').run(it.id);
  assert.equal((await call(e, '/daily', 'POST', { date: '2026-11-06', closing: { [it.id]: 290 }, opening: { [it.id]: 296 } })).status, 200);
  e.inv.prepare(`INSERT INTO inv_tx (date, kind, item_id, qty, hospital_delta, vendor_delta, memo, created_at) VALUES ('2026-11-09', 'prepaid_in', ?, 300, 300, -300, '입고', 1)`).run(it.id);
  e.inv.prepare('UPDATE inv_items SET hospital_stock = hospital_stock + 300 WHERE id = ?').run(it.id);
  assert.equal(item(e, '보관용 3종 시트팩').hospital_stock, 590);
  const f = e.inv.prepare(`SELECT value FROM inv_meta WHERE key = 'fixes'`).get().value;
  e.inv.prepare(`UPDATE inv_meta SET value = ? WHERE key = 'fixes'`).run(f.replace('datefix1', '').trim());
  const { resetInvSchemaCache } = await import('../worker/invSchema.js'); resetInvSchemaCache();
  await call(e, '/state');
  assert.equal(item(e, '보관용 3종 시트팩').hospital_stock, 290);
  const d = (await call(e, '/daily?date=2026-11-06')).data.items.find(x => x.id === it.id);
  assert.equal(d.stock_at, 290);
  resetInvSchemaCache(); await call(e, '/state'); // 두 번 돌지 않음
  assert.equal(item(e, '보관용 3종 시트팩').hospital_stock, 290);
});

test('check: old app daily counts (dailyfix1) put each photo day exactly as written, once', async () => {
  const e = env({ oldDailyFix: true }); await call(e, '/state');
  e.inv.prepare(`UPDATE inv_items SET daily_mode = CASE WHEN name IN ('보관용 모델링팩','일회용해면') THEN 'count' ELSE 'usage' END WHERE name IN ('보관용 3종 시트팩','더마 하이드로 팩','더마 리바이브 팩','보관용 모델링팩','일회용해면')`).run();
  e.inv.prepare(`UPDATE inv_items SET hospital_stock = 400 WHERE name IN ('보관용 3종 시트팩','더마 하이드로 팩','더마 리바이브 팩','보관용 모델링팩','일회용해면')`).run();
  e.inv.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('import', 'old-app-data.json')`).run(); // 예전 자료를 넣은 곳
  for (let k = 0; k < 5; k++) await call(e, '/fix-left');
  const { OLD_DAILY_COUNTS } = await import('../worker/invDailyFix.js');
  for (const day of OLD_DAILY_COUNTS) {
    const d = (await call(e, `/daily?date=${day.d}`)).data;
    for (const [name, [close, used]] of Object.entries(day.i)) {
      const it = d.items?.find(x => x.name === name);
      assert.ok(it, JSON.stringify(d.items?.map(x => x.name)) + JSON.stringify(Object.keys(d)));
      assert.equal(it.stock_at, close, `${day.d} ${name}`);
      if (used) assert.equal(Math.round((it.used + (it.open_fix || 0)) * 1000) / 1000, used, `${day.d} ${name} 사용량`);
    }
  }
  const before = item(e, '보관용 3종 시트팩').hospital_stock;
  await call(e, '/state'); assert.equal(item(e, '보관용 3종 시트팩').hospital_stock, before); // 두 번 안 함
  const d728 = (await call(e, '/daily?date=2026-07-28')).data.items.find(x => x.name === '더마 하이드로 팩');
  assert.equal(d728.stock_at, 13);
  assert.equal((await call(e, '/daily?date=2026-10-02')).data.day.status, '휴무');
  assert.equal((await call(e, '/daily?date=2026-10-27')).data.day.status, '상담');
  assert.equal((await call(e, '/fix-left')).data.left, 0);
});

test('check: dailyfix1 keeps a November count the team lead already wrote', async () => {
  const e = env({ oldDailyFix: true }); await call(e, '/state');
  const id = item(e, '보관용 3종 시트팩').id;
  e.inv.prepare('UPDATE inv_items SET hospital_stock = 400 WHERE id = ?').run(id);
  assert.equal((await call(e, '/daily', 'POST', { date: '2026-11-06', closing: { [id]: 290 }, opening: { [id]: 296 } })).status, 200);
  e.inv.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('import', 'old-app-data.json')`).run();
  e.inv.prepare(`DELETE FROM inv_meta WHERE key = 'dailyfix1'`).run();
  for (let k = 0; k < 5; k++) await call(e, '/fix-left');
  const d6 = (await call(e, '/daily?date=2026-11-06')).data.items.find(x => x.id === id);
  const d31 = (await call(e, '/daily?date=2026-10-31')).data.items.find(x => x.id === id);
  assert.equal(d31.stock_at, 26);
  assert.equal(d6.stock_at, 290);
  assert.equal(item(e, '보관용 3종 시트팩').hospital_stock, 290);
});

test('check: dailyfix1 finishes with the photo 10/31 and keeps the lead\'s 11/2·11/3 counts', async () => {
  const e = env({ oldDailyFix: true }); await call(e, '/state');
  const id = item(e, '보관용 3종 시트팩').id;
  e.inv.prepare('UPDATE inv_items SET hospital_stock = 25 WHERE id = ?').run(id);
  // 새 앱에서 팀장이 적은 날들(사진 넣기 전)
  await call(e, '/daily', 'POST', { date: '2026-10-31', closing: { [id]: 21 }, opening: { [id]: 25 } });
  await call(e, '/daily', 'POST', { date: '2026-11-02', closing: { [id]: 24 }, opening: { [id]: 26 } });
  await call(e, '/daily', 'POST', { date: '2026-11-03', closing: { [id]: 17 }, opening: { [id]: 23 } });
  e.inv.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('import', 'old-app-data.json')`).run();
  for (let k = 0; k < 5; k++) await call(e, '/fix-left');
  const day = async d => (await call(e, `/daily?date=${d}`)).data.items.find(x => x.id === id);
  const r = d => ({ close: d.stock_at, used: Math.round((d.used + (d.open_fix || 0)) * 1000) / 1000 });
  assert.deepEqual(r(await day('2026-10-31')), { close: 26, used: 4 });
  assert.deepEqual(r(await day('2026-11-02')), { close: 24, used: 2 });
  assert.deepEqual(r(await day('2026-11-03')), { close: 17, used: 6 });
  assert.equal(item(e, '보관용 3종 시트팩').hospital_stock, 17);
});

test('user spec 11-10: skipped days change nothing, the next count sets hospital stock exactly once', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, '더마 하이드로 팩');
  const stock = () => item(e, '더마 하이드로 팩');
  assert.equal((await call(e, '/receive', 'POST', { item_id: it.id, actual_qty: 100, amount: 1000, date: '2026-11-01' })).status, 200);
  const base = stock().hospital_stock, vendor = stock().vendor_stock;
  // 0~3 미기록·휴무·연차·상담 날은 아무것도 안 적음 → 다른 화면을 열어도 그대로
  for (const d of ['2026-11-02', '2026-11-03', '2026-11-04']) await call(e, `/daily?date=${d}`);
  await call(e, '/state'); assert.equal(stock().hospital_stock, base);
  // 4 다음 근무일 실사 80 → 80 (20을 따로 다시 빼지 않음)
  const save = q => call(e, '/daily', 'POST', { date: '2026-11-05', closing: { [it.id]: q } });
  assert.equal((await save(base - 20)).status, 200); assert.equal(stock().hospital_stock, base - 20);
  // 5 같은 기록 다시 저장 → 그대로
  await save(base - 20); assert.equal(stock().hospital_stock, base - 20);
  // 6 마감재고 고침 → 고친 수량 그대로
  await save(base - 25); assert.equal(stock().hospital_stock, base - 25);
  await save(base - 20); assert.equal(stock().hospital_stock, base - 20);
  // 9 사이에 출고가 있어도 그 기록은 그대로, 다음 실사와의 차이만 한 번
  assert.equal((await call(e, '/out', 'POST', { item_id: it.id, qty: 5, date: '2026-11-06' })).status, 200);
  assert.equal(stock().hospital_stock, base - 25);
  assert.equal((await call(e, '/daily', 'POST', { date: '2026-11-07', closing: { [it.id]: base - 30 } })).status, 200);
  assert.equal(stock().hospital_stock, base - 30);
  const outs = e.inv.prepare(`SELECT count(*) AS n FROM inv_tx WHERE item_id = ? AND kind = 'out' AND daily_date IS NULL AND deleted_at IS NULL`).get(it.id).n;
  assert.equal(outs, 1);
  // 8 일일재고는 업체재고를 바꾸지 않음
  assert.equal(stock().vendor_stock, vendor);
});

test('check: back-dated 입고·출고 add/edit/delete keep a later count and the lead\'s usage (no double, no loss)', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, '더마 하이드로 팩'), st = () => item(e, '더마 하이드로 팩').hospital_stock;
  await call(e, '/receive', 'POST', { item_id: it.id, actual_qty: 50, amount: 1000, date: '2026-11-01' });
  // 11/6 실사: 사용 3, 마감재고 40(재고 차이 −7)
  await call(e, '/daily', 'POST', { date: '2026-11-06', closing: { [it.id]: 40 }, opening: { [it.id]: 43 } });
  assert.equal(st(), 40);
  const day6 = async () => { const d = (await call(e, '/daily?date=2026-11-06')).data.items.find(x => x.id === it.id); return [d.stock_at, Math.round((d.used + (d.open_fix || 0)) * 1000) / 1000]; };
  // 11/5에 받은 10개를 나중에 적음 → 11/6 센 40은 그대로, 사용 3도 그대로(두 번 더해지지 않음)
  const r = await call(e, '/receive', 'POST', { item_id: it.id, actual_qty: 10, amount: 1000, date: '2026-11-05' });
  assert.equal(st(), 40); assert.deepEqual(await day6(), [40, 3]);
  // 그 입고 수량 10 → 12 수정 → 그대로
  await call(e, `/tx/${r.data.tx_id}`, 'PATCH', { actual_qty: 12 });
  assert.equal(st(), 40); assert.deepEqual(await day6(), [40, 3]);
  // 지움 → 그대로
  await call(e, `/tx/${r.data.tx_id}`, 'DELETE');
  assert.equal(st(), 40); assert.deepEqual(await day6(), [40, 3]);
  // 실사 뒤 날짜의 출고는 그대로 빠짐
  await call(e, '/out', 'POST', { item_id: it.id, qty: 4, date: '2026-11-07' });
  assert.equal(st(), 36); assert.deepEqual(await day6(), [40, 3]);
  // 11/4 출고를 나중에 적음 → 11/6 센 40 그대로, 지금 36 그대로
  await call(e, '/out', 'POST', { item_id: it.id, qty: 2, date: '2026-11-04' });
  assert.equal(st(), 36); assert.deepEqual(await day6(), [40, 3]);
  // 앞날(11/3)을 나중에 셈 → 11/6 사용 3은 그대로
  await call(e, '/daily', 'POST', { date: '2026-11-03', closing: { [it.id]: 45 } });
  assert.equal(st(), 36); assert.deepEqual(await day6(), [40, 3]);
});

test('check: tx list stock column is the stock as of that date, also for records written later', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, '더마 하이드로 팩');
  await call(e, '/receive', 'POST', { item_id: it.id, actual_qty: 30, amount: 1000, date: '2026-10-01' });
  await call(e, '/daily', 'POST', { date: '2026-10-31', closing: { [it.id]: 26 }, opening: { [it.id]: 30 } });
  await call(e, '/receive', 'POST', { item_id: it.id, actual_qty: 300, amount: 1000, date: '2026-11-06' });
  const rows = (await call(e, `/tx?item_id=${it.id}`)).data.rows;
  const oct31 = rows.filter(r => r.date === '2026-10-31');
  assert.equal(Math.min(...oct31.map(r => r.stock_asof)), 26);
  assert.equal(rows.find(r => r.date === '2026-11-06').stock_asof, 326);
});

test('check: datefix2 puts the one November 300-sheet prepaid receipt on 11/6 once (never twice)', async () => {
  const e = env(); await call(e, '/state');
  const it = item(e, '보관용 3종 시트팩');
  e.inv.prepare('UPDATE inv_items SET hospital_stock = 6 WHERE id = ?').run(it.id);
  e.inv.prepare(`INSERT INTO inv_tx (date, kind, item_id, qty, hospital_delta, vendor_delta, memo, created_at) VALUES ('2026-11-09', 'prepaid_in', ?, 300, 300, -300, '입고', 1)`).run(it.id);
  e.inv.prepare('UPDATE inv_items SET hospital_stock = hospital_stock + 300 WHERE id = ?').run(it.id);
  const f = e.inv.prepare(`SELECT value FROM inv_meta WHERE key = 'fixes'`).get().value;
  e.inv.prepare(`UPDATE inv_meta SET value = ? WHERE key = 'fixes'`).run(f.replace('datefix2', '').trim());
  const { resetInvSchemaCache } = await import('../worker/invSchema.js'); resetInvSchemaCache();
  await call(e, '/state'); resetInvSchemaCache(); await call(e, '/state');
  const rows = e.inv.prepare(`SELECT date FROM inv_tx WHERE item_id = ? AND kind = 'prepaid_in' AND deleted_at IS NULL`).all(it.id);
  assert.deepEqual(rows.map(r => r.date), ['2026-11-06']);
  assert.equal(item(e, '보관용 3종 시트팩').hospital_stock, 306);
});

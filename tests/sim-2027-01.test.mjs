// 2027년 1월 한 달 가상 운영 점검(2026-11-11 사용자 요청): 직원 스케줄·성과표·재고(주문·입고·출고·일일재고·선결제·입고 취소)·월말보고.
// 실제 자료와 상관없는 빈 메모리 DB에서만 돈다. 오늘은 2027-02-01로 고정(1월이 지난달이 되게).
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const FIXED = Date.parse('2027-02-01T03:00:00Z');
const SHOW = process.argv.includes('--sim-report'); // 결과 숫자 보기: node --test tests/sim-2027-01.test.mjs -- --sim-report
const RealDate = Date;
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [FIXED])); } static now() { return FIXED; } };
const { handleApi } = await import('../worker/index.js');

function d1(sqlite) {
  return {
    prepare(sql) { const s = sqlite.prepare(sql); const b = (...v) => ({
      async first() { return s.get(...v) ?? null; }, async all() { return { results: s.all(...v) }; },
      async run() { return { meta: { changes: s.run(...v).changes } }; },
    }); return { bind: b, ...b() }; },
    async batch(list) { sqlite.exec('BEGIN'); try { const r = []; for (const s of list) r.push(await s.run()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } },
    async exec(sql) { sqlite.exec(sql); },
  };
}
const inv = new DatabaseSync(':memory:');
const E = { inv, INV_DB: d1(inv), DB: d1(new DatabaseSync(':memory:')), SKIP_OLD_DAILY_FIX: true };
async function api(path, method = 'GET', body) {
  const h = new Headers({ Origin: 'https://site.test', 'oai-authenticated-user-id': 'sim', 'oai-authenticated-user-email': 'sim@test.invalid' });
  if (body) h.set('Content-Type', 'application/json');
  const r = await handleApi(new Request(`https://site.test/api${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), E);
  return { status: r.status, data: await r.json() };
}
const ok = async (path, method, body) => { const r = await api(path, method, body); assert.equal(r.status, 200, `${method} ${path} ${JSON.stringify(body)} → ${JSON.stringify(r.data)}`); return r.data; };
const item = name => inv.prepare('SELECT * FROM inv_items WHERE name = ?').get(name);
const days = Array.from({ length: 31 }, (_, i) => `2027-01-${String(i + 1).padStart(2, '0')}`);
const dow = d => new RealDate(`${d}T00:00:00Z`).getUTCDay();
const min = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

// ── 1. 스케줄(2026-11-11 사용자 기준): 빨간 날(일요일·1/1 신정)은 병원 휴무 — 아무도 근무·성과 대상 아님.
// 그 밖에 모두 주 5일(월~토 중 하루 휴무), 그중 1일은 상담. 팀장 1/26 미기록(작성 제외), 직원3 1/12 미기록(지정 환자 수만 적음).
const { isRedDay } = await import('../worker/redDays.js');
const PLAN = { 1: { off: [4], consult: 3 }, 2: { off: [1], consult: 2 }, 3: { off: [5], consult: 6 }, 4: { off: [6], consult: 1 }, 5: { off: [2], consult: 4 } };
const SPECIAL = { '2-2027-01-14': ['기타', '14:00', '19:30', '2시 출근'], '1-2027-01-22': ['기타', '10:00', '15:00', '조퇴'], '1-2027-01-26': ['미기록'], '3-2027-01-12': ['미기록'] };
const sched = {}; // `${id}-${date}` → { att, s, e, mg, dg }
for (const id of [1, 2, 3, 4, 5]) for (const d of days) {
  const p = PLAN[id], w = dow(d), k = `${id}-${d}`, n = Number(d.slice(8));
  const mg = 4 + ((n * 7 + id * 3) % 6), dg = (n + id) % 3;
  if (isRedDay(d)) sched[k] = { att: null }; // 휴일: 적지 않음
  else if (SPECIAL[k]?.[0] === '미기록') sched[k] = { att: '미기록', dg: 2 };
  else if (SPECIAL[k]) { const [att, s, e, det] = SPECIAL[k]; sched[k] = { att, s, e, det, mg: Math.max(1, mg - 3), dg: Math.min(dg, 1) }; }
  else if (p.off.includes(w)) sched[k] = { att: '휴무' };
  else if (w === p.consult) sched[k] = { att: '상담', dg };
  else sched[k] = { att: '정상근무', s: '10:00', e: '19:30', mg, dg };
}
const leader = d => sched[`1-${d}`];
const leaderWorks = d => !isRedDay(d) && ['정상근무', '기타'].includes(leader(d).att);

test('2027-01 가상 운영', async t => {
  const list = await ok('/staff/list');
  assert.equal(list.find(s => s.id === 1).is_leader, 1);
  await ok('/inventory/state');

  await t.test('1·2. 스케줄 입력 → 성과표 계산이 손계산과 같음', async () => {
    for (const id of [1, 2, 3, 4, 5]) for (const d of days) { // 팀장 먼저
      const r = sched[`${id}-${d}`];
      if (!r.att) continue;
      const body = { staff_id: id, work_date: d, attendance: r.att };
      if (r.att === '기타') Object.assign(body, { etc_type: 'time', etc_detail: r.det, start_time: r.s, end_time: r.e });
      if (r.att === '정상근무') Object.assign(body, { start_time: r.s, end_time: r.e });
      if (r.mg != null) body.managed_count = r.mg;
      if (r.dg != null) body.designated_count = r.dg;
      await ok('/staff/attendance', 'POST', body);
    }
    // 빨간 날에 근무를 적어도(1/10 일요일) 관리수·지정 환자 수는 받지 않고 성과에서도 빠짐
    await ok('/staff/attendance', 'POST', { staff_id: 2, work_date: '2027-01-10', attendance: '정상근무', start_time: '10:00', end_time: '19:30', managed_count: 9, designated_count: 3 });
    const sun = inv.prepare(`SELECT managed_count, designated_count FROM staff_attendance WHERE staff_id = 2 AND work_date = '2027-01-10'`).get();
    assert.deepEqual([sun.managed_count, sun.designated_count], [null, null]);
    const perf = await ok('/staff/performance?month=2027-01');
    if (SHOW) console.log('PERF', JSON.stringify(perf.map(p => [p.id, p.work_days, p.total_hours, p.total_managed, p.avg_managed, p.total_designated, p.consult_count])));
    assert.ok(perf.find(x => x.id === 2).exclusions.some(x => x.date === '2027-01-10' && x.reason.includes('휴일')));
    for (const id of [1, 2, 3, 4, 5]) {
      let mins = 0, mg = 0, mgN = 0, dg = 0, dgN = 0, workDays = 0;
      for (const d of days) {
        const r = sched[`${id}-${d}`], own = ['정상근무', '기타'].includes(r.att);
        let credited = 0;
        if (own && id === 1) credited = min(r.e) - min(r.s);
        else if (own && leaderWorks(d)) credited = Math.max(0, Math.min(min(r.e), min(leader(d).e)) - Math.max(min(r.s), min(leader(d).s)));
        if (credited > 0) { mins += credited; workDays++; }
        if (own && (id === 1 || leaderWorks(d)) && r.mg != null) { mg += r.mg; mgN++; }
        if ((own || r.att === '상담' || r.att === '미기록') && r.dg != null) { dg += r.dg; dgN++; }
      }
      const p = perf.find(x => x.id === id);
      const want = { work_days: workDays, total_hours: Math.round(mins / 6) / 10, total_managed: mgN ? mg : null, total_designated: dgN ? dg : null, avg_managed: mgN && mins ? Math.round(mg / (mins / 60) * 10) / 10 : null };
      assert.deepEqual({ work_days: p.work_days, total_hours: p.total_hours, total_managed: p.total_managed, total_designated: p.total_designated, avg_managed: p.avg_managed }, want, `직원 ${id}`);
      assert.equal(p.consult_count, days.filter(d => sched[`${id}-${d}`].att === '상담').length);
      // 지정 환자 수는 관리수에 더하지 않음
      assert.ok(p.total_managed == null || p.total_designated == null || p.total_managed !== p.total_managed + p.total_designated || p.total_designated === 0);
    }
    // 주 5일: 월~토 중 하루 휴무(빨간 날 제외)
    for (const id of [1, 2, 3, 4, 5]) {
      const work = days.filter(d => sched[`${id}-${d}`].att && sched[`${id}-${d}`].att !== '휴무').length;
      assert.ok(work >= 20 && work <= 22, `직원 ${id} 근무 ${work}일`);
    }
    assert.ok(!days.some(d => isRedDay(d) && sched[`1-${d}`].att), '빨간 날에는 근무 없음');
    assert.equal(isRedDay('2027-01-01'), true);
    // 총 피부관리 인원(일일재고) = 그날 직원 관리 인원 합계
    const d = '2027-01-05';
    const want = [1, 2, 3, 4, 5].map(id => sched[`${id}-${d}`]).filter(r => r.mg != null).reduce((a, r) => a + r.mg, 0);
    assert.equal((await ok(`/inventory/daily?date=${d}`)).day.patients, want);
  });

  // ── 3·4. 재고 ──
  const P = '보관용 3종 시트팩', S = '일회용해면', G = 'GA20%', C = '클렌징 젤 300ml';
  const ledger = {}; // 손으로 따라가는 병원재고·업체 보관 잔량
  const expectStock = (name, h, v) => { const it = item(name); assert.equal(it.hospital_stock, h, `${name} 병원재고`); if (v != null) assert.equal(it.vendor_stock, v, `${name} 업체 보관 잔량`); };
  let spendGeneral = 0, spendPrepaid = 0, inCount = 0;
  const used = { [P]: 0, [S]: 0, [G]: 0 };

  await t.test('3. 시작 재고(12/31 재고 맞추기)', async () => {
    for (const [n, h] of [[P, 100], [S, 20], [G, 10]]) await ok('/inventory/adjust', 'POST', { item_id: item(n).id, hospital_stock: h, vendor_stock: 0, date: '2026-12-31', memo: '가상 시작 재고' });
    Object.assign(ledger, { [P]: [100, 0], [S]: [20, 0], [G]: [10, 0] });
    expectStock(P, 100, 0); expectStock(S, 20, 0); expectStock(G, 10, 0);
  });

  // 일일재고: 팀장 근무일만(일·화·금·토), 휴무(월·목)·상담(수)은 건너뜀
  const daily = async (d, body) => ok('/inventory/daily', 'POST', { date: d, patients: null, status: null, extra: {}, used: {}, closing: {}, opening: {}, ...body });

  // 날짜 순서대로: 그날 생긴 입출고 → (팀장 근무일이면) 마감 일일재고
  const ev = {
    '2027-01-05': async () => { // 선결제: 300장 결제 + 병원 입고 예정 200
      const pp = item(P), o300 = inv.prepare('SELECT * FROM inv_options WHERE item_id = ? AND qty = 300').get(pp.id);
      assert.equal(o300.amount, 450000);
      await ok('/inventory/prepaid-order', 'POST', { item_id: pp.id, qty: 200, option_id: o300.id, date: '2027-01-05' });
      spendPrepaid += 450000; ledger[P][1] += 300;
      expectStock(P, ledger[P][0], ledger[P][1]); // 주문만으로 병원재고 그대로
    },
    '2027-01-06': async () => { // 일반 주문(주문만으로 재고 그대로)
      const g = item(G), opt = inv.prepare('SELECT * FROM inv_options WHERE item_id = ? ORDER BY qty DESC LIMIT 1').get(g.id);
      await ok('/inventory/orders', 'POST', { item_id: g.id, option_id: opt.id, count: 1, date: '2027-01-06' });
      expectStock(G, ledger[G][0]);
    },
    '2027-01-08': async () => { // 선결제 150장만 도착 → 업체 보관 잔량 150
      const ord = (await ok('/inventory/state')).orders.find(o => o.item_id === item(P).id && o.prepaid);
      assert.equal(ord.qty, 200);
      await ok('/inventory/receive', 'POST', { order_id: ord.id, actual_qty: 150, date: '2027-01-08' });
      ledger[P][0] += 150; ledger[P][1] -= 150; inCount++;
      expectStock(P, ledger[P][0], 150);
      // 같은 요청 번호로 다시 보내도 한 번만
      const h = new Headers({ Origin: 'https://site.test', 'oai-authenticated-user-id': 'sim', 'oai-authenticated-user-email': 'sim@test.invalid', 'Content-Type': 'application/json', 'x-req-id': 'sim-dup-000001' });
      const send = () => handleApi(new Request('https://site.test/api/inventory/out', { method: 'POST', headers: h, body: JSON.stringify({ item_id: item(G).id, qty: 1, date: '2027-01-08' }) }), E);
      await send(); await send();
      ledger[G][0] -= 1; used[G] += 1;
      expectStock(G, ledger[G][0]);
    },
    '2027-01-09': async () => { // 일반 주문 나눠 도착 1차(결제는 여기서 한 번)
      const ord = (await ok('/inventory/state')).orders.find(o => o.item_id === item(G).id && o.status === 'ordered');
      gOrder = ord; const total = ord.qty + ord.bonus_qty; gFirst = Math.max(1, Math.floor(total / 2));
      await ok('/inventory/receive', 'POST', { order_id: ord.id, actual_qty: gFirst, date: '2027-01-09' });
      ledger[G][0] += gFirst; spendGeneral += ord.amount; inCount++;
      expectStock(G, ledger[G][0]);
    },
    '2027-01-12': async () => { // 2차 도착(0원)
      const rest = gOrder.qty + gOrder.bonus_qty - gFirst;
      if (rest > 0) { await ok('/inventory/receive', 'POST', { order_id: gOrder.id, actual_qty: rest, date: '2027-01-12' }); ledger[G][0] += rest; inCount++; }
      const amounts = inv.prepare('SELECT amount FROM inv_tx WHERE order_id = ? AND deleted_at IS NULL ORDER BY id').all(gOrder.id).map(r => r.amount);
      assert.equal(amounts[0], gOrder.amount); assert.ok(amounts.slice(1).every(a => !a));
      expectStock(G, ledger[G][0]);
    },
    '2027-01-13': async () => { // 출고
      await ok('/inventory/out', 'POST', { item_id: item(G).id, qty: 3, date: '2027-01-13', memo: '간호팀' });
      ledger[G][0] -= 3; used[G] += 3;
      expectStock(G, ledger[G][0]);
      assert.equal((await api('/inventory/out', 'POST', { item_id: item(G).id, qty: 9999, date: '2027-01-13' })).status, 400);
    },
    '2027-01-29': async () => { // 카드결제 업체(더마소드) 주문 → 주문할 때 결제(1월), 물건은 2/2 도착
      const c = item(C), opt = inv.prepare('SELECT * FROM inv_options WHERE item_id = ? AND prepaid = 0 LIMIT 1').get(c.id);
      await ok('/inventory/orders', 'POST', { item_id: c.id, option_id: opt.id, count: 1, date: '2027-01-29' });
      cardOrder = (await ok('/inventory/state')).orders.find(o => o.item_id === c.id && o.status === 'ordered');
      spendGeneral += cardOrder.amount;
      expectStock(C, item(C).hospital_stock);
    },
    '2027-01-15': async () => { // 해면 입고(주문 없이) — 같은 날 센 뒤 1/19에 취소
      await ok('/inventory/receive', 'POST', { item_id: item(S).id, actual_qty: 10, amount: 45000, date: '2027-01-15' });
      ledger[S][0] += 10; spendGeneral += 45000; inCount++;
    },
  };
  let gOrder = null, gFirst = 0, cardOrder = null;

  await t.test('3·4. 날짜순 입출고 + 일일재고(근무일만), 건너뛴 날 재고 그대로, 실사는 그 수량으로 한 번만, 입고 취소', async () => {
    const p = item(P), s = item(S);
    let n = 0;
    for (const d of days) {
      if (ev[d]) await ev[d]();
      if (!leaderWorks(d)) { // 휴무·상담: 작성 제외, 적지 않음, 재고 그대로
        const r = await ok(`/inventory/daily?date=${d}`);
        assert.equal(r.record.state, 'skip', `${d} ${leader(d).att}`);
        assert.equal(r.items.find(i => i.id === p.id).stock_at, ledger[P][0], `${d} 건너뛴 날 장부`);
        continue;
      }
      n++;
      const pUse = 3 + (n % 4), sCount = ledger[S][0] - 1;
      const pClose = ledger[P][0] - pUse - (d === '2027-01-19' ? 2 : 0); // 1/19: 장부보다 2개 적게 셈 → 재고 차이 −2 한 번만
      const body = { used: { [p.id]: pUse }, closing: { [p.id]: pClose, [s.id]: sCount }, opening: { [p.id]: pClose + pUse } };
      await daily(d, body);
      used[P] += pUse; used[S] += 1;
      ledger[P][0] = pClose; ledger[S][0] = sCount;
      expectStock(P, ledger[P][0], ledger[P][1]); expectStock(S, ledger[S][0]);
      await daily(d, body); // 같은 값 다시 저장 → 그대로
      expectStock(P, ledger[P][0], ledger[P][1]); expectStock(S, ledger[S][0]);
      if (d === '2027-01-19') {
        const tx = inv.prepare(`SELECT id FROM inv_tx WHERE item_id = ? AND date = '2027-01-15' AND kind = 'in'`).get(s.id).id;
        const sBefore = item(S).hospital_stock;
        const cr = await ok(`/inventory/tx/${tx}/cancel`, 'POST', { reason: '가상: 반품' });
        assert.deepEqual([cr.kept, cr.diff], ['2027-01-15', 10]);
        assert.equal(item(S).hospital_stock, sBefore, '입고한 날·그 뒤에 센 수량이 있으므로 재고는 그대로');
        assert.equal((await api(`/inventory/tx/${tx}/cancel`, 'POST', { reason: '두 번' })).data.unchanged, true);
        inCount--; // 취소한 입고는 건수에서 빠지고 결제는 남음
        // 1/15(입고한 날)에 센 수량은 그대로, 취소로 생긴 10은 그날 '재고 차이'로만 — 사용량(1)은 그대로
        assert.equal(inv.prepare(`SELECT count(*) AS n FROM inv_tx WHERE item_id = ? AND daily_date = '2027-01-15' AND memo LIKE '%입고 취소%' AND hospital_delta = 10 AND deleted_at IS NULL`).get(s.id).n, 1);
        // 그 날 일일재고를 다시 저장해도 차이가 사용량으로 바뀌지 않음
        const sc15 = inv.prepare(`SELECT round(hospital_stock - coalesce((SELECT sum(hospital_delta) FROM inv_tx t WHERE t.item_id = inv_items.id AND t.deleted_at IS NULL AND t.date > '2027-01-15'), 0), 3) AS q FROM inv_items WHERE id = ?`).get(s.id).q;
        await daily('2027-01-15', { closing: { [s.id]: sc15 } });
        assert.equal(inv.prepare(`SELECT coalesce(sum(qty), 0) AS q FROM inv_tx WHERE item_id = ? AND daily_date = '2027-01-15' AND kind = 'out' AND deleted_at IS NULL`).get(s.id).q, 1);
        // 실사 수정(이후 거래 없음): +5 고치면 최종도 +5
        const fix = { used: { [p.id]: pUse }, closing: { [p.id]: pClose + 5, [s.id]: sCount }, opening: { [p.id]: pClose + 5 + pUse } };
        await daily(d, fix); ledger[P][0] = pClose + 5;
        expectStock(P, ledger[P][0], ledger[P][1]);
      }
    }
    expectStock(P, ledger[P][0], 150); // 업체 보관 잔량은 일일재고로 안 바뀜
    expectStock(G, ledger[G][0]);
  });

  await t.test('5. 월말보고 = 입력 기록', async () => {
    const rep = await ok('/inventory/report?month=2027-01');
    if (SHOW) console.log('REP', JSON.stringify({ spend: [rep.spend_total, rep.spend_general, rep.spend_prepaid], in: rep.in_count, patients: rep.patients, usage: rep.usage.map(u => [u.name, u.used]), pays: rep.payments.map(p => [p.name, p.when, p.amount]), pp: rep.prepaid.filter(x => x.name.includes('3종')).map(x => [x.hospital_stock, x.vendor_stock]), stock: [item(S).hospital_stock, item(G).hospital_stock] }));
    assert.equal(rep.as_of, '2027-01-31');
    assert.equal(rep.spend_prepaid, spendPrepaid);
    assert.equal(rep.spend_general, spendGeneral);
    assert.equal(rep.spend_total, spendPrepaid + spendGeneral);
    assert.equal(rep.in_count, inCount);
    const pp = rep.prepaid.find(x => x.name === P);
    assert.deepEqual([pp.hospital_stock, pp.vendor_stock], [ledger[P][0], ledger[P][1]]);
    const u = n => rep.usage.find(x => x.name === n)?.used || 0;
    assert.equal(u(G), used[G]);
    assert.equal(u(P), used[P]); // 사용량(재고 차이 −2·+5는 사용량이 아님)
    assert.equal(u(S), used[S]); // 마감재고 품목: 센 수량 차이가 사용량
    // 결제 내역: 업체별 합계 = 지출 합계, 계좌이체 업체는 예금주·은행·계좌번호 칸, 결제 시점 구분
    const pay = n => rep.payments.find(x => x.name === n);
    assert.equal(rep.payments.reduce((a, x) => a + x.amount, 0), rep.spend_total);
    assert.equal(pay('하라셀').when, '월말 결제'); assert.equal(pay('하라셀').amount, 450000);
    assert.equal(pay('더마소드').when, '주문 시 결제'); assert.equal(pay('더마소드').amount, cardOrder.amount);
    for (const n of ['피부미소', '중외']) { assert.equal(pay(n).when, '월말 결제'); assert.ok('holder' in pay(n) && 'bank' in pay(n) && 'account' in pay(n), n); }
    assert.ok(!('account' in pay('더마소드')));
    assert.equal(pay('피부미소').amount, 45000); // 입고를 취소해도 결제는 그대로
    // 카드 주문 물건이 2/2에 와도 2월에 다시 세지 않음
    await ok('/inventory/receive', 'POST', { order_id: cardOrder.id, actual_qty: cardOrder.qty + cardOrder.bonus_qty, date: '2027-02-02' });
    const feb = await ok('/inventory/report?month=2027-02');
    assert.equal(feb.spend_general, 0); assert.equal(feb.in_count, 1);
    assert.equal((await ok('/inventory/report?month=2027-01')).spend_general, spendGeneral);
    // 연간 표 1월 = 월말보고
    const yr = (await ok('/inventory/report-year?year=2027')).months.find(m => m.month === '2027-01');
    for (const k of ['spend_total', 'spend_general', 'spend_prepaid', 'in_count', 'patients']) assert.equal(yr[k], rep[k], k);
    // 총 피부관리 인원 = 일일재고에 채워진 값 합계 = 직원 관리 인원 합계(관리 인원이 있는 날)
    const staffSum = inv.prepare(`SELECT coalesce(sum(managed_count), 0) AS s FROM staff_attendance WHERE work_date LIKE '2027-01-%'`).get().s;
    assert.equal(rep.patients, staffSum);
    // 기록 없이 바뀐 재고 없음
    for (const n of [P, S, G]) {
      const it = item(n), sum = inv.prepare('SELECT coalesce(sum(hospital_delta),0) h, coalesce(sum(vendor_delta),0) v FROM inv_tx WHERE item_id = ? AND deleted_at IS NULL').get(it.id);
      assert.equal(Math.round((it.hospital_stock - sum.h) * 1000) / 1000, 0, `${n} 병원재고 = 기록 합계`);
      assert.equal(Math.round((it.vendor_stock - sum.v) * 1000) / 1000, 0, `${n} 업체 보관 잔량 = 기록 합계`);
    }
  });
});

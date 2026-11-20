import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { handleApi } from '../worker/index.js';

// 품목별 재고(2026-11-19): 변동 내역 걸러 보기·재고 차이 표가 서버 기록과 정확히 맞는지
const bundled = await build({ stdin: { contents: `export { txIs, diffDays, txTitle, monthUsed } from './src/app/components/inventory/StockMove';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', loader: { '.tsx': 'tsx', '.ts': 'ts' } });
const { txIs, diffDays, txTitle, monthUsed } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

function d1(s) { return { prepare(sql) { const st = s.prepare(sql); const b = (...v) => ({ async first() { return st.get(...v) ?? null; }, async all() { return { results: st.all(...v) }; }, async run() { return { meta: { changes: st.run(...v).changes } }; } }); return { bind: b, ...b() }; },
  async batch(l) { s.exec('BEGIN'); try { const r = []; for (const x of l) r.push(await x.run()); s.exec('COMMIT'); return r; } catch (e) { s.exec('ROLLBACK'); throw e; } }, async exec(q) { s.exec(q); } }; }
const env = () => { const inv = new DatabaseSync(':memory:'); return { inv, INV_DB: d1(inv), DB: d1(new DatabaseSync(':memory:')), SKIP_OLD_DAILY_FIX: true }; };
const call = async (e, path, method = 'GET', body) => { const h = new Headers({ Origin: 'https://site.test', 'oai-authenticated-user-id': 'u1', 'oai-authenticated-user-email': 'a@b.c' }); if (body) h.set('Content-Type', 'application/json');
  const r = await handleApi(new Request(`https://site.test/api/inventory${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), e); return { status: r.status, data: await r.json() }; };

test('item hub: filters and 재고 차이 rows match the ledger; stock = sum of shown changes', async () => {
  const e = env(); await call(e, '/state');
  const pack = e.inv.prepare(`SELECT * FROM inv_items WHERE name = '더마 하이드로 팩'`).get();
  e.inv.prepare(`INSERT INTO staff_attendance (staff_id, work_date, attendance, start_time, end_time) VALUES (1, '2026-11-09', '정상근무', '10:00', '19:30'), (1, '2026-11-10', '정상근무', '10:00', '19:30')`).run();
  await call(e, '/adjust', 'POST', { item_id: pack.id, hospital_stock: 10, date: '2026-11-02' });
  await call(e, '/out', 'POST', { item_id: pack.id, qty: 1, memo: '간호팀', date: '2026-11-04' });
  // 11/9: 남은 9 중 사용 3 적고 센 마감재고 5 → 재고 차이 −1
  const r = await call(e, '/daily', 'POST', { date: '2026-11-09', used: { [pack.id]: 3 }, closing: { [pack.id]: 5 }, opening: { [pack.id]: 8 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await call(e, '/daily', 'POST', { date: '2026-11-10', used: { [pack.id]: 2 } });
  const now = e.inv.prepare('SELECT hospital_stock FROM inv_items WHERE id = ?').get(pack.id).hospital_stock;
  assert.equal(now, 3);
  const { rows } = (await call(e, `/tx?from=2026-11-01&to=2026-11-31&item_id=${pack.id}`)).data;
  const n = f => rows.filter(t => txIs(t, f)).length;
  assert.deepEqual({ use: n('use'), out: n('out'), diff: n('diff') }, { use: 2, out: 1, diff: 2 }); // 재고 맞추기 11/2 + 11/9 재고 차이
  assert.equal(txTitle(rows.find(t => t.kind === 'out' && !t.daily_date)), '출고');
  // N월 사용 = 일일재고 사용(3 + 2) + 일반 출고(1) — 출고만 걸러 받아도 같은 값
  assert.equal(monthUsed(rows), 6);
  assert.equal(monthUsed((await call(e, `/tx?from=2026-11-01&to=2026-11-31&kind=out&item_id=${pack.id}`)).data.rows), 6);
  const d9 = diffDays(rows).find(d => d.date === '2026-11-09');
  assert.deepEqual({ used: d9.used, book: d9.book, closing: d9.closing, diff: d9.diff }, { used: 3, book: 6, closing: 5, diff: -1 });
  // 지금 재고 = 이 달 기록 증감 합(이 달 전 재고 0)
  assert.equal(Math.round(rows.reduce((a, t) => a + t.hospital_delta, 0) * 1000) / 1000, now);
  // 최근 주문(보기만): 주문이 없으면 null, 주문하면 그 날짜
  let it = (await call(e, '/state')).data.items.find(i => i.id === pack.id); assert.equal(it.last_order, null);
});

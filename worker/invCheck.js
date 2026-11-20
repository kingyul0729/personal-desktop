// 재고 기록 점검(2026-11-21 사용자 '과거 재고 보정에 누락 가능성, 확인 기능' — 고치지 않고 읽기만).
// ① 일일재고 사진 46일(dailyfix1~3): 그 날 끝 병원재고 = 사진의 마감재고인지
// ② 예전 앱 출고 사진에 맞춘 4품목(oldafter1): 맞춤 기록이 다 들어갔는지(그 품목 기록이 예상과 달라 조용히 건너뛴 품목 찾기)
// ③ 지금 0보다 적은 병원재고·업체 보관 잔량(예전 자료 넣기는 재고 숫자를 그대로 옮겨 '기록 합 = 재고'는 성립하지 않으므로 보지 않음)
// 그 날 끝 재고 = 지금 병원재고 − 그 날 뒤 기록 증감 합(입출고 내역 '병원재고' 칸과 같은 계산).
import { OLD_DAILY_COUNTS, OLD_DAILY_EXTRA, OLD_AFTER_PLAN } from './invDailyFix.js';

const r3 = v => Math.round(Number(v || 0) * 1000) / 1000;
async function all(db, sql, ...args) { return (await db.prepare(sql).bind(...args).all()).results || []; }

export async function fixCheck(db) {
  const metaRows = await all(db, `SELECT key, value FROM inv_meta WHERE key IN ('import', 'dailyfix1', 'dailyfix1_next', 'dailyfix2', 'dailyfix3', 'fixes')`);
  const meta = Object.fromEntries(metaRows.map(r => [r.key, r.value]));
  const fixes = String(meta.fixes || '').split(/\s+/);
  const imported = !!meta.import;
  const items = await all(db, 'SELECT id, name, hospital_stock, vendor_stock FROM inv_items');
  const byId = Object.fromEntries(items.map(i => [i.id, i])), byName = Object.fromEntries(items.map(i => [i.name, i]));
  const txs = await all(db, 'SELECT id, item_id, date, kind, source, hospital_delta, vendor_delta FROM inv_tx WHERE deleted_at IS NULL ORDER BY date, id');
  const byItem = {};
  for (const t of txs) (byItem[t.item_id] ||= []).push(t);
  const endOf = (id, d) => { const it = byId[id]; return r3(Number(it.hospital_stock) - (byItem[id] || []).filter(t => t.date > d).reduce((a, t) => a + Number(t.hospital_delta || 0), 0)); };

  // ① 일일재고 사진
  const daily = { run: imported, done: !!meta.dailyfix1 && !!meta.dailyfix2 && !!meta.dailyfix3, checked: 0, wrong: [] };
  if (imported) {
    const days = new Map(OLD_DAILY_COUNTS.map(d => [d.d, { ...d.i }]));
    for (const x of OLD_DAILY_EXTRA) days.set(x.d, { ...(days.get(x.d) || {}), ...x.i });
    for (const [d, list] of [...days.entries()].sort()) for (const [name, [close]] of Object.entries(list)) {
      const it = byName[name]; if (!it) continue;
      daily.checked++;
      const app = endOf(it.id, d);
      if (app !== r3(close)) daily.wrong.push({ date: d, item: name, photo: r3(close), app });
    }
  }
  // ② 출고 사진에 맞춘 4품목
  const after = [];
  const ranAfter = fixes.includes('oldafter1');
  if (imported) for (const p of OLD_AFTER_PLAN) {
    const it = byId[p.id], list = byItem[p.id] || [];
    if (!it) { after.push({ item_id: p.id, item: null, status: 'no-item' }); continue; }
    if (!ranAfter) { after.push({ item_id: p.id, item: it.name, status: 'not-run' }); continue; }
    let applied;
    if (p.reorder) { const day = list.filter(t => t.date === p.expect[0][0]); const iIn = day.findIndex(t => t.kind === 'in'), iOut = day.findIndex(t => t.kind === 'out'); applied = iIn >= 0 && iOut > iIn; }
    else applied = list.filter(t => t.source === 'oldafter1').length === (p.add || []).length;
    const before = list.filter(t => t.date <= '2026-11-05' && t.source !== 'oldafter1').length;
    after.push({ item_id: p.id, item: it.name, status: applied ? 'applied' : 'skipped', records: before, expected: p.expect.length });
  }
  // ③ 0보다 적은 재고
  const ledger = items.filter(it => Number(it.hospital_stock) < 0 || Number(it.vendor_stock) < 0).map(it => ({ item: it.name, hospital: r3(it.hospital_stock), vendor: r3(it.vendor_stock) }));
  return {
    imported,
    fixes: { dailyfix1: !!meta.dailyfix1, dailyfix2: !!meta.dailyfix2, dailyfix3: !!meta.dailyfix3, oldafter1: fixes.includes('oldafter1'), daily_next: Number(meta.dailyfix1_next || 0) },
    daily, after, ledger,
    ok: daily.wrong.length === 0 && after.every(a => a.status === 'applied') && ledger.length === 0,
  };
}

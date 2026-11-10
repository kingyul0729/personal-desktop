// 입고·출고 기록의 날짜 고치기(2026-11-10 사용자: 11/6에 들어온 300장을 11/9로 입고확정해 11/6 실사와 두 번 더해짐).
// 병원재고 합계는 그대로. 옮긴 두 날짜 사이에 그 품목을 일일재고로 센 날이 있으면, 가장 이른 그 날 센 마감재고가 그대로 남도록
// 그 날 '마감 전 재고 고침'(adjust)만 반대로 맞춘다(없으면 새로 만듦). 문제가 있으면 오류 문장을, 끝나면 null을 돌려준다.
const round = v => Math.round(v * 1000) / 1000;
export async function moveTxDate(db, tx, date, user) {
  if (date === tx.date) return null;
  const lo = date < tx.date ? date : tx.date, hi = date < tx.date ? tx.date : date;
  const h = round(tx.hospital_delta || 0), comp = round(date < tx.date ? -h : h);
  const counted = h ? await db.prepare(`SELECT min(daily_date) AS d FROM inv_tx WHERE deleted_at IS NULL AND item_id = ? AND daily_date IS NOT NULL AND daily_date >= ? AND daily_date < ?`).bind(tx.item_id, lo, hi).first() : null;
  const stmts = [db.prepare(`UPDATE inv_tx SET date = ?, memo = trim(coalesce(memo, '') || ' ' || ?) WHERE id = ?`).bind(date, `(날짜 ${Number(tx.date.slice(5, 7))}/${Number(tx.date.slice(8))}→${Number(date.slice(5, 7))}/${Number(date.slice(8))} 수정)`, tx.id)];
  if (counted?.d && comp) {
    const item = await db.prepare('SELECT hospital_stock, stock_unit FROM inv_items WHERE id = ?').bind(tx.item_id).first();
    if (round(item.hospital_stock + comp) < 0) return `병원재고(${round(item.hospital_stock)} ${item.stock_unit})가 모자라요.`;
    const fix = await db.prepare(`SELECT id FROM inv_tx WHERE deleted_at IS NULL AND item_id = ? AND daily_date = ? AND kind = 'adjust' AND memo LIKE '마감 전 재고 고침%' ORDER BY id LIMIT 1`).bind(tx.item_id, counted.d).first();
    stmts.push(db.prepare(`UPDATE inv_items SET hospital_stock = round(hospital_stock + ?, 3), updated_at = ? WHERE id = ?`).bind(comp, Date.now(), tx.item_id));
    stmts.push(fix ? db.prepare(`UPDATE inv_tx SET hospital_delta = round(hospital_delta + ?, 3), qty = abs(round(hospital_delta + ?, 3)) WHERE id = ?`).bind(comp, comp, fix.id)
      : db.prepare(`INSERT INTO inv_tx (item_id, kind, date, qty, hospital_delta, vendor_delta, memo, daily_date, created_by, created_at) VALUES (?, 'adjust', ?, ?, ?, 0, ?, ?, ?, ?)`).bind(tx.item_id, counted.d, Math.abs(comp), comp, '마감 전 재고 고침 · 입고 날짜 수정', counted.d, user || null, Date.now()));
  }
  await db.batch(stmts);
  return null;
}

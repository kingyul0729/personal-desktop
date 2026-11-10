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

// 기록을 더하거나·고치거나·지울 때 그 날짜 뒤(같은 날 포함)에 이미 센 마감재고가 있으면 그 수량이 그대로 남게 한다
// (2026-11-10 사용자 '입출고·일일재고가 누락·중복 없이 연동'). 센 날 = 마감재고 품목은 일일재고 기록이 있는 날, 사용량 품목은 메모에 '마감재고'가 붙은 날.
// 사용량 품목: 팀장이 적은 당일 사용량(출고 기록)은 그대로 두고 그 날 '마감 전 재고 고침'(재고 차이)만 반대로 맞춘다.
// 마감재고 품목: 사용량이 마감재고로 계산되는 품목이라 그 날 사용량을 다시 계산한다(한 줄로).
// strict = 같은 날은 빼고 다음 날부터(일일재고 저장 자체가 그 날의 기록일 때).
// asDiff(입고 취소, 2026-11-11 사용자 '취소로 생긴 차이가 사용량으로 잘못 계산되지 않게'): 마감재고 품목도 사용량을 다시 계산하지 않고
// 그 센 날의 '마감 전 재고 고침'(재고 차이)으로만 남긴다. 돌려주는 배열의 kept = 수량을 지킨 센 날.
export async function keepCountStmts(db, itemId, date, change, user, strict = false, asDiff = false) {
  change = round(change || 0);
  if (!change) return [];
  const item = await db.prepare('SELECT id, hospital_stock, daily_mode FROM inv_items WHERE id = ?').bind(itemId).first();
  if (!item || !item.daily_mode) return [];
  const next = await db.prepare(`SELECT daily_date AS d FROM inv_tx WHERE deleted_at IS NULL AND item_id = ? AND daily_date ${strict ? '>' : '>='} ? AND kind IN ('out', 'adjust') AND (memo LIKE '%마감재고%' OR ? = 'count') ORDER BY daily_date LIMIT 1`).bind(item.id, date, item.daily_mode).first();
  if (!next) return [];
  const now = Date.now(), out = [db.prepare('UPDATE inv_items SET hospital_stock = round(hospital_stock - ?, 3), updated_at = ? WHERE id = ?').bind(change, now, item.id)];
  out.kept = next.d;
  if (item.daily_mode === 'usage' || asDiff) {
    // 마감재고 품목의 입고 취소 차이는 따로 한 줄('입고 취소' 메모)로 — 일일재고를 다시 저장해도 사용량으로 바뀌지 않게 알아볼 수 있도록
    const fix = await db.prepare(`SELECT id FROM inv_tx WHERE deleted_at IS NULL AND item_id = ? AND daily_date = ? AND kind = 'adjust' AND ${item.daily_mode === 'usage' ? "(memo LIKE '마감 전 재고 고침%' OR memo LIKE '일일 마감재고 확인%')" : "memo LIKE '%입고 취소%'"} ORDER BY id LIMIT 1`).bind(item.id, next.d).first();
    out.push(fix ? db.prepare('UPDATE inv_tx SET hospital_delta = round(hospital_delta - ?, 3), qty = abs(round(hospital_delta - ?, 3)) WHERE id = ?').bind(change, change, fix.id)
      : db.prepare(`INSERT INTO inv_tx (item_id, kind, date, qty, hospital_delta, vendor_delta, memo, daily_date, created_by, created_at) VALUES (?, 'adjust', ?, ?, ?, 0, ?, ?, ?, ?)`).bind(item.id, next.d, Math.abs(change), -change, asDiff ? '마감 전 재고 고침 · 입고 취소 · 마감재고' : '마감 전 재고 고침 · 마감재고', next.d, user || null, now));
    return out;
  }
  const rows = (await db.prepare(`SELECT id, hospital_delta FROM inv_tx WHERE deleted_at IS NULL AND item_id = ? AND daily_date = ? AND kind IN ('out', 'adjust')`).bind(item.id, next.d).all()).results || [];
  const net = round(rows.reduce((a, t) => a + t.hospital_delta, 0) - change);
  for (const t of rows) out.push(db.prepare('UPDATE inv_tx SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(now, user || null, t.id));
  out.push(db.prepare(`INSERT INTO inv_tx (item_id, kind, date, qty, hospital_delta, vendor_delta, memo, daily_date, created_by, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`)
    .bind(item.id, net < 0 ? 'out' : 'adjust', next.d, Math.abs(net), net, net < 0 ? '일일 마감 소모 · 마감재고' : '일일 마감재고 확인', next.d, user || null, now));
  return out;
}
// 재고가 줄어드는 쪽을 나중에(중간에 0 밑으로 내려가지 않게)
export const ordered = (change, txStmts, keep) => (change > 0 ? [...txStmts, ...keep] : [...keep, ...txStmts]);

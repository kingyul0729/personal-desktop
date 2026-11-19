// 업체 잔액(2026-11-19 사용자 지정, 금액 기준): 중복 결제·반품·단가 정정 등으로 업체에 남아 있는 우리 돈.
// 등록(add) → 차감(use, 주문 하나에 걸림) → 환급 입금(refund) → 남은 금액 = 등록 − 차감 − 환급.
// 선결제로 산 물건은 수량(업체 보관 잔량)으로만 관리하고 여기에는 넣지 않는다(같은 돈이 두 번 잡히지 않게).
// 지출: 물품 구매 금액(주문·입고 금액 그대로)에서 잔액 차감만큼 빼서 '실제 결제 금액'으로 센다. 차감은 그 주문의 구매 금액이 잡히는 달에 함께 빠진다.
export const BAL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS inv_vendor_bal (id INTEGER PRIMARY KEY, vendor_id INTEGER NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL, amount REAL NOT NULL,
     reason TEXT, memo TEXT, order_id INTEGER, created_by TEXT, created_at INTEGER, updated_by TEXT, updated_at INTEGER, deleted_at INTEGER, deleted_by TEXT)`,
  `CREATE INDEX IF NOT EXISTS inv_vendor_bal_v ON inv_vendor_bal(vendor_id, date)`,
  `CREATE INDEX IF NOT EXISTS inv_vendor_bal_o ON inv_vendor_bal(order_id)`,
];
export const BAL_REASONS = ['중복 결제', '반품', '단가 정정', '기타'];
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const bad = (error, status = 400) => json({ error }, status);
const okDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const won = n => Math.round(Number(n) || 0);
async function all(db, sql, ...a) { return (await db.prepare(sql).bind(...a).all()).results || []; }
async function one(db, sql, ...a) { return db.prepare(sql).bind(...a).first(); }

const SIGNED = `CASE kind WHEN 'add' THEN amount ELSE -amount END`;
export async function balanceOf(db, vendorId) {
  return won((await one(db, `SELECT coalesce(sum(${SIGNED}), 0) AS b FROM inv_vendor_bal WHERE vendor_id = ? AND deleted_at IS NULL`, vendorId))?.b);
}
/** 주문과 함께 넣는 차감 한 줄(같은 batch 안에서 방금 넣은 주문 = max(id)). */
export function useStmt(db, vendorId, amount, date, user, orderIdSql = '(SELECT max(id) FROM inv_orders)') {
  return db.prepare(`INSERT INTO inv_vendor_bal (vendor_id, date, kind, amount, reason, order_id, created_by, created_at) VALUES (?,?,'use',?,'주문',${orderIdSql},?,?)`)
    .bind(vendorId, date, won(amount), user, Date.now());
}
/** 주문이 취소되면 그 주문에 걸린 차감도 되돌린다(잔액이 다시 생김). */
export const undoUseStmt = (db, orderId, user) => db.prepare(`UPDATE inv_vendor_bal SET deleted_at = ?, deleted_by = ? WHERE order_id = ? AND kind = 'use' AND deleted_at IS NULL`).bind(Date.now(), user, orderId);
/** 주문 때 잔액에서 쓸 금액: min(남은 금액, 주문 금액). */
export async function planUse(db, vendorId, amount) {
  if (!vendorId || !(amount > 0)) return 0;
  return Math.min(await balanceOf(db, vendorId), won(amount));
}

const PAID_AT_ORDER = `(v.pay_timing = 'order' OR (coalesce(v.pay_timing, '') NOT IN ('order', 'month') AND (v.payment_method LIKE '%카드%' OR v.payment_method LIKE '%홈페이지%')))`;
/** 보고서용: 기간 안에 '구매 금액이 잡히는' 주문에 걸린 차감(업체별 합) — 카드·홈페이지·선결제 = 주문일, 월말 결제 = 금액이 걸린 첫 입고일. */
export async function usedInPeriod(db, from, to) {
  const rows = await all(db, `SELECT b.vendor_id, b.amount, CASE WHEN o.prepaid = 1 OR ${PAID_AT_ORDER} THEN o.ordered_at
      ELSE (SELECT min(t.date) FROM inv_tx t WHERE t.order_id = o.id AND t.kind = 'in' AND t.amount > 0 AND t.deleted_at IS NULL) END AS pay_date
    FROM inv_vendor_bal b JOIN inv_orders o ON o.id = b.order_id LEFT JOIN inv_vendors v ON v.id = b.vendor_id
    WHERE b.kind = 'use' AND b.deleted_at IS NULL AND o.status <> 'cancelled'`);
  const by = new Map();
  for (const r of rows) if (r.pay_date && r.pay_date >= from && r.pay_date <= to) by.set(r.vendor_id, (by.get(r.vendor_id) || 0) + won(r.amount));
  return by;
}
/** 보고서 표: 업체별 기간 전 남은 금액 · 등록 · 차감 · 환급 · 기간 말 남은 금액(기록 날짜 기준). 기록이 있는 업체만. */
export async function balTable(db, from, to) {
  const rows = await all(db, `SELECT b.vendor_id, v.name, sum(CASE WHEN b.date < ? THEN ${SIGNED.replace(/kind|amount/g, m => `b.${m}`)} ELSE 0 END) AS before,
      sum(CASE WHEN b.date BETWEEN ? AND ? AND b.kind = 'add' THEN b.amount ELSE 0 END) AS added,
      sum(CASE WHEN b.date BETWEEN ? AND ? AND b.kind = 'use' THEN b.amount ELSE 0 END) AS used,
      sum(CASE WHEN b.date BETWEEN ? AND ? AND b.kind = 'refund' THEN b.amount ELSE 0 END) AS refund
    FROM inv_vendor_bal b LEFT JOIN inv_vendors v ON v.id = b.vendor_id WHERE b.deleted_at IS NULL AND b.date <= ? GROUP BY b.vendor_id ORDER BY v.sort, v.id`, from, from, to, from, to, from, to, to);
  return rows.map(r => ({ vendor_id: r.vendor_id, name: r.name || '업체 미지정', before: won(r.before), added: won(r.added), used: won(r.used), refund: won(r.refund), after: won(r.before + r.added - r.used - r.refund) }))
    .filter(r => r.before || r.added || r.used || r.refund || r.after);
}

async function listState(db) {
  const vendors = await all(db, `SELECT v.id, v.name, v.active, coalesce((SELECT sum(${SIGNED}) FROM inv_vendor_bal b WHERE b.vendor_id = v.id AND b.deleted_at IS NULL), 0) AS balance,
      (SELECT count(*) FROM inv_vendor_bal b WHERE b.vendor_id = v.id AND b.deleted_at IS NULL) AS n FROM inv_vendors v ORDER BY v.sort, v.id`);
  const rows = await all(db, `SELECT b.*, o.ordered_at, o.option_label, o.amount AS order_amount, o.status AS order_status, i.name AS item_name
    FROM inv_vendor_bal b LEFT JOIN inv_orders o ON o.id = b.order_id LEFT JOIN inv_items i ON i.id = o.item_id WHERE b.deleted_at IS NULL ORDER BY b.date DESC, b.id DESC`);
  // 잔액 차감에 고를 수 있는 주문: 금액이 있고, 취소 안 됐고, 아직 차감이 안 걸린 주문(받기 전 반입 예정 줄은 0원이라 빠짐)
  const orders = await all(db, `SELECT o.id, o.ordered_at, o.option_label, o.amount, o.qty, o.bonus_qty, o.prepaid, o.status, i.name AS item_name, i.stock_unit, i.vendor_id
    FROM inv_orders o JOIN inv_items i ON i.id = o.item_id WHERE o.amount > 0 AND o.status <> 'cancelled' AND i.vendor_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM inv_vendor_bal b WHERE b.order_id = o.id AND b.kind = 'use' AND b.deleted_at IS NULL) ORDER BY o.ordered_at DESC, o.id DESC LIMIT 200`);
  // 남은 금액 따라가기(날짜 순으로 더하고 빼서 줄마다 '남음')
  const run = new Map();
  for (const r of [...rows].reverse()) { const b = (run.get(r.vendor_id) || 0) + (r.kind === 'add' ? r.amount : -r.amount); run.set(r.vendor_id, b); r.left = won(b); r.amount = won(r.amount); }
  return { vendors: vendors.map(v => ({ ...v, balance: won(v.balance) })), rows, orders, reasons: BAL_REASONS };
}

export async function handleBalance(db, path, m, body, user) {
  if (m === 'GET' && path === '/vendor-bal') return json(await listState(db));
  if (m === 'POST' && path === '/vendor-bal') {
    const now = Date.now();
    // 잔액 차감: 이미 한 주문을 골라 잔액에서 뺌(주문 때 체크하지 못한 주문, 예: 중외 이달 주문)
    if (body.kind === 'use') {
      const o = await one(db, `SELECT o.*, i.vendor_id FROM inv_orders o JOIN inv_items i ON i.id = o.item_id WHERE o.id = ? AND o.status <> 'cancelled'`, Number(body.order_id) || 0);
      if (!o || !(o.amount > 0) || !o.vendor_id) return bad('차감할 주문을 골라 주세요.');
      if (await one(db, `SELECT id FROM inv_vendor_bal WHERE order_id = ? AND kind = 'use' AND deleted_at IS NULL`, o.id)) return bad('이 주문은 이미 잔액에서 차감했어요.', 409);
      const use = await planUse(db, o.vendor_id, o.amount);
      if (!(use > 0)) return bad('남은 잔액이 없어요.');
      await useStmt(db, o.vendor_id, use, o.ordered_at, user, String(o.id)).run();
      return json({ ok: true, used: use, ...(await listState(db)) });
    }
    if (!['add', 'refund'].includes(body.kind) && !body.id) return bad('구분을 골라 주세요.');
    const amount = won(body.amount);
    if (!(amount > 0)) return bad('금액을 입력해 주세요.');
    const date = okDate(body.date) ? body.date : null;
    if (!date) return bad('날짜를 확인해 주세요.');
    const reason = body.reason ? String(body.reason).slice(0, 20) : null, memo = body.memo ? String(body.memo).slice(0, 200) : null;
    if (body.id) { // 고치기: 등록·환급 줄만(차감 줄은 주문을 따라감)
      const cur = await one(db, `SELECT * FROM inv_vendor_bal WHERE id = ? AND deleted_at IS NULL`, Number(body.id));
      if (!cur || cur.kind === 'use') return bad('고칠 기록을 찾을 수 없어요.', 404);
      const after = (await balanceOf(db, cur.vendor_id)) + (cur.kind === 'add' ? amount - cur.amount : cur.amount - amount);
      if (after < 0) return bad('고치면 남은 금액이 0원보다 적어져요.', 409);
      await db.prepare('UPDATE inv_vendor_bal SET amount = ?, date = ?, reason = ?, memo = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(amount, date, cur.kind === 'add' ? reason : null, memo, user, now, cur.id).run();
      return json({ ok: true, ...(await listState(db)) });
    }
    const vid = Number(body.vendor_id) || 0;
    if (!(await one(db, 'SELECT id FROM inv_vendors WHERE id = ?', vid))) return bad('업체를 골라 주세요.');
    if (body.kind === 'add' && !reason) return bad('사유를 골라 주세요.');
    if (body.kind === 'refund' && amount > await balanceOf(db, vid)) return bad('남은 금액보다 많이 환급받을 수 없어요.', 409);
    await db.prepare('INSERT INTO inv_vendor_bal (vendor_id, date, kind, amount, reason, memo, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)').bind(vid, date, body.kind, amount, body.kind === 'add' ? reason : null, memo, user, now).run();
    return json({ ok: true, ...(await listState(db)) });
  }
  if (m === 'DELETE' && /^\/vendor-bal\/\d+$/.test(path)) {
    const cur = await one(db, `SELECT * FROM inv_vendor_bal WHERE id = ? AND deleted_at IS NULL`, Number(path.split('/')[2]));
    if (!cur) return bad('기록을 찾을 수 없어요.', 404);
    // 등록을 지워서 남은 금액이 마이너스가 되면 막음(이미 주문에 쓴 돈). 차감 줄을 지우면 잔액이 돌아옴.
    if (cur.kind === 'add' && (await balanceOf(db, cur.vendor_id)) - cur.amount < 0) return bad('이 잔액은 이미 주문에 썼어요. 차감한 주문부터 정리해 주세요.', 409);
    await db.prepare('UPDATE inv_vendor_bal SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(Date.now(), user, cur.id).run();
    return json({ ok: true, ...(await listState(db)) });
  }
  return null;
}

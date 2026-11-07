// 피부팀 재고 — 품목·거래처·구매조건·주문·입고·출고·선결제 잔량·일일 재고·월말/연말 보고.
// 데이터는 팀 공용 D1(INV_DB). 사용자가 정한 규칙(2026-11-08):
// - 일반 구매: 실제 병원에 들어온 수량만 병원재고 증가. 결제금액은 고른 구매조건 그대로. 증정은 결제금액 제외·재고 포함.
// - 선결제: 결제 때 업체재고(선결제 잔량)를 만들고, 입고확정 때 잔량 차감 + 병원재고 증가를 한 번에(batch) 처리. 추가 결제 없음.
// - 출고: 병원재고만 재고단위로 차감. 금액·업체재고는 건드리지 않음.
// - 단위는 숫자만 비교하지 않고 품목에 등록된 구성수량(pack_qty: 주문단위 1개 = 재고단위 몇 개)으로 환산.
// - 입고·출고 기록 삭제 = 그 기록이 바꾼 병원재고·업체재고를 정확히 되돌림(기록마다 증감값을 저장해 둠).
// - 단가 미확인 품목은 price=null 그대로(0원으로 바꾸지 않음).
import { ensureInvSchema, INV_TABLES } from './invSchema.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const bad = (error, status = 400) => json({ error }, status);
const num = v => (v === '' || v == null ? null : Number(v));
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const round = v => Math.round(v * 1000) / 1000;
export const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const okDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

async function all(db, sql, ...args) { return (await db.prepare(sql).bind(...args).all()).results || []; }
async function one(db, sql, ...args) { return db.prepare(sql).bind(...args).first(); }

async function itemsWithOptions(db) {
  const items = await all(db, `SELECT i.*, v.name AS vendor_name FROM inv_items i LEFT JOIN inv_vendors v ON v.id = i.vendor_id WHERE i.active = 1 ORDER BY i.sort, i.id`);
  const opts = await all(db, `SELECT * FROM inv_options WHERE active = 1 ORDER BY item_id, sort, id`);
  for (const it of items) it.options = opts.filter(o => o.item_id === it.id);
  return items;
}

// 기록 하나 = 재고 증감 하나. 같은 batch 안에서 품목 재고를 바꾸고 기록을 남긴다(둘 중 하나만 되는 일이 없게).
function txStatements(db, item, t) {
  const hd = round(t.hospital_delta || 0), vd = round(t.vendor_delta || 0);
  return [
    db.prepare(`UPDATE inv_items SET hospital_stock = round(hospital_stock + ?, 3), vendor_stock = round(vendor_stock + ?, 3), updated_at = ? WHERE id = ?`).bind(hd, vd, Date.now(), item.id),
    db.prepare(`INSERT INTO inv_tx (date, kind, item_id, qty, bonus_qty, amount, hospital_delta, vendor_delta, hospital_after, vendor_after, order_id, daily_date, invoice, memo, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      t.date, t.kind, item.id, round(t.qty || 0), round(t.bonus_qty || 0), t.amount ?? null, hd, vd,
      round((item.hospital_stock || 0) + hd), round((item.vendor_stock || 0) + vd), t.order_id ?? null, t.daily_date ?? null, t.invoice ? 1 : 0, t.memo || null, t.by || null, Date.now()),
  ];
}

async function loadItem(db, id) {
  const it = await one(db, 'SELECT * FROM inv_items WHERE id = ?', Number(id));
  return it || null;
}

function optionUnits(item, o) {
  // 구매조건의 수량·증정은 재고단위로 저장돼 있다(입력 화면에서 주문단위 × 구성수량으로 환산해 저장).
  return { qty: Number(o.qty) || 0, bonus: Number(o.bonus_qty) || 0, amount: o.amount == null ? null : Number(o.amount) };
}

export async function handleInventory(request, env, url, user) {
  const db = env.INV_DB;
  if (!db) return json({ error: '재고 데이터베이스가 연결되지 않았어요.', unavailable: true }, 503);
  await ensureInvSchema(db);
  const path = url.pathname.slice('/api/inventory'.length) || '/';
  const m = request.method;
  const body = m === 'GET' ? {} : await request.json().catch(() => ({}));
  try {
    // ── 예전 자료 넣기: 사진에서 옮긴 직원·재고 숫자 파일(old-app-data.json)을 처음 한 번만 넣는다 ──
    // 화면이 표마다 조각으로 나눠 보낸다(요청 하나의 D1 호출 수를 작게). 넣은 뒤에는 막힘(쓰던 자료를 덮지 않게).
    // 예전 자료를 넣은 뒤 더 받은 근태·성과 숫자: 없는 날만 추가하고, 비어 있는 관리 인원·지정 환자 수만 채운다(이미 입력한 값은 안 덮음).
    // 연차는 사용 수 계산이 얽혀 있어 추가하지 않는다.
    if (m === 'POST' && path === '/import-merge') {
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (rows.length > 15) return bad('자료 형식이 맞지 않아요.');
      const cols = (await all(db, 'PRAGMA table_info(staff_attendance)')).map(r => r.name).filter(c => c !== 'id');
      let added = 0, filled = 0, skipped = 0;
      for (const r of rows) {
        if (!r || !r.staff_id || !/^\d{4}-\d{2}-\d{2}$/.test(r.work_date || '')) { skipped++; continue; }
        const cur = await one(db, 'SELECT id, attendance, etc_type, managed_count, designated_count FROM staff_attendance WHERE staff_id = ? AND work_date = ?', r.staff_id, r.work_date);
        if (cur) {
          const mg = (cur.attendance === '정상근무' || (cur.attendance === '기타' && cur.etc_type === 'time')) && cur.managed_count == null && r.managed_count != null ? r.managed_count : null;
          const dg = cur.designated_count == null && r.designated_count != null ? r.designated_count : null;
          if (mg != null || dg != null) { await db.prepare('UPDATE staff_attendance SET managed_count = coalesce(managed_count, ?), designated_count = coalesce(designated_count, ?) WHERE id = ?').bind(mg, dg, cur.id).run(); filled++; }
          continue;
        }
        if (r.attendance === '연차') { skipped++; continue; }
        const keys = Object.keys(r).filter(k => cols.includes(k));
        await db.prepare(`INSERT OR IGNORE INTO staff_attendance (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...keys.map(k => r[k] ?? null)).run();
        added++;
      }
      return json({ ok: true, added, filled, skipped });
    }

    if (path === '/import') {
      const done = await one(db, `SELECT value FROM inv_meta WHERE key = 'import'`);
      if (m === 'GET') return json({ imported: done?.value || null });
      if (done) return bad('예전 자료는 이미 넣었어요.', 409);
      if (body.step === 'start') {
        await db.batch(INV_TABLES.map(t => db.prepare(`DELETE FROM ${t}`)));
        await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('import_started', ?)`).bind(new Date().toISOString()).run();
        return json({ ok: true });
      }
      if (body.step === 'rows') {
        const started = await one(db, `SELECT value FROM inv_meta WHERE key = 'import_started'`);
        if (!started) return bad('처음부터 다시 넣어 주세요.');
        if (!INV_TABLES.includes(body.table) || !Array.isArray(body.rows) || body.rows.length > 40) return bad('자료 형식이 맞지 않아요.');
        const cols = (await all(db, `PRAGMA table_info(${body.table})`)).map(r => r.name);
        const stmts = body.rows.map(row => {
          const keys = Object.keys(row || {}).filter(k => cols.includes(k));
          return db.prepare(`INSERT OR REPLACE INTO ${body.table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...keys.map(k => (row[k] === undefined ? null : row[k])));
        });
        if (stmts.length) await db.batch(stmts);
        return json({ ok: true, count: stmts.length });
      }
      if (body.step === 'finish') {
        await db.prepare(`UPDATE inv_options SET amount = 450000 WHERE item_id = 1010 AND qty = 300 AND prepaid = 1 AND amount = 360000`).run(); // 예전 파일의 잘못된 36만원 고침
        await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('import', ?)`).bind(`${new Date().toISOString()} ${String(body.label || '').slice(0, 60)}`).run();
        return json({ ok: true });
      }
      return bad('알 수 없는 단계예요.');
    }

    if (m === 'GET' && path === '/state') {
      const imported = await one(db, `SELECT value FROM inv_meta WHERE key = 'import'`);
      const [vendors, items, orders] = await Promise.all([
        all(db, 'SELECT * FROM inv_vendors WHERE active = 1 ORDER BY sort, id'),
        itemsWithOptions(db),
        all(db, `SELECT o.*, i.name AS item_name, i.stock_unit FROM inv_orders o JOIN inv_items i ON i.id = o.item_id WHERE o.status = 'ordered' ORDER BY o.ordered_at, o.id`),
      ]);
      return json({ today: kstToday(), imported: imported?.value || null, vendors, items, orders });
    }

    // ── 품목 ──
    if (m === 'POST' && path === '/items') {
      const name = String(body.name || '').trim();
      if (!name) return bad('품목 이름을 입력해 주세요.');
      const f = {
        name, vendor_id: num(body.vendor_id), category: body.category || null, stock_unit: String(body.stock_unit || 'ea').trim(),
        order_unit: body.order_unit ? String(body.order_unit).trim() : null, pack_qty: num(body.pack_qty), price: num(body.price),
        min_stock: num(body.min_stock) ?? 0, daily_mode: ['usage', 'count'].includes(body.daily_mode) ? body.daily_mode : null,
        prepaid: body.prepaid ? 1 : 0, is_pack: body.is_pack ? 1 : 0, memo: body.memo || null,
      };
      if (f.pack_qty != null && !(f.pack_qty > 0)) return bad('구성수량은 0보다 커야 해요.');
      if (body.id) {
        await db.prepare(`UPDATE inv_items SET name=?, vendor_id=?, category=?, stock_unit=?, order_unit=?, pack_qty=?, price=?, min_stock=?, daily_mode=?, prepaid=?, is_pack=?, memo=?, updated_at=? WHERE id=?`)
          .bind(f.name, f.vendor_id, f.category, f.stock_unit, f.order_unit, f.pack_qty, f.price, f.min_stock, f.daily_mode, f.prepaid, f.is_pack, f.memo, Date.now(), Number(body.id)).run();
      } else {
        await db.prepare(`INSERT INTO inv_items (name, vendor_id, category, stock_unit, order_unit, pack_qty, price, min_stock, daily_mode, prepaid, is_pack, memo, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(f.name, f.vendor_id, f.category, f.stock_unit, f.order_unit, f.pack_qty, f.price, f.min_stock, f.daily_mode, f.prepaid, f.is_pack, f.memo, 9999, Date.now(), Date.now()).run();
      }
      return json({ ok: true, items: await itemsWithOptions(db) });
    }
    if (m === 'DELETE' && path.startsWith('/items/')) {
      await db.prepare('UPDATE inv_items SET active = 0, updated_at = ? WHERE id = ?').bind(Date.now(), Number(path.split('/')[2])).run();
      return json({ ok: true });
    }

    // ── 구매조건(품목마다 여러 개: 구매수량 / 총 결제금액 / 증정수량) ──
    if (m === 'POST' && path === '/options') {
      const item = await loadItem(db, body.item_id);
      if (!item) return bad('품목을 찾을 수 없어요.', 404);
      const qty = num(body.qty), bonus = num(body.bonus_qty) ?? 0, amount = num(body.amount);
      if (!(qty > 0)) return bad('구매수량을 입력해 주세요.');
      if (bonus < 0) return bad('증정수량은 0 이상이어야 해요.');
      if (amount != null && amount < 0) return bad('결제금액은 0 이상이어야 해요.');
      const label = String(body.label || '').trim() || null;
      const prepaid = body.prepaid ? 1 : 0;
      if (body.id) await db.prepare('UPDATE inv_options SET label=?, qty=?, bonus_qty=?, amount=?, prepaid=?, unit_label=? WHERE id=? AND item_id=?').bind(label, qty, bonus, amount, prepaid, body.unit_label || null, Number(body.id), item.id).run();
      else await db.prepare('INSERT INTO inv_options (item_id, label, qty, bonus_qty, amount, prepaid, unit_label, sort, created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(item.id, label, qty, bonus, amount, prepaid, body.unit_label || null, 99, Date.now()).run();
      return json({ ok: true, items: await itemsWithOptions(db) });
    }
    if (m === 'DELETE' && path.startsWith('/options/')) {
      await db.prepare('UPDATE inv_options SET active = 0 WHERE id = ?').bind(Number(path.split('/')[2])).run();
      return json({ ok: true, items: await itemsWithOptions(db) });
    }

    // ── 주문(발주): 등록된 구매조건 하나를 골라 그 결제금액·수량·증정을 그대로 적용 ──
    if (m === 'POST' && path === '/orders') {
      const item = await loadItem(db, body.item_id);
      if (!item) return bad('품목을 찾을 수 없어요.', 404);
      const opt = await one(db, 'SELECT * FROM inv_options WHERE id = ? AND item_id = ? AND active = 1', Number(body.option_id), item.id);
      if (!opt) return bad('구매조건을 골라 주세요.');
      const count = num(body.count) ?? 1;
      if (!(count > 0) || !Number.isInteger(count)) return bad('주문 개수는 1 이상의 정수예요.');
      const date = okDate(body.date) ? body.date : kstToday();
      const u = optionUnits(item, opt);
      const qty = u.qty * count, bonus = u.bonus * count, amount = u.amount == null ? null : u.amount * count;
      if (opt.prepaid) {
        // 선결제: 결제와 동시에 업체재고(선결제 잔량) 생성. 병원재고는 반입(입고확정) 때 늘어난다.
        const stmts = [db.prepare(`INSERT INTO inv_orders (item_id, option_id, option_label, ordered_at, qty, bonus_qty, amount, prepaid, status, memo, created_by, created_at) VALUES (?,?,?,?,?,?,?,1,'paid',?,?,?)`)
          .bind(item.id, opt.id, opt.label, date, qty, bonus, amount, body.memo || null, user, Date.now()),
        ...txStatements(db, item, { date, kind: 'prepaid_buy', qty, bonus_qty: bonus, amount, vendor_delta: qty + bonus, memo: body.memo || opt.label, by: user, invoice: body.invoice })];
        await db.batch(stmts);
        await db.prepare(`UPDATE inv_tx SET order_id = (SELECT max(id) FROM inv_orders) WHERE id = (SELECT max(id) FROM inv_tx)`).run();
        return json({ ok: true, prepaid: true });
      }
      await db.prepare(`INSERT INTO inv_orders (item_id, option_id, option_label, ordered_at, qty, bonus_qty, amount, prepaid, status, memo, created_by, created_at) VALUES (?,?,?,?,?,?,?,0,'ordered',?,?,?)`)
        .bind(item.id, opt.id, opt.label, date, qty, bonus, amount, body.memo || null, user, Date.now()).run();
      return json({ ok: true });
    }
    if (m === 'POST' && /^\/orders\/\d+\/cancel$/.test(path)) {
      const r = await db.prepare(`UPDATE inv_orders SET status = 'cancelled' WHERE id = ? AND status = 'ordered'`).bind(Number(path.split('/')[2])).run();
      if (!r.meta?.changes) return bad('취소할 주문을 찾을 수 없어요.', 404);
      return json({ ok: true });
    }

    // ── 입고확정 ──
    // 일반 구매: 주문 1건을 받음(실제 도착 수량만 병원재고 +, 결제금액은 주문 그대로).
    // 선결제 반입: 선결제 잔량 - 실제 수량, 병원재고 + 실제 수량을 한 batch로. 결제금액 0.
    if (m === 'POST' && path === '/receive') {
      const actual = num(body.actual_qty);
      if (!(actual > 0)) return bad('실제 도착 수량을 입력해 주세요.');
      const date = okDate(body.date) ? body.date : kstToday();
      if (body.from_prepaid) {
        const item = await loadItem(db, body.item_id);
        if (!item) return bad('품목을 찾을 수 없어요.', 404);
        if (actual > round(item.vendor_stock || 0)) return bad(`선결제 잔량(${round(item.vendor_stock || 0)} ${item.stock_unit})보다 많이 받을 수 없어요.`);
        await db.batch(txStatements(db, item, { date, kind: 'prepaid_in', qty: actual, amount: 0, hospital_delta: actual, vendor_delta: -actual, memo: body.memo, by: user, invoice: body.invoice }));
        return json({ ok: true, item: await loadItem(db, item.id) });
      }
      if (body.order_id) {
        const order = await one(db, `SELECT * FROM inv_orders WHERE id = ? AND status = 'ordered'`, Number(body.order_id));
        if (!order) return bad('받을 주문을 찾을 수 없어요.', 404);
        const item = await loadItem(db, order.item_id);
        await db.batch([
          db.prepare(`UPDATE inv_orders SET status = 'received', received_at = ? WHERE id = ? AND status = 'ordered'`).bind(date, order.id),
          ...txStatements(db, item, { date, kind: 'in', qty: actual, bonus_qty: order.bonus_qty, amount: order.amount, hospital_delta: actual, order_id: order.id, memo: body.memo || order.option_label, by: user, invoice: body.invoice }),
        ]);
        return json({ ok: true });
      }
      // 주문 없이 바로 받은 일반 입고(금액은 입력값, 없으면 미입력)
      const item = await loadItem(db, body.item_id);
      if (!item) return bad('품목을 찾을 수 없어요.', 404);
      const amount = num(body.amount);
      if (amount != null && amount < 0) return bad('금액은 0 이상이어야 해요.');
      await db.batch(txStatements(db, item, { date, kind: 'in', qty: actual, bonus_qty: num(body.bonus_qty) ?? 0, amount, hospital_delta: actual, memo: body.memo, by: user, invoice: body.invoice }));
      return json({ ok: true });
    }

    // ── 출고: 병원재고만 재고단위로 차감 ──
    if (m === 'POST' && path === '/out') {
      const item = await loadItem(db, body.item_id);
      if (!item) return bad('품목을 찾을 수 없어요.', 404);
      const qty = num(body.qty);
      if (!(qty > 0)) return bad('출고 수량을 입력해 주세요.');
      const date = okDate(body.date) ? body.date : kstToday();
      await db.batch(txStatements(db, item, { date, kind: 'out', qty, hospital_delta: -qty, memo: body.memo, by: user }));
      return json({ ok: true });
    }

    // ── 재고 맞추기(실사): 센 수량으로 병원재고·선결제 잔량을 맞추고 차이를 기록(삭제하면 되돌림) ──
    if (m === 'POST' && path === '/adjust') {
      const item = await loadItem(db, body.item_id);
      if (!item) return bad('품목을 찾을 수 없어요.', 404);
      const h = num(body.hospital_stock), v = num(body.vendor_stock);
      if ((h != null && h < 0) || (v != null && v < 0)) return bad('수량은 0 이상이어야 해요.');
      const hd = h == null ? 0 : round(h - item.hospital_stock), vd = v == null ? 0 : round(v - item.vendor_stock);
      if (!hd && !vd) return json({ ok: true, unchanged: true });
      await db.batch(txStatements(db, item, { date: okDate(body.date) ? body.date : kstToday(), kind: 'adjust', qty: Math.abs(hd || vd), hospital_delta: hd, vendor_delta: vd, memo: body.memo || '재고 맞추기', by: user }));
      return json({ ok: true });
    }

    // ── 기록 삭제: 그 기록의 증감을 그대로 되돌림 ──
    if (m === 'DELETE' && path.startsWith('/tx/')) {
      const tx = await one(db, 'SELECT * FROM inv_tx WHERE id = ? AND deleted_at IS NULL', Number(path.split('/')[2]));
      if (!tx) return bad('기록을 찾을 수 없어요.', 404);
      const stmts = [
        db.prepare(`UPDATE inv_items SET hospital_stock = round(hospital_stock - ?, 3), vendor_stock = round(vendor_stock - ?, 3), updated_at = ? WHERE id = ?`).bind(tx.hospital_delta, tx.vendor_delta, Date.now(), tx.item_id),
        db.prepare('UPDATE inv_tx SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL').bind(Date.now(), user, tx.id),
      ];
      if (tx.order_id && tx.kind === 'in') stmts.push(db.prepare(`UPDATE inv_orders SET status = 'ordered', received_at = NULL WHERE id = ?`).bind(tx.order_id));
      if (tx.order_id && tx.kind === 'prepaid_buy') stmts.push(db.prepare(`UPDATE inv_orders SET status = 'cancelled' WHERE id = ?`).bind(tx.order_id));
      await db.batch(stmts);
      return json({ ok: true, item: await loadItem(db, tx.item_id) });
    }
    if (m === 'PATCH' && path.startsWith('/tx/')) {
      // 거래명세서 등록 여부·메모만 고친다(수량을 고치려면 지우고 다시 기록)
      const id = Number(path.split('/')[2]);
      await db.prepare('UPDATE inv_tx SET invoice = coalesce(?, invoice), memo = coalesce(?, memo) WHERE id = ? AND deleted_at IS NULL')
        .bind(body.invoice == null ? null : body.invoice ? 1 : 0, body.memo ?? null, id).run();
      return json({ ok: true });
    }
    if (m === 'GET' && path === '/tx') {
      const from = url.searchParams.get('from') || '0000-01-01', to = url.searchParams.get('to') || '9999-12-31';
      const kind = url.searchParams.get('kind'), itemId = url.searchParams.get('item_id');
      const rows = await all(db, `SELECT t.*, i.name AS item_name, i.stock_unit, v.name AS vendor_name FROM inv_tx t JOIN inv_items i ON i.id = t.item_id LEFT JOIN inv_vendors v ON v.id = i.vendor_id
        WHERE t.deleted_at IS NULL AND t.date BETWEEN ? AND ? ${kind ? `AND t.kind IN (${kind.split(',').map(() => '?').join(',')})` : ''} ${itemId ? 'AND t.item_id = ?' : ''}
        ORDER BY t.date DESC, t.id DESC LIMIT 500`, from, to, ...(kind ? kind.split(',') : []), ...(itemId ? [Number(itemId)] : []));
      return json({ rows });
    }

    // ── 일일 재고(마감) ──
    if (m === 'GET' && path === '/daily') {
      const date = okDate(url.searchParams.get('date')) ? url.searchParams.get('date') : kstToday();
      const day = await one(db, 'SELECT * FROM inv_daily WHERE date = ?', date);
      const items = await all(db, `SELECT id, name, stock_unit, hospital_stock, daily_mode, vendor_id FROM inv_items WHERE active = 1 AND daily_mode IS NOT NULL ORDER BY sort, id`);
      const used = await all(db, `SELECT item_id, qty, id FROM inv_tx WHERE deleted_at IS NULL AND daily_date = ? AND kind = 'out'`, date);
      const since = new Date(Date.parse(date) - 14 * 864e5).toISOString().slice(0, 10);
      const recent = await all(db, `SELECT item_id, sum(qty) AS q FROM inv_tx WHERE deleted_at IS NULL AND kind = 'out' AND daily_date BETWEEN ? AND ? GROUP BY item_id`, since, date);
      return json({ date, day: day ? { ...day, extra: day.extra ? JSON.parse(day.extra) : {} } : null, items: items.map(it => ({ ...it, used: used.find(u => u.item_id === it.id)?.qty ?? null, used15: recent.find(r => r.item_id === it.id)?.q ?? 0 })) });
    }
    if (m === 'POST' && path === '/daily') {
      const date = okDate(body.date) ? body.date : null;
      if (!date) return bad('날짜를 확인해 주세요.');
      const patients = num(body.patients);
      if (patients != null && (patients < 0 || !Number.isInteger(patients))) return bad('피부관리 인원은 0 이상의 정수예요.');
      const stmts = [db.prepare(`INSERT INTO inv_daily (date, patients, status, extra, updated_by, updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(date) DO UPDATE SET patients = excluded.patients, status = excluded.status, extra = excluded.extra, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .bind(date, patients, body.status || null, JSON.stringify(body.extra || {}), user, Date.now())];
      // 품목별 당일 사용량: 이전 마감 출고를 되돌리고 새 값으로 다시 기록(같은 batch)
      for (const [id, raw] of Object.entries(body.used || {})) {
        const qty = num(raw);
        if (qty != null && (qty < 0 || !Number.isFinite(qty))) return bad('사용량은 0 이상이어야 해요.');
        let item = await loadItem(db, id);
        if (!item) continue;
        const old = await all(db, `SELECT * FROM inv_tx WHERE deleted_at IS NULL AND daily_date = ? AND item_id = ? AND kind = 'out'`, date, item.id);
        let back = 0;
        for (const t of old) {
          back += -t.hospital_delta;
          stmts.push(db.prepare('UPDATE inv_tx SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(Date.now(), user, t.id));
        }
        if (back) { stmts.push(db.prepare('UPDATE inv_items SET hospital_stock = round(hospital_stock + ?, 3) WHERE id = ?').bind(round(back), item.id)); item = { ...item, hospital_stock: round(item.hospital_stock + back) }; }
        if (qty) stmts.push(...txStatements(db, item, { date, kind: 'out', qty, hospital_delta: -qty, daily_date: date, memo: '일일 마감 소모', by: user }));
      }
      await db.batch(stmts);
      return json({ ok: true });
    }

    // ── 보고서 ──
    if (m === 'GET' && path === '/report') {
      const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : kstToday().slice(0, 7);
      return json(await monthReport(db, month));
    }
    if (m === 'GET' && path === '/report-year') {
      const year = /^\d{4}$/.test(url.searchParams.get('year') || '') ? url.searchParams.get('year') : kstToday().slice(0, 4);
      const months = [];
      for (let i = 1; i <= 12; i++) months.push(await monthReport(db, `${year}-${String(i).padStart(2, '0')}`, true));
      return json({ year, months });
    }
    return bad('요청한 기능을 찾을 수 없어요.', 404);
  } catch (e) {
    return json({ error: '재고 자료를 처리하지 못했어요.', detail: String(e?.message || e).slice(0, 300) }, 500);
  }
}

export async function monthReport(db, month, brief = false) {
  const from = `${month}-01`, to = `${month}-31`;
  const spend = await one(db, `SELECT
      coalesce(sum(CASE WHEN kind = 'in' THEN amount END), 0) AS general,
      coalesce(sum(CASE WHEN kind = 'prepaid_buy' THEN amount END), 0) AS prepaid,
      sum(CASE WHEN kind IN ('in','prepaid_in') THEN 1 ELSE 0 END) AS in_count,
      sum(CASE WHEN kind IN ('in','prepaid_in','prepaid_buy') AND invoice = 0 THEN 1 ELSE 0 END) AS no_invoice,
      sum(CASE WHEN kind = 'in' AND amount IS NULL THEN 1 ELSE 0 END) AS no_amount
    FROM inv_tx WHERE deleted_at IS NULL AND date BETWEEN ? AND ?`, from, to);
  const days = await one(db, `SELECT coalesce(sum(patients), 0) AS patients, sum(CASE WHEN patients > 0 THEN 1 ELSE 0 END) AS open_days FROM inv_daily WHERE date BETWEEN ? AND ?`, from, to);
  const usage = await all(db, `SELECT i.id, i.name, i.stock_unit, sum(t.qty) AS used FROM inv_tx t JOIN inv_items i ON i.id = t.item_id
    WHERE t.deleted_at IS NULL AND t.kind = 'out' AND t.date BETWEEN ? AND ? GROUP BY i.id ORDER BY i.sort, i.id`, from, to);
  const openDays = days.open_days || 0;
  const out = {
    month, spend_total: (spend.general || 0) + (spend.prepaid || 0), spend_general: spend.general || 0, spend_prepaid: spend.prepaid || 0,
    in_count: spend.in_count || 0, no_invoice: spend.no_invoice || 0, no_amount: spend.no_amount || 0, patients: days.patients || 0, open_days: openDays,
    usage: usage.map(u => ({ ...u, used: round(u.used), per_day: openDays ? Math.round((u.used / openDays) * 10) / 10 : null })),
  };
  if (brief) return out;
  out.inbound = await all(db, `SELECT t.date, t.kind, t.qty, t.bonus_qty, t.amount, t.invoice, t.memo, i.name AS item_name, i.stock_unit, v.name AS vendor_name, v.payment_method
    FROM inv_tx t JOIN inv_items i ON i.id = t.item_id LEFT JOIN inv_vendors v ON v.id = i.vendor_id
    WHERE t.deleted_at IS NULL AND t.kind IN ('in','prepaid_buy','prepaid_in') AND t.date BETWEEN ? AND ? ORDER BY t.date, t.id`, from, to);
  out.prepaid = await all(db, `SELECT id, name, stock_unit, vendor_stock, hospital_stock FROM inv_items WHERE active = 1 AND prepaid = 1 ORDER BY sort, id`);
  out.stock = await all(db, `SELECT id, name, stock_unit, hospital_stock, min_stock, price, pack_qty, order_unit FROM inv_items WHERE active = 1 AND daily_mode IS NOT NULL ORDER BY sort, id`);
  return out;
}

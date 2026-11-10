// 피부팀 재고 — 품목·거래처·구매조건·주문·입고·출고·업체 보관 잔량·일일 재고·월말/연말 보고.
// 데이터는 팀 공용 D1(INV_DB). 사용자가 정한 규칙(2026-11-08):
// - 일반 구매: 실제 병원에 들어온 수량만 병원재고 증가. 결제금액은 고른 구매조건 그대로. 증정은 결제금액 제외·재고 포함.
// - 선결제: 결제 때 업체 보관 잔량를 만들고, 입고확정 때 잔량 차감 + 병원재고 증가를 한 번에(batch) 처리. 추가 결제 없음.
//   구매와 반입은 다른 기록이다: 반입은 구매가 아니라 재고 위치 이동(업체 → 병원)이라 금액을 다시 계산하지 않는다.
//   개당원가 = 실제 구매금액 ÷ 증정 포함 총수량.
// - 일반 품목: 등록된 구매조건(가격표·증정조건)이 있으면 그대로, 없으면 구매단가 × 수량. 업체 보관 잔량·업체 보관 잔량은 건드리지 않음.
// 핵심: 일반 품목은 기존 구매단가 기준으로 입고 처리하고, 선결제 품목은 최초 구매 시에만 결제 처리한다.
//       이후 병원 반입은 업체 보관 잔량에서 병원재고로 이동만 하며 구매금액은 다시 계산하지 않는다.
// - 선결제 주문 때 '병원 입고 수량'을 정하면(2026-11-09 사용자 지정) 그 수량은 반입 예정(inv_orders prepaid=1, status 'ordered',
//   memo 'from:<선결제 주문 id>')으로만 남고 업체 보관 잔량에 그대로 있다. 실제 도착을 '입고확정'할 때 도착 수량만
//   업체 보관 잔량 − / 병원재고 + (기존 반입과 같은 prepaid_in). 예정보다 적게 와도 그 예정은 끝나고 나머지는 업체 보관 잔량에 남는다.
// - 출고: 병원재고만 재고단위로 차감. 금액·업체 보관 잔량는 건드리지 않음.
// - 단위는 숫자만 비교하지 않고 품목에 등록된 구성수량(pack_qty: 주문단위 1개 = 재고단위 몇 개)으로 환산.
// - 입고·출고 기록 삭제 = 그 기록이 바꾼 병원재고·업체 보관 잔량를 정확히 되돌림(기록마다 증감값을 저장해 둠).
// - 단가 미확인 품목은 price=null 그대로(0원으로 바꾸지 않음).
import { isRedDay } from './redDays.js';
import { dailyPatientsAuto } from './staff.js';
import { ensureInvSchema, INV_TABLES } from './invSchema.js';
import { moveTxDate } from './invTxDate.js';
import { OLD_DAILY_COUNTS } from './invDailyFix.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const bad = (error, status = 400) => json({ error }, status);
const num = v => (v === '' || v == null ? null : Number(v));
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const round = v => Math.round(v * 1000) / 1000;
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const fmtNum = v => String(round(v));
const okDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

async function all(db, sql, ...args) { return (await db.prepare(sql).bind(...args).all()).results || []; }
async function one(db, sql, ...args) { return db.prepare(sql).bind(...args).first(); }

async function itemsWithOptions(db) {
  const items = await all(db, `SELECT i.*, v.name AS vendor_name FROM inv_items i LEFT JOIN inv_vendors v ON v.id = i.vendor_id WHERE i.active = 1 ORDER BY i.sort, i.id`);
  const opts = await all(db, `SELECT * FROM inv_options WHERE active = 1 ORDER BY item_id, sort, id`);
  for (const it of items) it.options = opts.filter(o => o.item_id === it.id);
  const lastBuys = await all(db, `SELECT t.item_id, t.amount, t.qty, t.bonus_qty FROM inv_tx t WHERE t.deleted_at IS NULL AND t.kind = 'prepaid_buy' AND t.id = (SELECT max(id) FROM inv_tx x WHERE x.item_id = t.item_id AND x.kind = 'prepaid_buy' AND x.deleted_at IS NULL)`);
  for (const it of items) {
    const b = it.prepaid ? lastBuys.find(x => x.item_id === it.id) : null;
    it.unit_cost = b ? unitCostOf(b) : null; // 실질 취득단가(증정 포함)
    it.paid_unit_cost = b && b.amount != null && b.qty > 0 && b.bonus_qty > 0 ? Math.round((b.amount / b.qty) * 100) / 100 : null; // 유상 구매단가(증정이 있을 때만 다름)
  }
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

// 일반 품목 구매금액 = 등록 구매단가(주문단위 1개 가격) × 주문단위 수(재고단위 수량 ÷ 구성수량). 단가 미확인이면 null.
function priceFor(item, stockQty) {
  if (item.price == null) return null;
  return Math.round(item.price * (stockQty / (item.pack_qty || 1)));
}
// 선결제 개당원가 = 실제 구매금액 ÷ 증정 포함 총수량(가장 최근 선결제 구매 기준)
const unitCostOf = tx => (tx && tx.amount != null && tx.qty + tx.bonus_qty > 0 ? Math.round((tx.amount / (tx.qty + tx.bonus_qty)) * 100) / 100 : null);

async function loadItem(db, id) {
  const it = await one(db, 'SELECT * FROM inv_items WHERE id = ?', Number(id));
  return it || null;
}

function optionUnits(item, o) {
  // 구매조건의 수량·증정은 재고단위로 저장돼 있다(입력 화면에서 주문단위 × 구성수량으로 환산해 저장).
  return { qty: Number(o.qty) || 0, bonus: Number(o.bonus_qty) || 0, amount: o.amount == null ? null : Number(o.amount) };
}

// 그날 팀장이 출근했는지(사용자 지정 2026-11-08): 출근한 날은 품목 방식대로, 아니면(미입력·휴무·연차·상담·빨간 날) 화면이
// 당일 사용량을 닫고 마감재고만 받는다. 기록·수정은 언제든 가능. 못 센 날 생긴 재고 차이는 따로 표시하지 않는다.
// 마감일 기준 재고(2026-11-09 사용자: '입력한 시간이 아니라 사용자가 지정한 기준 날짜에 따라 계산'):
// 지금 병원재고에서 그 날짜 뒤(date > 마감일)에 생긴 입고·출고·반입·재고 맞추기 증감을 빼면 그날 마감 뒤 재고가 된다.
// 기록을 언제 입력했는지와 상관없이 기록의 날짜만 본다.
async function stockAtDates(db, date) {
  const rows = await all(db, `SELECT item_id, sum(hospital_delta) AS d FROM inv_tx WHERE deleted_at IS NULL AND date > ? GROUP BY item_id`, date);
  return new Map(rows.map(r => [r.item_id, r.d || 0]));
}

async function dailyCheck(db, date) {
  const lead = await db.prepare(`SELECT a.attendance, a.etc_type FROM staff s LEFT JOIN staff_attendance a ON a.staff_id = s.id AND a.work_date = ? WHERE s.is_leader = 1 ORDER BY s.status = 'retired', s.id LIMIT 1`).bind(date).first().catch(() => null);
  const att = lead?.attendance || null;
  const works = att === '정상근무' || (att === '기타' && lead?.etc_type === 'time');
  const label = works ? null : att ? (att === '상담' ? '풀상담일' : att === '공휴일' ? '휴일' : att === '기타' ? '무급' : `팀장 ${att}`) : isRedDay(date) ? '휴일' : '팀장 근태 미입력';
  // 작성제외(2026-11-09 사용자 문서 17번): 팀장 휴무·연차·상담·병원휴무·휴일, 빨간 날. 미기록·근태 미입력은 작성 대상.
  const skip = !works && (isRedDay(date) || ['휴무', '연차', '상담', '병원휴무', '휴일', '공휴일'].includes(att));
  return { ok: works, label, skip };
}

// ── 거래명세서 사진(2026-11-09 사용자 지정) ──
// 입고·선결제·반입 기록에 사진(또는 PDF)을 건다. 한 장을 같은 날 여러 기록에 걸 수 있고, 한 기록에 여러 장도 된다.
// 파일은 가격표 이미지와 같은 저장소(BUCKET: R2 또는 D1 조각)에 'inventory-invoices/…'로, 로그인한 사람만 받는다.
const INVOICE_KINDS = ['in', 'prepaid_buy', 'prepaid_in'];
function fileType(bytes) {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'image/heic';
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  return null;
}
async function uploadInvoice(request, env, db, user) {
  if (!env.BUCKET) return bad('파일 저장소가 연결되지 않았어요.', 503);
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const ids = String(form?.get('tx_ids') || '').split(',').map(Number).filter(n => n > 0);
  if (!(file && typeof file.arrayBuffer === 'function') || !file.size) return bad('사진을 골라 주세요.');
  if (file.size > 15 * 1024 * 1024) return bad('15MB 이하 파일만 올릴 수 있어요.');
  if (!ids.length) return bad('명세서를 걸 기록을 골라 주세요.');
  const txs = await all(db, `SELECT id, kind FROM inv_tx WHERE deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`, ...ids);
  if (txs.length !== ids.length || txs.some(t => !INVOICE_KINDS.includes(t.kind))) return bad('입고·선결제 기록에만 명세서를 걸 수 있어요.');
  const bytes = await file.arrayBuffer();
  const mime = fileType(bytes);
  if (!mime) return bad('사진(JPG·PNG·HEIC) 또는 PDF만 올릴 수 있어요.');
  const key = `inventory-invoices/${crypto.randomUUID()}`;
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: mime } });
  try {
    await db.prepare('INSERT INTO inv_invoices (object_key, mime, size, created_by, created_at) VALUES (?, ?, ?, ?, ?)').bind(key, mime, bytes.byteLength, user, Date.now()).run();
    const inv = await one(db, 'SELECT id FROM inv_invoices WHERE object_key = ?', key);
    await db.batch([...ids.map(id => db.prepare('INSERT OR IGNORE INTO inv_invoice_links (invoice_id, tx_id) VALUES (?, ?)').bind(inv.id, id)),
      ...ids.map(id => db.prepare('UPDATE inv_tx SET invoice = 1 WHERE id = ?').bind(id))]); // 사진이 올라가야 '명세서 받음'
    return json({ ok: true, id: inv.id });
  } catch (e) { await env.BUCKET.delete(key).catch(() => {}); throw e; }
}
async function invoiceFile(env, db, id) {
  const row = await one(db, 'SELECT object_key, mime FROM inv_invoices WHERE id = ?', id);
  const obj = row && env.BUCKET && await env.BUCKET.get(row.object_key);
  if (!obj) return bad('파일을 찾을 수 없어요.', 404);
  return new Response(obj.body, { headers: { 'content-type': row.mime || 'application/octet-stream', 'cache-control': 'private, max-age=86400' } });
}
// 사진이 더 이상 어느 기록에도 걸려 있지 않으면 파일까지 지운다
async function dropOrphanInvoices(env, db) {
  const orphans = await all(db, 'SELECT id, object_key FROM inv_invoices WHERE id NOT IN (SELECT invoice_id FROM inv_invoice_links l JOIN inv_tx t ON t.id = l.tx_id WHERE t.deleted_at IS NULL)');
  for (const o of orphans) {
    await db.batch([db.prepare('DELETE FROM inv_invoice_links WHERE invoice_id = ?').bind(o.id), db.prepare('DELETE FROM inv_invoices WHERE id = ?').bind(o.id)]);
    if (env.BUCKET) await env.BUCKET.delete(o.object_key).catch(() => {});
  }
}

// 예전 앱 일일재고 46일을 사진 숫자 그대로 한 번 넣는다(2026-11-10 사용자 '다른데' — 마감재고가 빠져 날마다 재고가 사진과 달랐음).
// 화면의 일일재고 저장과 같은 길(POST /daily: 마감재고 + 마감 전 재고 = 마감재고 + 사용량)을 날짜 순서대로. 11월에 직접 센 날은 그 수량 그대로 남는다.
const oldDailyDone = new WeakSet(); // 이미 확인한 DB
async function applyOldDailyCounts(request, env, url, db) {
  if (oldDailyDone.has(db) || env.SKIP_OLD_DAILY_FIX) return;
  const done = await one(db, `SELECT value FROM inv_meta WHERE key = 'dailyfix1'`).catch(() => null);
  if (done) { oldDailyDone.add(db); return; }
  const imported = await one(db, `SELECT value FROM inv_meta WHERE key = 'import'`).catch(() => null);
  if (!imported) return; // 예전 앱 자료를 넣은 곳에서만
  // D1은 요청 한 번에 쿼리 수가 정해져 있어 하루씩 나눠서(요청마다 한 날). 다른 요청과 겹치지 않게 날마다 잠금.
  const next = Number((await one(db, `SELECT value FROM inv_meta WHERE key = 'dailyfix1_next'`).catch(() => null))?.value || 0);
  if (next >= OLD_DAILY_COUNTS.length) {
    await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('dailyfix1', ?)`).bind(String(Date.now())).run();
    oldDailyDone.add(db); return;
  }
  try { await db.prepare('INSERT INTO inv_requests (id, path, created_at) VALUES (?,?,?)').bind(`fix:dailyfix1:${next}`, 'dailyfix1', Date.now()).run(); }
  catch { // 다른 요청이 이 날을 하고 있음 — 1분 넘게 끝나지 않았으면(중간에 끊김) 잠금을 풀어 다음 요청이 다시 하게
    await db.prepare('DELETE FROM inv_requests WHERE id = ? AND created_at < ?').bind(`fix:dailyfix1:${next}`, Date.now() - 60000).run().catch(() => undefined);
    return;
  }
  const day = OLD_DAILY_COUNTS[next];
  const items = await all(db, 'SELECT id, name FROM inv_items');
  const idOf = Object.fromEntries(items.map(i => [i.name, i.id]));
  const row = await one(db, 'SELECT patients, status, extra FROM inv_daily WHERE date = ?', day.d);
  const closing = {}, opening = {};
  for (const [name, [close, used]] of Object.entries(day.i)) {
    const id = idOf[name]; if (!id) continue;
    closing[id] = close; if (used != null) opening[id] = close + used;
  }
  let extra = {}; try { extra = row?.extra ? JSON.parse(row.extra) : {}; } catch { /* */ }
  const body = { date: day.d, patients: row ? row.patients : day.p, status: row?.status || null, extra, used: {}, closing, opening };
  const req = new Request(url.origin + '/api/inventory/daily', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const res = await inventoryRoute(req, env, new URL(req.url), '예전 앱 일일재고', db, '/daily', 'POST');
  if (!res.ok) console.log('dailyfix1', day.d, await res.text());
  await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('dailyfix1_next', ?)`).bind(String(next + 1)).run();
  return true;
}

export async function handleInventory(request, env, url, user) {
  const db = env.INV_DB;
  if (!db) return json({ error: '재고 데이터베이스가 연결되지 않았어요.', unavailable: true }, 503);
  try { await ensureInvSchema(db); }
  catch { return json({ error: '재고 자료를 잠시 불러오지 못했어요. 새로고침해 주세요.' }, 503); }
  const path = url.pathname.slice('/api/inventory'.length) || '/';
  const m = request.method;
  // 같은 요청 두 번 받기 방지(2026-11-09 사용자 문서 8번): 화면이 저장 한 번마다 고유 번호(x-req-id)를 붙인다.
  // 같은 번호가 다시 오면(재시도·두 번 누름) 처음 결과만 돌려주고 재고·결제는 다시 바꾸지 않는다.
  const reqId = m === 'GET' ? null : request.headers.get('x-req-id');
  if (reqId && /^[\w-]{8,64}$/.test(reqId)) {
    try { await db.prepare('INSERT INTO inv_requests (id, path, created_at) VALUES (?,?,?)').bind(reqId, `${m} ${path}`, Date.now()).run(); }
    catch {
      const seen = await one(db, 'SELECT response FROM inv_requests WHERE id = ?', reqId).catch(() => null);
      if (!seen?.response) return bad('같은 요청을 처리하고 있어요. 잠시 뒤 다시 확인해 주세요.', 409);
      let prev = { ok: true }; try { prev = JSON.parse(seen.response); } catch { /* 저장이 잘렸어도 처음 요청은 끝났음 */ }
      return json({ ...prev, duplicate: true });
    }
    const res = await inventoryRoute(request, env, url, user, db, path, m);
    if (res.ok) {
      let text = await res.clone().text();
      if (text.length > 4000) { let d = {}; try { d = JSON.parse(text); } catch { /* */ } text = JSON.stringify({ ok: true, ...(d.tx_id != null ? { tx_id: d.tx_id } : {}) }); }
      await db.prepare('UPDATE inv_requests SET response = ? WHERE id = ?').bind(text, reqId).run().catch(() => undefined);
    }
    else await db.prepare('DELETE FROM inv_requests WHERE id = ?').bind(reqId).run().catch(() => undefined);
    return res;
  }
  return inventoryRoute(request, env, url, user, db, path, m);
}

async function inventoryRoute(request, env, url, user, db, path, m) {
  if (m === 'POST' && path === '/invoices') return uploadInvoice(request, env, db, user);
  if (m === 'GET' && /^\/invoices\/\d+\/file$/.test(path)) return invoiceFile(env, db, Number(path.split('/')[2]));
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
        await db.batch([...INV_TABLES, 'inv_daily_log'].map(t => db.prepare(`DELETE FROM ${t}`)));
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
        all(db, `SELECT o.*, i.name AS item_name, i.stock_unit, (SELECT coalesce(sum(t.qty + t.bonus_qty), 0) FROM inv_tx t WHERE t.order_id = o.id AND t.deleted_at IS NULL AND t.kind = 'in') AS received_qty,
          (SELECT p.qty + p.bonus_qty FROM inv_orders p WHERE o.memo = 'from:' || p.id) AS contract_qty, (SELECT p.amount FROM inv_orders p WHERE o.memo = 'from:' || p.id) AS contract_amount FROM inv_orders o JOIN inv_items i ON i.id = o.item_id WHERE o.status = 'ordered' ORDER BY o.ordered_at, o.id`),
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
      // 가격은 있는데 구매조건이 없으면 '주문단위 1개 = 등록 단가' 조건을 하나 만들어 바로 주문할 수 있게 한다
      const saved = body.id ? await loadItem(db, body.id) : await one(db, 'SELECT * FROM inv_items ORDER BY id DESC LIMIT 1');
      if (saved && saved.price != null && !saved.prepaid && !(await one(db, 'SELECT id FROM inv_options WHERE item_id = ? AND active = 1', saved.id))) {
        const pack = saved.pack_qty || 1;
        await db.prepare('INSERT INTO inv_options (item_id, label, qty, bonus_qty, amount, prepaid, sort, created_at) VALUES (?,?,?,?,?,0,0,?)')
          .bind(saved.id, `1${saved.order_unit || saved.stock_unit}${pack !== 1 ? `(${pack}${saved.stock_unit})` : ''}`, pack, 0, saved.price, Date.now()).run();
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
    // ── 선결제 품목 주문(2026-11-09 사용자 지정 규칙) ──
    // (사용자 문서의 '업체 보관 잔량' = 화면의 '업체 보관 잔량') 주문수량을 먼저 업체 보관 잔량(업체 보관 잔량 − 받기 전 반입 예정)에서 모두 쓰고, 모자랄 때만 신규 선결제 옵션 하나를 골라 한 번에 결제한다
    // (부분 선결제·부분 결제 없음). 업체 보관 잔량만으로 되면 신규 선결제를 만들지 않는다.
    // 주문 때는 업체 보관 잔량을 빼지 않는다(주문 후 업체 보관 잔량은 예상값). 실제 차감은 '입고확정' 때만: 업체 보관 잔량 − 실제 도착, 병원재고 + 실제 도착을 한 batch로.
    if (m === 'POST' && path === '/prepaid-order') {
      const item = await loadItem(db, body.item_id);
      if (!item) return bad('품목을 찾을 수 없어요.', 404);
      if (!item.prepaid) return bad('선결제 품목이 아니에요.');
      const qty = num(body.qty);
      if (!(qty > 0)) return bad('병원 입고 수량을 입력해 주세요.');
      const date = okDate(body.date) ? body.date : kstToday();
      const pend = await one(db, `SELECT coalesce(sum(qty), 0) AS q FROM inv_orders WHERE item_id = ? AND prepaid = 1 AND status = 'ordered'`, item.id);
      const keep = round((item.vendor_stock || 0) - (pend?.q || 0));
      const short = round(Math.max(0, qty - Math.max(0, keep)));
      let opt = null;
      if (short > 0) {
        opt = await one(db, 'SELECT * FROM inv_options WHERE id = ? AND item_id = ? AND active = 1 AND prepaid = 1', Number(body.option_id), item.id);
        if (!opt) return bad(`업체 보관 잔량이 ${short} ${item.stock_unit} 모자라요. 신규 선결제 옵션을 골라 주세요.`);
        if (opt.qty + (opt.bonus_qty || 0) < short) return bad('고른 선결제 옵션으로도 모자라요. 더 큰 옵션을 골라 주세요.');
      } else if (body.option_id) return bad('업체 보관 잔량으로 충분해서 신규 선결제가 필요 없어요.');
      // 결제 기록·주문 연결·반입 예정을 한 batch로(중간에 끊기거나 다른 요청이 끼어도 엉키지 않게)
      const stmts = [];
      if (opt) {
        const total = round(opt.qty + (opt.bonus_qty || 0));
        stmts.push(db.prepare(`INSERT INTO inv_orders (item_id, option_id, option_label, ordered_at, qty, bonus_qty, amount, prepaid, status, memo, created_by, created_at) VALUES (?,?,?,?,?,?,?,1,'paid',?,?,?)`)
            .bind(item.id, opt.id, opt.label, date, opt.qty, opt.bonus_qty || 0, opt.amount, body.memo || null, user, Date.now()),
          ...txStatements(db, item, { date, kind: 'prepaid_buy', qty: opt.qty, bonus_qty: opt.bonus_qty || 0, amount: opt.amount, vendor_delta: total, memo: body.memo || opt.label, by: user }),
          db.prepare(`UPDATE inv_tx SET order_id = (SELECT max(id) FROM inv_orders) WHERE id = (SELECT max(id) FROM inv_tx)`));
      }
      stmts.push(db.prepare(`INSERT INTO inv_orders (item_id, option_id, option_label, ordered_at, qty, bonus_qty, amount, prepaid, status, memo, created_by, created_at)
        VALUES (?,?,?,?,?,0,0,1,'ordered', CASE WHEN ? THEN 'from:' || (SELECT max(id) FROM inv_orders) ELSE 'keep' END, ?, ?)`)
        .bind(item.id, opt?.id ?? null, '입고 예정', date, round(qty), opt ? 1 : 0, user, Date.now()));
      await db.batch(stmts);
      const newQty = opt ? round(opt.qty + (opt.bonus_qty || 0)) : 0;
      return json({ ok: true, keep, qty, after: round(keep + newQty - qty), option: opt?.label ?? null, new_amount: opt?.amount ?? 0, pay: opt?.amount ?? 0 });
    }
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
        // 선결제: 결제와 동시에 업체 보관 잔량 생성. 병원재고는 반입(입고확정) 때 늘어난다.
        const ship = num(body.ship_qty) ?? 0;
        if (!isNum(ship) || ship < 0 || ship > qty + bonus) return bad(`병원 입고 수량은 0 ~ ${round(qty + bonus)} ${item.stock_unit} 사이로 적어 주세요.`);
        const stmts = [db.prepare(`INSERT INTO inv_orders (item_id, option_id, option_label, ordered_at, qty, bonus_qty, amount, prepaid, status, memo, created_by, created_at) VALUES (?,?,?,?,?,?,?,1,'paid',?,?,?)`)
          .bind(item.id, opt.id, opt.label, date, qty, bonus, amount, body.memo || null, user, Date.now()),
        ...txStatements(db, item, { date, kind: 'prepaid_buy', qty, bonus_qty: bonus, amount, vendor_delta: qty + bonus, memo: body.memo || opt.label, by: user, invoice: 0 })];
        stmts.push(db.prepare(`UPDATE inv_tx SET order_id = (SELECT max(id) FROM inv_orders) WHERE id = (SELECT max(id) FROM inv_tx)`));
        if (ship > 0) stmts.push(db.prepare(`INSERT INTO inv_orders (item_id, option_id, option_label, ordered_at, qty, bonus_qty, amount, prepaid, status, memo, created_by, created_at) VALUES (?,?,?,?,?,0,0,1,'ordered','from:' || (SELECT max(id) FROM inv_orders),?,?)`)
          .bind(item.id, opt.id, '입고 예정', date, round(ship), user, Date.now()));
        await db.batch(stmts); // 한 batch(한 트랜잭션)라 max(id)가 이 요청 것
        return json({ ok: true, prepaid: true, ship });
      }
      await db.prepare(`INSERT INTO inv_orders (item_id, option_id, option_label, ordered_at, qty, bonus_qty, amount, prepaid, status, memo, created_by, created_at) VALUES (?,?,?,?,?,?,?,0,'ordered',?,?,?)`)
        .bind(item.id, opt.id, opt.label, date, qty, bonus, amount, body.memo || null, user, Date.now()).run();
      return json({ ok: true });
    }
    if (m === 'POST' && /^\/orders\/\d+\/cancel$/.test(path)) {
      // 일부라도 받은 주문은 '취소' 대신 받은 만큼으로 마감(나머지가 안 오는 경우)
      const oid = Number(path.split('/')[2]);
      const got = await one(db, `SELECT count(*) AS n FROM inv_tx WHERE deleted_at IS NULL AND order_id = ? AND kind IN ('in','prepaid_in')`, oid);
      const r = await db.prepare(`UPDATE inv_orders SET status = ?, received_at = CASE WHEN ? = 'closed' THEN ? ELSE received_at END WHERE id = ? AND status = 'ordered'`)
        .bind(got?.n ? 'closed' : 'cancelled', got?.n ? 'closed' : 'cancelled', kstToday(), oid).run(); // 손으로 마감한 주문은 'closed' — 도착 기록을 지워도 다시 열리지 않음
      if (!r.meta?.changes) return bad('취소할 주문을 찾을 수 없어요.', 404);
      return json({ ok: true });
    }

    // ── 입고확정 ──
    // 일반 구매: 주문 1건을 받음(실제 도착 수량만 병원재고 +, 결제금액은 주문 그대로).
    // 선결제 반입: 업체 보관 잔량 - 실제 수량, 병원재고 + 실제 수량을 한 batch로. 결제금액 0.
    if (m === 'POST' && path === '/receive') {
      const actual = num(body.actual_qty);
      if (!(actual > 0)) return bad('실제 도착 수량을 입력해 주세요.');
      const date = okDate(body.date) ? body.date : kstToday();
      if (body.from_prepaid) {
        const item = await loadItem(db, body.item_id);
        if (!item) return bad('품목을 찾을 수 없어요.', 404);
        if (actual > round(item.vendor_stock || 0)) return bad(`업체 보관 잔량(${round(item.vendor_stock || 0)} ${item.stock_unit})보다 많이 받을 수 없어요.`);
        // 같은 물건을 두 번 받지 않게: 받기 전 반입 예정이 있으면 그 줄에서 입고확정
        if (await one(db, `SELECT id FROM inv_orders WHERE item_id = ? AND prepaid = 1 AND status = 'ordered'`, item.id)) return bad('받기 전 입고 예정이 있어요. 위 주문한 것 받기에서 입고확정해 주세요.', 409);
        await db.batch(txStatements(db, item, { date, kind: 'prepaid_in', qty: actual, amount: 0, hospital_delta: actual, vendor_delta: -actual, memo: body.memo, by: user, invoice: 0 }));
        return json({ ok: true, item: await loadItem(db, item.id), tx_id: (await one(db, `SELECT max(id) AS id FROM inv_tx WHERE item_id = ? AND kind = 'prepaid_in'`, item.id)).id });
      }
      if (body.order_id) {
        const order = await one(db, `SELECT * FROM inv_orders WHERE id = ? AND status = 'ordered'`, Number(body.order_id));
        if (!order) return bad('받을 주문을 찾을 수 없어요.', 404);
        const item = await loadItem(db, order.item_id);
        // 같은 주문을 두 기기에서 동시에 받으면 하나만 되게: 주문별 받기 번호를 먼저 잡는다(겹치면 batch 전체가 취소됨)
        const seen = await one(db, 'SELECT count(*) AS n FROM inv_tx WHERE order_id = ?', order.id);
        const lock = db.prepare('INSERT INTO inv_requests (id, path, created_at) VALUES (?,?,?)').bind(`recv:${order.id}:${seen?.n || 0}`, 'receive-lock', Date.now());
        if (order.prepaid) {
          // 선결제 반입 예정: 실제 도착 수량만 업체 보관 잔량 → 병원재고로 옮긴다(금액 없음). 주문 수량보다 많이는 못 받음(오타 방지).
          const oq = round(order.qty + (order.bonus_qty || 0));
          if (actual > oq) return bad(`주문 수량(${oq} ${item.stock_unit})보다 많이 받을 수 없어요. 더 받으려면 주문을 하나 더 해 주세요.`);
          if (actual > round(item.vendor_stock || 0)) return bad(`업체 보관 잔량(${round(item.vendor_stock || 0)} ${item.stock_unit})보다 많이 받을 수 없어요.`);
          await db.batch([lock,
            db.prepare(`UPDATE inv_orders SET status = 'received', received_at = ? WHERE id = ? AND status = 'ordered'`).bind(date, order.id),
            ...txStatements(db, item, { date, kind: 'prepaid_in', qty: actual, amount: 0, hospital_delta: actual, vendor_delta: -actual, order_id: order.id, memo: body.memo, by: user, invoice: 0 }),
          ]);
          return json({ ok: true, tx_id: (await one(db, 'SELECT max(id) AS id FROM inv_tx WHERE order_id = ?', order.id)).id });
        }
        // 나눠서 도착(2026-11-09 사용자 지정): 도착할 때마다 그날 날짜로 따로 기록. 결제금액은 처음 받은 기록에 한 번만,
        // 다음 도착분은 0원. 주문 수량을 다 받을 때까지 주문은 '받기 전'에 남는다(남은 것이 안 오면 주문 줄에서 '마감').
        const got = await one(db, `SELECT coalesce(sum(qty + bonus_qty), 0) AS q, count(*) AS n FROM inv_tx WHERE deleted_at IS NULL AND order_id = ? AND kind = 'in'`, order.id);
        const total = round(order.qty + (order.bonus_qty || 0)), left = round(total - (got?.q || 0));
        const first = !(got?.n > 0);
        if (actual > left) return bad(`남은 수량(${left} ${item.stock_unit})보다 많이 받을 수 없어요. 더 온 것은 '증정·행사로 받기'로 적어 주세요.`);
        const done = actual >= left;
        const nth = (got?.n || 0) + 1;
        await db.batch([lock,
          ...(done ? [db.prepare(`UPDATE inv_orders SET status = 'received', received_at = ? WHERE id = ? AND status = 'ordered'`).bind(date, order.id)] : []),
          ...txStatements(db, item, { date, kind: 'in', qty: actual, bonus_qty: 0, amount: first ? order.amount : 0, hospital_delta: actual, order_id: order.id,
            memo: body.memo || (first && done ? order.option_label : `${order.option_label || '주문'} · 나눠 받음 ${nth}차`), by: user, invoice: 0 }),
        ]);
        return json({ ok: true, left: done ? 0 : round(left - actual), tx_id: (await one(db, 'SELECT max(id) AS id FROM inv_tx WHERE order_id = ?', order.id)).id });
      }
      // 주문 없이 바로 받은 일반 입고: 금액을 안 넣으면 등록된 구매단가 × 수량(주문단위는 구성수량으로 환산). 단가 미확인이면 금액 없음.
      const item = await loadItem(db, body.item_id);
      if (!item) return bad('품목을 찾을 수 없어요.', 404);
      if (item.prepaid) return bad('선결제 품목은 재고주문에서 주문한 뒤 받기에서 입고확정해 주세요.');
      const bonus = num(body.bonus_qty) ?? 0;
      if (bonus < 0 || bonus > actual) return bad('증정 수량을 확인해 주세요.');
      let amount = num(body.amount);
      if (amount != null && amount < 0) return bad('금액은 0 이상이어야 해요.');
      if (amount == null) amount = priceFor(item, actual - bonus);
      await db.batch(txStatements(db, item, { date, kind: 'in', qty: actual - bonus, bonus_qty: bonus, amount, hospital_delta: actual, memo: body.memo, by: user, invoice: 0 }));
      return json({ ok: true, amount, tx_id: (await one(db, `SELECT max(id) AS id FROM inv_tx WHERE item_id = ? AND kind = 'in'`, item.id)).id });
    }

    // ── 출고: 병원재고만 재고단위로 차감 ──
    if (m === 'POST' && path === '/out') {
      const item = await loadItem(db, body.item_id);
      if (!item) return bad('품목을 찾을 수 없어요.', 404);
      const qty = num(body.qty);
      if (!(qty > 0)) return bad('출고 수량을 입력해 주세요.');
      if (qty > round(item.hospital_stock || 0)) return bad(`병원재고(${round(item.hospital_stock || 0)} ${item.stock_unit})보다 많이 출고할 수 없어요.`);
      const date = okDate(body.date) ? body.date : kstToday();
      await db.batch(txStatements(db, item, { date, kind: 'out', qty, hospital_delta: -qty, memo: body.memo, by: user }));
      return json({ ok: true });
    }

    // ── 재고 맞추기(실사): 센 수량으로 병원재고·업체 보관 잔량을 맞추고 차이를 기록(삭제하면 되돌림) ──
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
      // 지우면 재고가 0보다 적어지는 기록은 지우지 않는다(예: 이미 병원으로 반입한 선결제 구매 기록)
      const cur = await loadItem(db, tx.item_id);
      if (cur) {
        const h = round(cur.hospital_stock - tx.hospital_delta), v = round(cur.vendor_stock - tx.vendor_delta);
        if (v < 0 && tx.vendor_delta > 0) return bad(tx.kind === 'prepaid_buy' ? '이 결제로 산 수량이 이미 병원에 입고돼서 지울 수 없어요. 입고 기록을 먼저 지워 주세요.' : '지우면 업체 보관 잔량이 0보다 적어져요.', 409);
        if (h < 0 && tx.hospital_delta > 0) return bad('지우면 병원재고가 0보다 적어져요. 그 뒤 출고 기록을 먼저 확인해 주세요.', 409);
      }
      const stmts = [
        db.prepare(`UPDATE inv_items SET hospital_stock = round(hospital_stock - ?, 3), vendor_stock = round(vendor_stock - ?, 3), updated_at = ? WHERE id = ?`).bind(tx.hospital_delta, tx.vendor_delta, Date.now(), tx.item_id),
        db.prepare('UPDATE inv_tx SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL').bind(Date.now(), user, tx.id),
      ];
      if (tx.order_id && tx.kind === 'in' && tx.amount) {
        // 나눠 받은 주문: 결제금액이 걸린 첫 기록은 뒤 도착분을 먼저 지워야 지울 수 있다(금액이 사라지지 않게)
        const later = await one(db, `SELECT count(*) AS n FROM inv_tx WHERE deleted_at IS NULL AND order_id = ? AND kind = 'in' AND id <> ?`, tx.order_id, tx.id);
        if (later?.n) return bad('같은 주문의 나중 도착 기록부터 지워 주세요.', 409);
      }
      if (tx.order_id && (tx.kind === 'in' || tx.kind === 'prepaid_in')) stmts.push(db.prepare(`UPDATE inv_orders SET status = 'ordered', received_at = NULL WHERE id = ? AND status = 'received'`).bind(tx.order_id)); // 손으로 마감('closed')한 주문은 그대로
      if (tx.order_id && tx.kind === 'prepaid_buy') {
        stmts.push(db.prepare(`UPDATE inv_orders SET status = 'cancelled' WHERE id = ?`).bind(tx.order_id));
        stmts.push(db.prepare(`UPDATE inv_orders SET status = 'cancelled' WHERE memo = ? AND status = 'ordered'`).bind(`from:${tx.order_id}`)); // 받기 전 반입 예정도 함께 취소
      }
      await db.batch(stmts);
      await dropOrphanInvoices(env, db);
      return json({ ok: true, item: await loadItem(db, tx.item_id) });
    }
    if (m === 'DELETE' && /^\/invoices\/\d+$/.test(path)) {
      // 명세서 사진 지우기(걸린 기록 모두에서 빠짐)
      const id = Number(path.split('/')[2]);
      const linked = await all(db, 'SELECT tx_id FROM inv_invoice_links WHERE invoice_id = ?', id);
      await db.prepare('DELETE FROM inv_invoice_links WHERE invoice_id = ?').bind(id).run();
      // 사진이 하나도 안 남은 기록은 '명세서 받음'도 풀림
      if (linked.length) await db.batch(linked.map(l => db.prepare('UPDATE inv_tx SET invoice = 0 WHERE id = ? AND NOT EXISTS (SELECT 1 FROM inv_invoice_links WHERE tx_id = ?)').bind(l.tx_id, l.tx_id)));
      await dropOrphanInvoices(env, db);
      return json({ ok: true });
    }
    if (m === 'POST' && /^\/invoices\/\d+\/links$/.test(path)) {
      // 이미 올린 사진을 같은 날 다른 기록에도 걸기
      const id = Number(path.split('/')[2]);
      const ids = (Array.isArray(body.tx_ids) ? body.tx_ids : []).map(Number).filter(n => n > 0);
      if (!ids.length) return bad('기록을 골라 주세요.');
      await db.batch([...ids.map(t => db.prepare(`INSERT OR IGNORE INTO inv_invoice_links (invoice_id, tx_id) SELECT ?, id FROM inv_tx WHERE id = ? AND deleted_at IS NULL AND kind IN ('in','prepaid_buy','prepaid_in')`).bind(id, t)),
        ...ids.map(t => db.prepare('UPDATE inv_tx SET invoice = 1 WHERE id = ? AND EXISTS (SELECT 1 FROM inv_invoice_links WHERE tx_id = ?)').bind(t, t))]);
      return json({ ok: true });
    }
    if (m === 'PATCH' && path.startsWith('/tx/')) {
      // 메모, 그리고 입고·출고·선결제 반입의 수량(2026-11-09 사용자 문서 7·8번): 고친 전후 차이만 재고에 반영, 결제금액은 그대로.
      const id = Number(path.split('/')[2]);
      // 날짜 고치기(2026-11-10 사용자: 6일에 들어온 300장을 9일로 입고확정해 6일 실사와 두 번 더해짐).
      // 병원재고 합계는 그대로. 옮긴 사이에 일일재고로 센 날이 있으면 그 날 센 마감재고가 그대로 남도록 그 날 '마감 전 재고 고침'만 반대로 맞춘다.
      if (body.date != null) {
        const tx = await one(db, 'SELECT * FROM inv_tx WHERE id = ? AND deleted_at IS NULL', id);
        if (!tx) return bad('기록을 찾을 수 없어요.', 404);
        if (!['in', 'out', 'prepaid_in', 'prepaid_buy'].includes(tx.kind) || tx.daily_date) return bad('이 기록은 날짜를 고칠 수 없어요.');
        const date = String(body.date);
        if (!okDate(date) || date > kstToday()) return bad('날짜를 확인해 주세요.');
        const err = await moveTxDate(db, tx, date, user);
        if (err) return bad(err);
        if (body.actual_qty == null) return json({ ok: true });
      }
      if (body.actual_qty != null) {
        const tx = await one(db, 'SELECT * FROM inv_tx WHERE id = ? AND deleted_at IS NULL', id);
        if (!tx) return bad('기록을 찾을 수 없어요.', 404);
        if (!['in', 'out', 'prepaid_in'].includes(tx.kind) || tx.daily_date) return bad(tx.daily_date ? '일일 마감 소모는 일일재고에서 고쳐 주세요.' : '이 기록은 수량을 고칠 수 없어요.');
        const actual = num(body.actual_qty);
        if (!(actual > 0)) return bad('수량은 0보다 커야 해요.');
        if (tx.kind === 'in' && actual < tx.bonus_qty) return bad(`증정 수량(${tx.bonus_qty})보다 적게 고칠 수 없어요.`);
        const old = Math.abs(tx.hospital_delta);
        const diff = round(actual - old);
        if (!diff) return json({ ok: true, unchanged: true });
        const item = await loadItem(db, tx.item_id);
        const hd = tx.kind === 'out' ? -diff : diff, vd = tx.kind === 'prepaid_in' ? -diff : 0;
        if (round(item.hospital_stock + hd) < 0) return bad(`병원재고(${round(item.hospital_stock)} ${item.stock_unit})가 모자라요.`);
        if (round(item.vendor_stock + vd) < 0) return bad(`업체 보관 잔량(${round(item.vendor_stock)} ${item.stock_unit})보다 많이 받을 수 없어요.`);
        if (tx.order_id && tx.kind !== 'out') { // 주문으로 받은 기록은 주문 수량을 넘게 고치지 못함
          const o = await one(db, 'SELECT qty, bonus_qty FROM inv_orders WHERE id = ?', tx.order_id);
          const others = await one(db, `SELECT coalesce(sum(abs(hospital_delta)), 0) AS q FROM inv_tx WHERE deleted_at IS NULL AND order_id = ? AND id <> ? AND kind = ?`, tx.order_id, tx.id, tx.kind);
          const cap = o ? round(o.qty + (o.bonus_qty || 0) - (tx.kind === 'in' ? others?.q || 0 : 0)) : Infinity;
          if (actual > cap) return bad(`주문 수량을 넘게 고칠 수 없어요(최대 ${cap} ${item.stock_unit}).`);
        }
        const qty = tx.kind === 'in' ? round(actual - tx.bonus_qty) : actual;
        await db.batch([
          db.prepare(`UPDATE inv_items SET hospital_stock = round(hospital_stock + ?, 3), vendor_stock = round(vendor_stock + ?, 3), updated_at = ? WHERE id = ?`).bind(hd, vd, Date.now(), item.id),
          db.prepare(`UPDATE inv_tx SET qty = ?, hospital_delta = round(hospital_delta + ?, 3), vendor_delta = round(vendor_delta + ?, 3), hospital_after = round(coalesce(hospital_after, 0) + ?, 3), vendor_after = round(coalesce(vendor_after, 0) + ?, 3),
            memo = trim(coalesce(memo, '') || ' ' || ?) WHERE id = ? AND deleted_at IS NULL`).bind(qty, hd, vd, hd, vd, `(수량 ${fmtNum(old)}→${fmtNum(actual)} 수정 · ${user || ''})`.replace(' · )', ')'), id),
        ]);
        return json({ ok: true, diff });
      }
      await db.prepare('UPDATE inv_tx SET invoice = coalesce(?, invoice), memo = coalesce(?, memo) WHERE id = ? AND deleted_at IS NULL')
        .bind(null, body.memo ?? null, id).run(); // 명세서 받음은 사진을 올려야만(2026-11-09 사용자)
      return json({ ok: true });
    }
    if (m === 'GET' && path === '/tx') {
      const from = url.searchParams.get('from') || '0000-01-01', to = url.searchParams.get('to') || '9999-12-31';
      const kind = url.searchParams.get('kind'), itemId = url.searchParams.get('item_id');
      const rows = await all(db, `SELECT t.*, i.name AS item_name, i.stock_unit, v.name AS vendor_name, (SELECT group_concat(l.invoice_id) FROM inv_invoice_links l WHERE l.tx_id = t.id) AS invoice_ids FROM inv_tx t JOIN inv_items i ON i.id = t.item_id LEFT JOIN inv_vendors v ON v.id = i.vendor_id
        WHERE t.deleted_at IS NULL AND NOT (t.daily_date IS NOT NULL AND t.hospital_delta = 0) AND t.date BETWEEN ? AND ? ${kind ? `AND t.kind IN (${kind.split(',').map(() => '?').join(',')})` : ''} ${itemId ? 'AND t.item_id = ?' : ''}
        ORDER BY t.date DESC, t.id DESC LIMIT 500`, from, to, ...(kind ? kind.split(',') : []), ...(itemId ? [Number(itemId)] : []));
      return json({ rows });
    }

    // ── 일일 재고(마감) ──
    if (m === 'GET' && path === '/fix-left') { // 예전 일일재고 넣기가 몇 날 남았는지(화면이 다 끝날 때까지 불러 마저 넣음)
      // 다른 화면 요청은 느려지지 않게 여기서만 넣는다. 한 번에 여러 날(최대 20초) — 요청당 쿼리 한도에 걸리면 거기서 멈추고 다음 부름에서 이어서.
      const t0 = Date.now();
      for (let k = 0; k < 46 && Date.now() - t0 < 20000; k++) {
        let did = false;
        try { did = await applyOldDailyCounts(request, env, url, db); } catch { break; }
        if (!did) break;
      }
      const done = await one(db, `SELECT value FROM inv_meta WHERE key = 'dailyfix1'`);
      const imported = await one(db, `SELECT value FROM inv_meta WHERE key = 'import'`);
      const next = Number((await one(db, `SELECT value FROM inv_meta WHERE key = 'dailyfix1_next'`))?.value || 0);
      return json({ left: done || !imported || env.SKIP_OLD_DAILY_FIX ? 0 : Math.max(0, OLD_DAILY_COUNTS.length - next) });
    }
    if (m === 'GET' && path === '/daily') {
      const date = okDate(url.searchParams.get('date')) ? url.searchParams.get('date') : kstToday();
      const day = await one(db, 'SELECT * FROM inv_daily WHERE date = ?', date);
      const items = await all(db, `SELECT i.id, i.name, i.stock_unit, i.hospital_stock, i.daily_mode, i.vendor_id, v.name AS vendor_name FROM inv_items i LEFT JOIN inv_vendors v ON v.id = i.vendor_id WHERE i.active = 1 AND i.daily_mode IS NOT NULL ORDER BY i.sort, i.id`);
      // 그날 일일재고가 바꾼 병원재고(소모 −, 실사가 더 많아 늘린 것 +)를 합친 순 사용량
      const used = await all(db, `SELECT item_id, round(sum(-hospital_delta), 3) AS qty FROM inv_tx WHERE deleted_at IS NULL AND daily_date = ? AND kind IN ('out', 'adjust') GROUP BY item_id`, date);
      const fixes = await all(db, `SELECT item_id, round(sum(hospital_delta), 3) AS q FROM inv_tx WHERE deleted_at IS NULL AND daily_date = ? AND kind = 'adjust' AND memo LIKE '마감 전 재고 고침%' GROUP BY item_id`, date);
      const since = new Date(Date.parse(date) - 14 * 864e5).toISOString().slice(0, 10);
      const recent = await all(db, `SELECT item_id, sum(qty) AS q FROM inv_tx WHERE deleted_at IS NULL AND kind = 'out' AND daily_date BETWEEN ? AND ? GROUP BY item_id`, since, date);
      const later = await stockAtDates(db, date);
      // 기록상태: 작성완료 / 작성제외 / 미작성(작성 대상인데 기록 없음). 작성일시·작성자는 저장 기록(inv_daily_log)에서.
      const check = await dailyCheck(db, date);
      const log = await all(db, 'SELECT id, data, created_by, created_at FROM inv_daily_log WHERE date = ? ORDER BY id', date);
      const written = !!day || used.length > 0;
      const record = { state: written ? 'done' : check.skip ? 'skip' : date <= kstToday() ? 'missing' : null,
        first_at: log[0]?.created_at ?? day?.updated_at ?? null, first_by: log[0]?.created_by ?? day?.updated_by ?? null,
        last_at: log.length ? log[log.length - 1].created_at : day?.updated_at ?? null, last_by: log.length ? log[log.length - 1].created_by : day?.updated_by ?? null,
        log: log.map(l => ({ at: l.created_at, by: l.created_by, ...JSON.parse(l.data || '{}') })) };
      return json({ date, record, check, patients_auto: await dailyPatientsAuto(db, date), day: day ? { ...day, extra: day.extra ? JSON.parse(day.extra) : {} } : null, items: items.map(it => ({ ...it, stock_at: round(it.hospital_stock - (later.get(it.id) || 0)), used: used.find(u => u.item_id === it.id)?.qty ?? null, open_fix: fixes.find(f => f.item_id === it.id)?.q ?? null, used15: recent.find(r => r.item_id === it.id)?.q ?? 0 })) });
    }
    if (m === 'POST' && path === '/daily') {
      const date = okDate(body.date) ? body.date : null;
      if (!date) return bad('날짜를 확인해 주세요.');
      const auto = date ? await dailyPatientsAuto(db, date) : null;
      const patients = auto ?? num(body.patients); // 성과에 관리 인원이 있으면 그 합계가 우선
      if (patients != null && (patients < 0 || !Number.isInteger(patients))) return bad('피부관리 인원은 0 이상의 정수예요.');
      const stmts = [db.prepare(`INSERT INTO inv_daily (date, patients, status, extra, updated_by, updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(date) DO UPDATE SET patients = excluded.patients, status = excluded.status, extra = excluded.extra, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .bind(date, patients, body.status || null, JSON.stringify(body.extra || {}), user, Date.now())];
      // 마감재고로 적은 품목(2026-11-09 사용자): 실제로 센 수량이 그 날짜의 병원재고가 된다.
      // 마감 전 재고(마감일 기준 장부) − 마감재고 = 그날 바뀐 양. 못 적은 날(휴무·연차·상담 등)의 사용량을 나누거나 따로 빼지 않고,
      // 그 사이 입고·출고 기록은 그대로 둔 채 차이만 한 번 반영. 같은 날을 다시 저장하면 앞서 반영한 것을 되돌리고 새 값으로(중복 차감 없음).
      // 업체 보관 잔량는 바꾸지 않는다.
      const used = { ...(body.used || {}) };
      const closing = Object.entries(body.closing || {}).filter(([, v]) => v !== '' && v != null);
      // 마감 전 재고 고침(2026-11-09 사용자 '월말 보고서 사용량까지 정확하게'): 그 날 시작 재고를 직접 적으면
      // '마감 전 재고 고침'(조정) + 사용량 = 고친 마감 전 재고 − 마감재고(출고)로 나눠 기록. 병원재고 결과는 같고(센 마감재고), 월말 사용량만 정확해진다.
      const openOf = {}, ledgerOf = {};
      if (closing.length) {
        const later = await stockAtDates(db, date);
        for (const [id, raw] of closing) {
          const left = num(raw);
          if (!isNum(left) || left < 0) return bad('마감재고는 0 이상이어야 해요.');
          const it = await loadItem(db, id);
          if (!it) continue;
          const prev = await one(db, `SELECT coalesce(sum(-hospital_delta), 0) AS q FROM inv_tx WHERE deleted_at IS NULL AND daily_date = ? AND item_id = ? AND kind IN ('out', 'adjust')`, date, it.id);
          const before = round(it.hospital_stock - (later.get(it.id) || 0) + (prev?.q || 0));
          used[id] = round(before - left); // 음수면 센 수량이 장부보다 많음 → 그만큼 늘림
          const rawOpen = body.opening?.[id];
          if (rawOpen !== undefined && rawOpen !== '' && rawOpen !== null) {
            const op = num(rawOpen);
            if (!isNum(op) || op < 0) return bad('마감 전 재고는 0 이상이어야 해요.');
            if (left > op) return bad(`${it.name}: 마감재고가 마감 전 재고(${op} ${it.stock_unit})보다 많아요.`);
            openOf[it.id] = op; ledgerOf[it.id] = before;
          }
        }
      }
      // 품목별 당일 사용량: 이전 마감 출고를 되돌리고 새 값으로 다시 기록(같은 batch)
      const logUsed = {};
      for (const [id, raw] of Object.entries(used)) {
        const qty = num(raw);
        const counted = closing.some(([cid]) => Number(cid) === Number(id));
        if (qty == null) continue; // 비운 칸 = 이번에 안 셈 → 손대지 않음
        if (!Number.isFinite(qty) || (qty < 0 && !counted)) return bad('사용량은 0 이상이어야 해요.');
        let item = await loadItem(db, id);
        if (!item) continue;
        const old = await all(db, `SELECT * FROM inv_tx WHERE deleted_at IS NULL AND daily_date = ? AND item_id = ? AND kind IN ('out', 'adjust')`, date, item.id);
        const back = round(old.reduce((a, t) => a - t.hospital_delta, 0)); // 앞서 이 날 반영한 소모(되돌릴 양)
        const change = round(back - qty); // 이 저장으로 마감일 병원재고가 바뀐 양
        const start = item.hospital_stock;
        // 한 날의 기록을 바꿀 때 재고는 한 번에 '차이만' 움직인다(되돌렸다 다시 빼는 두 단계면 중간에 0 밑으로 내려가 막힐 수 있음).
        // txStatements의 [재고 UPDATE, 기록 INSERT] 중 INSERT만 쓰고 재고 UPDATE는 차이 한 번으로.
        const rowOnly = (it2, t) => txStatements(db, it2, t)[1];
        const dS = old.map(t => db.prepare('UPDATE inv_tx SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(Date.now(), user, t.id));
        if (change) dS.push(db.prepare('UPDATE inv_items SET hospital_stock = round(hospital_stock + ?, 3), updated_at = ? WHERE id = ?').bind(change, Date.now(), item.id));
        const dItem = { ...item, hospital_stock: round(start + back) }; // 기록의 '기록 후 병원재고' = 시작 + 되돌림 − 새 소모
        // 센 마감재고는 메모에 '마감재고'를 붙여 둔다(뒤에 앞 날짜를 고쳐도 이 날 센 수량이 그대로 남게 하는 표시)
        const op = counted ? openOf[item.id] : undefined;
        if (op !== undefined) {
          const fix = round(op - ledgerOf[item.id]), use = round(qty + fix); // 사용량 = 고친 마감 전 재고 − 마감재고
          if (fix) dS.push(rowOnly(dItem, { date, kind: 'adjust', qty: Math.abs(fix), hospital_delta: fix, daily_date: date, memo: '마감 전 재고 고침 · 마감재고', by: user }));
          if (use > 0) dS.push(rowOnly({ ...dItem, hospital_stock: round(dItem.hospital_stock + fix) }, { date, kind: 'out', qty: use, hospital_delta: -use, daily_date: date, memo: '일일 마감 소모 · 마감재고', by: user }));
          if (!fix && !(use > 0)) dS.push(rowOnly(dItem, { date, kind: 'adjust', qty: 0, hospital_delta: 0, daily_date: date, memo: '일일 마감재고 확인', by: user }));
        }
        if (op === undefined && qty > 0) dS.push(rowOnly(dItem, { date, kind: 'out', qty, hospital_delta: -qty, daily_date: date, memo: counted ? '일일 마감 소모 · 마감재고' : '일일 마감 소모', by: user }));
        if (op === undefined && qty < 0) dS.push(rowOnly(dItem, { date, kind: 'adjust', qty: -qty, hospital_delta: -qty, daily_date: date, memo: '일일 마감재고 확인', by: user }));
        // 센 수량이 장부와 같아 바뀐 게 없어도 '이 날 셌음' 표시를 남긴다(0 기록, 입출고 내역에는 안 보임) — 앞 날짜를 고칠 때 이 날 수량을 지키는 기준
        if (op === undefined && qty === 0 && (counted || item.daily_mode === 'count')) dS.push(rowOnly(dItem, { date, kind: 'adjust', qty: 0, hospital_delta: 0, daily_date: date, memo: '일일 마감재고 확인', by: user }));
        // 앞 날짜를 나중에 적거나 고쳐도, 그 뒤 날짜에 이미 센 마감재고는 그대로(2026-11-09 점검): 바로 다음 '센 날'의 기록을 같은 양만큼 반대로 고친다.
        const lS = [];
        if (change) {
          // 확정된 실사 날 = 마감재고 품목은 모든 일일재고 날(예전 앱 기록 포함), 사용량 품목은 마감재고로 적은 날(메모 '마감재고')
          const next = await one(db, `SELECT daily_date AS d FROM inv_tx WHERE deleted_at IS NULL AND item_id = ? AND daily_date > ? AND kind IN ('out', 'adjust') AND (memo LIKE '%마감재고%' OR ? = 'count') ORDER BY daily_date LIMIT 1`, item.id, date, item.daily_mode || '');
          if (next) {
            const rows = await all(db, `SELECT * FROM inv_tx WHERE deleted_at IS NULL AND item_id = ? AND daily_date = ? AND kind IN ('out', 'adjust')`, item.id, next.d);
            const lNet = round(rows.reduce((a, t) => a + t.hospital_delta, 0));
            const net = round(lNet - change);
            for (const t of rows) lS.push(db.prepare('UPDATE inv_tx SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(Date.now(), user, t.id));
            lS.push(db.prepare('UPDATE inv_items SET hospital_stock = round(hospital_stock - ?, 3), updated_at = ? WHERE id = ?').bind(change, Date.now(), item.id));
            const lItem = { ...item, hospital_stock: round(start - lNet) };
            if (net < 0) lS.push(rowOnly(lItem, { date: next.d, kind: 'out', qty: -net, hospital_delta: net, daily_date: next.d, memo: '일일 마감 소모 · 마감재고', by: user }));
            else lS.push(rowOnly(lItem, { date: next.d, kind: 'adjust', qty: net, hospital_delta: net, daily_date: next.d, memo: '일일 마감재고 확인', by: user }));
          }
        }
        // 재고가 줄어드는 쪽을 나중에(중간에 0 밑으로 내려가지 않게)
        stmts.push(...(change < 0 ? [...lS, ...dS] : [...dS, ...lS]));
        item = { ...item, hospital_stock: round(start + change - (lS.length ? change : 0)) };
        if (qty || back || counted) logUsed[item.name] = { used: qty, before: round(back), unit: item.stock_unit, ...(counted ? { left: num(Object.fromEntries(closing)[id]) } : {}) };
      }
      // 저장할 때마다 기록을 하나 더 남긴다(덮어쓰지 않음): 기록 기준일·작성자·작성일시·그때 적은 숫자(수정 전후 비교)
      stmts.push(db.prepare('INSERT INTO inv_daily_log (date, data, created_by, created_at) VALUES (?,?,?,?)')
        .bind(date, JSON.stringify({ patients, memo: body.status || null, items: logUsed }), user, Date.now()));
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
    if (String(e?.message || e).includes('INV_NEGATIVE')) return bad('재고가 0보다 적어질 수 없어요. 먼저 재고를 확인해 주세요.', 409);
    if (/UNIQUE.*inv_requests/i.test(String(e?.message || e))) return bad('다른 기기에서 같은 주문을 방금 받았어요. 새로고침해 주세요.', 409);
    return json({ error: '재고 자료를 처리하지 못했어요.', detail: String(e?.message || e).slice(0, 300) }, 500);
  }
}

async function monthReport(db, month, brief = false) {
  const from = `${month}-01`, to = `${month}-31`;
  const spend = await one(db, `SELECT
      coalesce(sum(CASE WHEN kind = 'in' THEN amount END), 0) AS general,
      coalesce(sum(CASE WHEN kind = 'prepaid_buy' THEN amount END), 0) AS prepaid,
      sum(CASE WHEN kind IN ('in','prepaid_in') THEN 1 ELSE 0 END) AS in_count,
      sum(CASE WHEN kind IN ('in','prepaid_buy') AND amount > 0 AND invoice = 0 AND NOT EXISTS (SELECT 1 FROM inv_invoice_links l WHERE l.tx_id = inv_tx.id) THEN 1 ELSE 0 END) AS no_invoice,
      sum(CASE WHEN kind = 'in' AND amount IS NULL THEN 1 ELSE 0 END) AS no_amount
    FROM inv_tx WHERE deleted_at IS NULL AND date BETWEEN ? AND ?`, from, to);
  const days = await one(db, `SELECT coalesce(sum(patients), 0) AS patients, sum(CASE WHEN patients > 0 THEN 1 ELSE 0 END) AS open_days, count(*) AS record_days FROM inv_daily WHERE date BETWEEN ? AND ?`, from, to);
  const usage = await all(db, `SELECT i.id, i.name, i.stock_unit, sum(t.qty) AS used FROM inv_tx t JOIN inv_items i ON i.id = t.item_id
    WHERE t.deleted_at IS NULL AND t.kind = 'out' AND t.date BETWEEN ? AND ? GROUP BY i.id ORDER BY i.sort, i.id`, from, to);
  // 영업일 = 피부관리 인원이 있는 날. 인원을 안 적은 달(성과 미입력)은 일일재고를 적은 날로(사용량이 있는데 '기록 없음'으로 보이지 않게)
  const openDays = days.open_days || days.record_days || 0;
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

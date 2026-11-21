import { BOOK_SCHEMA } from './staffBook.js';
import { BAL_SCHEMA } from './invBalance.js';
import { VENDOR_BASE, ITEMS, EXTRA_ITEMS } from './invMaster.js';
import { moveTxDate, keepCountStmts } from './invTxDate.js';
import { OLD_AFTER_PLAN } from './invDailyFix.js';
// 예전 재고관리 앱의 직원 표 구조(마이그레이션 0009·0010·0014·0022) — tests/fixtures/inv-staff.sql 에서 만든 것.
// 빈 데이터베이스에 직원 표가 없을 때 한 번만 실행한다.
const INV_STAFF_SCHEMA = [
 "CREATE TABLE IF NOT EXISTS staff (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL,\n  position TEXT DEFAULT '직원',         \n  is_leader INTEGER DEFAULT 0,          \n  hire_date TEXT,                       \n  retire_date TEXT,                     \n  status TEXT DEFAULT 'active',         \n  total_leave INTEGER DEFAULT 0,        \n  used_leave INTEGER DEFAULT 0,         \n  second_shift_count INTEGER DEFAULT 0, \n  memo TEXT,                            \n  sort_order INTEGER DEFAULT 0,         \n  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP\n)",
 "CREATE TABLE IF NOT EXISTS staff_attendance (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  staff_id INTEGER NOT NULL,\n  work_date TEXT NOT NULL,              \n  attendance TEXT NOT NULL,             \n  etc_type TEXT,                        \n  etc_detail TEXT,                      \n  start_time TEXT,                      \n  end_time TEXT,                        \n  work_minutes INTEGER,                 \n  manual_adjust INTEGER DEFAULT 0,      \n  adjust_reason TEXT,                   \n  managed_count INTEGER,                \n  designated_count INTEGER,             \n  memo TEXT,                            \n  editor TEXT DEFAULT '관리자',         \n  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n  UNIQUE(staff_id, work_date),\n  FOREIGN KEY (staff_id) REFERENCES staff(id)\n)",
 "CREATE TABLE IF NOT EXISTS staff_day_status (\n  work_date TEXT PRIMARY KEY,           \n  status TEXT NOT NULL,                 \n  memo TEXT,\n  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP\n)",
 "CREATE TABLE IF NOT EXISTS staff_leave_log (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  staff_id INTEGER NOT NULL,\n  log_type TEXT NOT NULL,\n  log_date TEXT,                        \n  amount INTEGER,                       \n  before_total INTEGER,                 \n  after_total INTEGER,                  \n  before_used INTEGER,                  \n  after_used INTEGER,                   \n  after_remain INTEGER,                 \n  reason TEXT,                          \n  memo TEXT,\n  editor TEXT DEFAULT '관리자',         \n  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n  FOREIGN KEY (staff_id) REFERENCES staff(id)\n)",
 "CREATE TABLE IF NOT EXISTS staff_info_log (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  staff_id INTEGER NOT NULL,\n  changes TEXT,                         \n  editor TEXT DEFAULT '관리자',\n  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n  FOREIGN KEY (staff_id) REFERENCES staff(id)\n)",
 "CREATE INDEX IF NOT EXISTS idx_att_staff_date ON staff_attendance(staff_id, work_date)",
 "CREATE INDEX IF NOT EXISTS idx_att_date ON staff_attendance(work_date)",
 "CREATE INDEX IF NOT EXISTS idx_leave_staff ON staff_leave_log(staff_id)",
 "CREATE INDEX IF NOT EXISTS idx_info_staff ON staff_info_log(staff_id)",
 "INSERT OR IGNORE INTO staff (id, name, position, is_leader, hire_date, status, total_leave, used_leave, second_shift_count) VALUES\n  (1, '김유리', '팀장', 1, '2018-03-02', 'active', 15, 0, 0),\n  (2, '최윤희', '직원', 0, '2020-06-01', 'active', 15, 0, 0),\n  (3, '최지혜', '직원', 0, '2021-09-13', 'active', 15, 0, 0),\n  (4, '안이람', '직원', 0, '2023-04-10', 'active', 15, 0, 0),\n  (5, '차혜진', '직원', 0, '2024-11-05', 'active', 15, 0, 0)",
 "ALTER TABLE staff ADD COLUMN staff_type TEXT DEFAULT 'regular'",
 "ALTER TABLE staff ADD COLUMN is_demo INTEGER DEFAULT 0",
 "ALTER TABLE staff_attendance ADD COLUMN record_mode TEXT",
 "ALTER TABLE staff_attendance ADD COLUMN partial_start TEXT",
 "ALTER TABLE staff_attendance ADD COLUMN partial_end TEXT",
 "ALTER TABLE staff_attendance ADD COLUMN is_demo INTEGER DEFAULT 0",
 "ALTER TABLE staff_day_status ADD COLUMN is_demo INTEGER DEFAULT 0",
 "UPDATE staff_attendance\n   SET attendance='기타', etc_type='time', etc_detail='2시 출근'\n WHERE attendance='2출'",
 "UPDATE staff_attendance\n   SET etc_type='unpaid'\n WHERE attendance='기타' AND (etc_type IS NULL OR etc_type='')",
 "UPDATE staff SET staff_type='regular' WHERE staff_type IS NULL",
 "ALTER TABLE staff ADD COLUMN personal_color TEXT",
 "UPDATE staff SET personal_color = '#EFA7B7' WHERE name = '김유리' AND (personal_color IS NULL OR personal_color = '')",
 "UPDATE staff SET personal_color = '#8FCFA9' WHERE name = '최윤희' AND (personal_color IS NULL OR personal_color = '')",
 "UPDATE staff SET personal_color = '#E6C85C' WHERE name = '최지혜' AND (personal_color IS NULL OR personal_color = '')",
 "UPDATE staff SET personal_color = '#8FB7E8' WHERE name = '안이람' AND (personal_color IS NULL OR personal_color = '')",
 "UPDATE staff SET personal_color = '#B6A4E8' WHERE name = '차혜진' AND (personal_color IS NULL OR personal_color = '')",
 "CREATE TABLE IF NOT EXISTS consult_team_managed (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  work_date TEXT NOT NULL,           \n  team_managed INTEGER,              \n  editor TEXT,                       \n  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,\n  UNIQUE(work_date)\n)",
 "CREATE INDEX IF NOT EXISTS idx_consult_team_managed_date ON consult_team_managed(work_date)"
];

// 거래명세서 사진(2026-11-09): 사진 한 장을 여러 입고 기록에 걸 수 있다(같은 날 한 종이에 여러 건).
const INV_INVOICE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS inv_invoices (id INTEGER PRIMARY KEY, object_key TEXT NOT NULL, mime TEXT, size INTEGER, created_by TEXT, created_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS inv_invoice_links (invoice_id INTEGER NOT NULL, tx_id INTEGER NOT NULL, PRIMARY KEY (invoice_id, tx_id))`,
  `CREATE INDEX IF NOT EXISTS inv_invoice_links_tx ON inv_invoice_links(tx_id)`,
];

// 2026-11-09 사용자 문서(재고관리 최종 수정 1~23): 같은 요청을 두 번 받아도 한 번만 반영(inv_requests),
// 일일재고 저장마다 기록을 남김(inv_daily_log: 기록 기준일·작성자·작성일시, 수정 전후 보존),
// 재고가 0보다 적어지는 변경은 DB가 막음(이미 마이너스인 값은 더 줄어들 때만 막음 — 기존 기록은 건드리지 않음).
const INV_GUARD_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS inv_requests (id TEXT PRIMARY KEY, path TEXT, response TEXT, created_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS inv_daily_log (id INTEGER PRIMARY KEY, date TEXT NOT NULL, data TEXT, created_by TEXT, created_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS inv_daily_log_date ON inv_daily_log(date)`,
  `CREATE TRIGGER IF NOT EXISTS inv_items_no_negative BEFORE UPDATE OF hospital_stock, vendor_stock ON inv_items
     WHEN (NEW.hospital_stock < -0.0005 AND NEW.hospital_stock < OLD.hospital_stock) OR (NEW.vendor_stock < -0.0005 AND NEW.vendor_stock < OLD.vendor_stock)
     BEGIN SELECT RAISE(ABORT, 'INV_NEGATIVE'); END`,
];

// 재고 표(2026-11-08 새로 설계). 기록(inv_tx)마다 병원재고·업체 보관 잔량 증감을 저장해 삭제 때 정확히 되돌린다.
const INV_STOCK_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS inv_vendors (id INTEGER PRIMARY KEY, name TEXT NOT NULL, company TEXT, category TEXT, manager TEXT, payment_method TEXT, contact TEXT, bank TEXT, account TEXT, holder TEXT, memo TEXT, sort INTEGER DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, pay_timing TEXT)`,
  `CREATE TABLE IF NOT EXISTS inv_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, vendor_id INTEGER, category TEXT, stock_unit TEXT NOT NULL DEFAULT 'ea', order_unit TEXT, pack_qty REAL, price REAL, min_stock REAL DEFAULT 0,
     hospital_stock REAL NOT NULL DEFAULT 0, vendor_stock REAL NOT NULL DEFAULT 0, daily_mode TEXT, prepaid INTEGER NOT NULL DEFAULT 0, is_pack INTEGER NOT NULL DEFAULT 0, memo TEXT, sort INTEGER DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER, updated_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS inv_options (id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL, label TEXT, qty REAL NOT NULL, bonus_qty REAL NOT NULL DEFAULT 0, amount REAL, prepaid INTEGER NOT NULL DEFAULT 0, unit_label TEXT, sort INTEGER DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER, start_date TEXT, end_date TEXT)`,
  `CREATE TABLE IF NOT EXISTS inv_orders (id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL, option_id INTEGER, option_label TEXT, ordered_at TEXT NOT NULL, qty REAL NOT NULL, bonus_qty REAL NOT NULL DEFAULT 0, amount REAL, prepaid INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, received_at TEXT, memo TEXT, created_by TEXT, created_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS inv_tx (id INTEGER PRIMARY KEY, date TEXT NOT NULL, kind TEXT NOT NULL, item_id INTEGER NOT NULL, qty REAL NOT NULL, bonus_qty REAL NOT NULL DEFAULT 0, amount REAL,
     hospital_delta REAL NOT NULL DEFAULT 0, vendor_delta REAL NOT NULL DEFAULT 0, hospital_after REAL, vendor_after REAL, order_id INTEGER, daily_date TEXT, invoice INTEGER NOT NULL DEFAULT 0, memo TEXT, source TEXT, created_by TEXT, created_at INTEGER, deleted_at INTEGER, deleted_by TEXT)`,
  `CREATE INDEX IF NOT EXISTS inv_tx_date ON inv_tx(date)`,
  `CREATE INDEX IF NOT EXISTS inv_tx_daily ON inv_tx(daily_date, item_id)`,
  `CREATE INDEX IF NOT EXISTS inv_tx_item_date ON inv_tx(item_id, date, id)`, // 2026-11-21 D1 하루 읽기 한도: 품목별 '그 날 뒤 증감' 계산이 표 전체를 읽던 것
  `CREATE INDEX IF NOT EXISTS inv_tx_order ON inv_tx(order_id)`,
  `CREATE INDEX IF NOT EXISTS inv_orders_item ON inv_orders(item_id)`,
  `CREATE INDEX IF NOT EXISTS inv_tx_kind ON inv_tx(kind, item_id)`,
  `CREATE TABLE IF NOT EXISTS inv_daily (date TEXT PRIMARY KEY, patients INTEGER, status TEXT, extra TEXT, updated_by TEXT, updated_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS inv_meta (key TEXT PRIMARY KEY, value TEXT)`,
  ...INV_INVOICE_SCHEMA,
];


export const INV_TABLES = ['staff', 'staff_attendance', 'staff_day_status', 'staff_leave_log', 'staff_info_log', 'inv_vendors', 'inv_items', 'inv_options', 'inv_orders', 'inv_tx', 'inv_daily'];
const one = sql => sql.replace(/\s*--[^\n]*/g, '').replace(/\s+/g, ' ').trim().replace(/;?$/, ';');
const lit = v => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

// 표 만들기 + 공개해도 되는 기준 자료(거래처 이름·확정 가격표). D1 exec는 줄마다 문장 하나.
export function schemaSql(now = Date.now()) {
  const lines = INV_TABLES.map(t => `DROP TABLE IF EXISTS ${t};`);
  for (const s of [...INV_STAFF_SCHEMA, ...INV_STOCK_SCHEMA]) lines.push(one(s));
  VENDOR_BASE.forEach(([id, name, company, category, pay], i) => lines.push(`INSERT INTO inv_vendors (id, name, company, category, payment_method, sort) VALUES (${[id, name, company, category, pay, i].map(lit).join(',')});`));
  ITEMS.forEach(([id, name, vendor, cat, unit, ounit, pack, price, min, daily, prepaid, isPack, options, memo], i) => {
    lines.push(`INSERT INTO inv_items (id, name, vendor_id, category, stock_unit, order_unit, pack_qty, price, min_stock, daily_mode, prepaid, is_pack, memo, sort, created_at, updated_at) VALUES (${[id, name, vendor, cat, unit, ounit, pack, price, min, daily, prepaid, isPack, memo, i, now, now].map(lit).join(',')});`);
    options.forEach((o, k) => lines.push(`INSERT INTO inv_options (item_id, label, qty, bonus_qty, amount, prepaid, sort, created_at) VALUES (${[id, o.label, o.qty, o.bonus_qty || 0, o.amount ?? null, o.prepaid ? 1 : 0, k, now].map(lit).join(',')});`));
  });
  EXTRA_ITEMS.forEach(([id, name, vendor, cat, unit], i) => lines.push(`INSERT INTO inv_items (id, name, vendor_id, category, stock_unit, order_unit, pack_qty, price, min_stock, memo, sort, created_at, updated_at) VALUES (${[id, name, vendor, cat, unit, unit, 1, null, 0, '단가 미확인', 500 + i, now, now].map(lit).join(',')});`));
  lines.push(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('schema', '${new Date(now).toISOString()}');`);
  return lines.join('\n');
}

let ready = null;
// 처음 한 번: 표와 기준 자료를 만든다. 예전 앱 숫자(직원 근태·재고 기록)는 '예전 자료 넣기'(파일)로 들어온다
// — 직원 근태 같은 개인 자료를 공개 저장소에 넣지 않기 위해.
export async function ensureInvSchema(db) {
  if (ready === db) return;
  // 표를 새로 만드는 것은 처음 한 번뿐(표가 정말 없거나 schema 기록이 없을 때만). 잠깐 DB가 응답을 못 한 경우까지 새로 만들면 모든 기록이 지워지므로 그때는 오류로 멈춘다.
  let missing = false;
  try { missing = !(await db.prepare(`SELECT value FROM inv_meta WHERE key = 'schema'`).first()); }
  catch (e) { if (/no such table/i.test(String(e?.message || e))) missing = true; else throw e; }
  if (missing) await db.exec(schemaSql());
  {
    // 기준 자료 고침을 한 번씩 적용(새 DB도 같은 길로 — 트리거는 exec 한 줄에 못 넣어서 여기서 만든다)
    let fixes = (await db.prepare(`SELECT value FROM inv_meta WHERE key = 'fixes'`).first())?.value || '';
    if (!fixes.includes('txmeta1')) {
      // 2026-11-11 사용자: 수정 과정 전부가 아니라 최종 수정일·수정자만, 입고 취소는 지우지 않고 취소 상태로(날짜·사유·작업자)
      for (const col of ['updated_at INTEGER', 'updated_by TEXT', 'cancelled_at INTEGER', 'cancelled_by TEXT', 'cancel_reason TEXT']) {
        try { await db.prepare(`ALTER TABLE inv_tx ADD COLUMN ${col}`).run(); } catch (e) { if (!/duplicate column/i.test(String(e?.message || e))) throw e; }
      }
      await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} txmeta1`.trim()).run();
      fixes = `${fixes} txmeta1`.trim();
    }
    if (!fixes.includes('invoice1')) {
      // 이미 쓰던 DB에 명세서 사진 표만 더함(기존 자료는 그대로)
      await db.batch([...INV_INVOICE_SCHEMA.map(q => db.prepare(q)), db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} invoice1`.trim())]);
      fixes = `${fixes} invoice1`.trim();
    }
    if (!fixes.includes('opt300')) {
      await db.batch([
        db.prepare(`UPDATE inv_options SET amount = 450000 WHERE item_id = 1010 AND qty = 300 AND prepaid = 1 AND amount = 360000`),
        db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} opt300`.trim()),
      ]);
      fixes = `${fixes} opt300`.trim();
    }
    if (!fixes.includes('guard1')) {
      for (const q of INV_GUARD_SCHEMA) await db.prepare(q).run(); // 모두 IF NOT EXISTS라 중간에 끊겨도 다시 해도 됨
      await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} guard1`.trim()).run();
      fixes = `${fixes} guard1`.trim();
    }
    if (!fixes.includes('negfix1')) {
      // 2026-11-09 사용자 '일단 고쳐줘': 결제 기록이 지워져 업체 보관 잔량이 마이너스가 된 품목(보관용 3종 시트팩 −300)을 한 번 바로잡는다.
      // 지운 선결제 구매 기록 중 그 마이너스를 정확히 메우는 것이 있으면 되살리고(지출도 돌아옴), 없으면 잔량만 0으로 맞추는 기록을 남긴다.
      const neg = (await db.prepare('SELECT id, vendor_stock, hospital_stock FROM inv_items WHERE vendor_stock < -0.0005').all()).results || [];
      for (const it of neg) {
        const gap = Math.round(-it.vendor_stock * 1000) / 1000;
        const del = await db.prepare(`SELECT id FROM inv_tx WHERE item_id = ? AND kind = 'prepaid_buy' AND deleted_at IS NOT NULL AND abs(vendor_delta - ?) < 0.0005 ORDER BY deleted_at DESC LIMIT 1`).bind(it.id, gap).first();
        if (del) await db.batch([
          db.prepare('UPDATE inv_tx SET deleted_at = NULL, deleted_by = NULL, memo = trim(coalesce(memo, \'\') || \' (지운 기록 되살림)\') WHERE id = ?').bind(del.id),
          db.prepare('UPDATE inv_items SET vendor_stock = 0, updated_at = ? WHERE id = ?').bind(Date.now(), it.id),
        ]);
        else await db.batch([
          db.prepare(`INSERT INTO inv_tx (date, kind, item_id, qty, bonus_qty, amount, hospital_delta, vendor_delta, hospital_after, vendor_after, memo, created_by, created_at)
            VALUES (date('now', '+9 hours'), 'adjust', ?, ?, 0, NULL, 0, ?, ?, 0, '업체 보관 잔량 고치기', 'system', ?)`).bind(it.id, gap, gap, it.hospital_stock, Date.now()),
          db.prepare('UPDATE inv_items SET vendor_stock = 0, updated_at = ? WHERE id = ?').bind(Date.now(), it.id),
        ]);
      }
      await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} negfix1`.trim()).run();
      fixes = `${fixes} negfix1`.trim();
    }
    if (!fixes.includes('datefix1')) {
      // 2026-11-10 사용자 '너가 해줘': 11/6에 들어온 보관용 3종 시트팩 300장이 11/9로 입고확정돼 11/6 실사(290)와 두 번 더해진 것(590)을 한 번 바로잡는다.
      // 정확히 그 기록(11/9 선결제 입고 +300)이 있고 11/6에 센 기록이 있을 때만 날짜를 11/6으로 옮긴다(화면 '기록 수정'과 같은 계산).
      const tx = await db.prepare(`SELECT t.* FROM inv_tx t JOIN inv_items i ON i.id = t.item_id WHERE i.name = '보관용 3종 시트팩' AND t.kind = 'prepaid_in' AND t.date = '2026-11-09'
        AND t.deleted_at IS NULL AND abs(t.hospital_delta - 300) < 0.0005 ORDER BY t.id LIMIT 1`).first();
      const counted = tx ? await db.prepare(`SELECT 1 AS ok FROM inv_tx WHERE deleted_at IS NULL AND item_id = ? AND daily_date = '2026-11-06' LIMIT 1`).bind(tx.item_id).first() : null;
      if (tx && counted) await moveTxDate(db, tx, '2026-11-06', 'system');
      await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} datefix1`.trim()).run();
      fixes = `${fixes} datefix1`.trim();
    }
    if (!fixes.includes('datefix2')) {
      // 2026-11-10 밤 사용자 '11/6에 300장이 자동으로 들어오게, 이중으로 들어오지 않게': 11월의 보관용 3종 시트팩 선결제 입고 300장이
      // 딱 한 줄일 때만, 11/6이 아니면 11/6으로 옮긴다(이미 11/6이면 그대로, 두 줄 이상이면 손대지 않음). 새로 만들지는 않는다.
      const rows = (await db.prepare(`SELECT t.* FROM inv_tx t JOIN inv_items i ON i.id = t.item_id WHERE i.name = '보관용 3종 시트팩' AND t.kind = 'prepaid_in'
        AND t.deleted_at IS NULL AND t.date BETWEEN '2026-11-01' AND '2026-11-30' AND abs(t.hospital_delta - 300) < 0.0005`).all()).results || [];
      if (rows.length === 1 && rows[0].date !== '2026-11-06') await moveTxDate(db, rows[0], '2026-11-06', 'system');
      await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} datefix2`.trim()).run();
      fixes = `${fixes} datefix2`.trim();
    }
    if (!fixes.includes('aladdin1')) {
      // 2026-11-11 사용자: 알라딘 필링 단가(파우더 979,000 · 수딩 44,000 · 액티베이터 165,000), 카드결제·계좌입금 둘 다 가능.
      // 단가가 아직 비어 있을 때만 넣고(앱에서 고친 값은 그대로), 구매조건이 없으면 '주문단위 1개 = 단가' 하나. 계좌 정보는 공개 저장소라 코드에 넣지 않음(앱에서 입력).
      const now = Date.now();
      for (const [id, price] of [[1030, 979000], [1031, 44000], [1029, 165000]]) {
        const it = await db.prepare('SELECT * FROM inv_items WHERE id = ?').bind(id).first();
        if (!it || it.price != null) continue;
        await db.prepare('UPDATE inv_items SET price = ?, memo = NULL, updated_at = ? WHERE id = ?').bind(price, now, id).run();
        if (!(await db.prepare('SELECT id FROM inv_options WHERE item_id = ? AND active = 1').bind(id).first())) {
          const pack = it.pack_qty || 1;
          await db.prepare('INSERT INTO inv_options (item_id, label, qty, bonus_qty, amount, prepaid, sort, created_at) VALUES (?,?,?,0,?,0,0,?)')
            .bind(id, `1${it.order_unit || it.stock_unit}${pack !== 1 ? `(${pack}${it.stock_unit})` : ''}`, pack, price, now).run();
        }
      }
      await db.prepare(`UPDATE inv_vendors SET payment_method = '카드결제·계좌입금' WHERE id = 7 AND (payment_method IS NULL OR payment_method IN ('홈페이지결제', '온라인결제'))`).run();
      await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} aladdin1`.trim()).run();
      fixes = `${fixes} aladdin1`.trim();
    }
    if (!fixes.includes('aladdin2')) {
      // 2026-11-13 사용자 '담부터는 알라딘 필링 액티베이터 주문할 때 169,000원': 아직 165,000원 그대로인 단가·구매조건만 169,000원으로(앱에서 이미 바꾼 값은 그대로, 지난 주문·입고 기록 금액은 손대지 않음)
      await db.batch([
        db.prepare('UPDATE inv_items SET price = 169000, updated_at = ? WHERE id = 1029 AND price = 165000').bind(Date.now()),
        db.prepare('UPDATE inv_options SET amount = 169000 WHERE item_id = 1029 AND active = 1 AND amount = 165000'),
        db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} aladdin2`.trim()),
      ]);
      fixes = `${fixes} aladdin2`.trim();
    }
    if (!fixes.includes('paytime1')) {
      // 2026-11-12 사용자: 업체마다 결제 시점(주문 시 결제 / 월말 결제)을 저장, 옵션(구매조건·선결제 옵션)에 행사 기간(시작~끝, 비우면 늘).
      // 사용자가 정해 준 업체만 넣고(주문 시: 더마소드·쎄라덤·중외·알라딘 필링·카프리가스·스키노바·상떼화장품·바이더퀄리티 / 월말: 하라셀),
      // 아직 안 정한 업체(피부미소·히스토랩·셀퓨전씨·에스트라·닥터슈라클·쿠팡·간호팀)는 비워 둠 = '결제 시점 미정'(앱 '업체 정보'에서 고름).
      for (const [t, col] of [['inv_vendors', 'pay_timing TEXT'], ['inv_options', 'start_date TEXT'], ['inv_options', 'end_date TEXT']]) {
        try { await db.prepare(`ALTER TABLE ${t} ADD COLUMN ${col}`).run(); } catch (e) { if (!/duplicate column/i.test(String(e?.message || e))) throw e; }
      }
      await db.batch([
        db.prepare(`UPDATE inv_vendors SET pay_timing = 'order' WHERE pay_timing IS NULL AND ((id = 1 AND name = '더마소드') OR (id = 2 AND name = '쎄라덤') OR (id = 3 AND name = '중외') OR (id = 7 AND name = '알라딘 필링')
          OR (id = 8 AND name = '카프리가스') OR (id = 14 AND name = '스키노바') OR (id = 15 AND name = '상떼화장품') OR (id = 16 AND name = '바이더퀄리티'))`),
        db.prepare(`UPDATE inv_vendors SET pay_timing = 'month' WHERE pay_timing IS NULL AND id = 4 AND name = '하라셀'`),
        db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} paytime1`.trim()),
      ]);
      fixes = `${fixes} paytime1`.trim();
    }
    if (!fixes.includes('splitfix1')) {
      // 2026-11-11 사용자 '10/22로 해줘': 예전 앱에서 '받기 목록: 절단솜 4×6 외 3건(4개 품목)' 수량 0 · 67,500원 한 줄로 옮겨진 10/22 피부미소 입고를
      // 사용자가 보낸 거래명세서(일회용해면 60·거즈 2·절단솜 4x6 5·비절단솜 4x30 1, 합계 334,000원)대로 품목마다 따로 10/22 입고로 나눈다.
      // 그 뒤 일일재고로 센 날이 있으면 그 날 센 수량은 그대로(keepCountStmts). 원래 한 줄은 지운 기록으로(재고 증감 0이라 재고 영향 없음), 명세서 사진·받음은 새 줄로.
      const old = await db.prepare(`SELECT * FROM inv_tx WHERE deleted_at IS NULL AND date = '2026-10-22' AND kind = 'in' AND hospital_delta = 0 AND memo LIKE '받기 목록: 절단솜 4×6 외 3건%'`).first();
      const lines = [['일회용해면', 60, 270000], ['거즈30x35', 2, 13000], ['절단솜4x6', 5, 42500], ['비절단솜4x30', 1, 8500]];
      const items = [];
      for (const [name, qty, amount] of lines) { const it = await db.prepare('SELECT id, hospital_stock, vendor_stock FROM inv_items WHERE name = ?').bind(name).first(); if (it) items.push({ it, qty, amount }); }
      if (old && items.length === lines.length) {
        const links = (await db.prepare('SELECT invoice_id FROM inv_invoice_links WHERE tx_id = ?').bind(old.id).all()).results || [];
        const now = Date.now();
        await db.prepare('UPDATE inv_tx SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(now, 'system', old.id).run();
        for (const { it, qty, amount } of items) {
          const keep = await keepCountStmts(db, it.id, '2026-10-22', qty, 'system');
          await db.batch([
            db.prepare('UPDATE inv_items SET hospital_stock = round(hospital_stock + ?, 3), updated_at = ? WHERE id = ?').bind(qty, now, it.id),
            db.prepare(`INSERT INTO inv_tx (date, kind, item_id, qty, bonus_qty, amount, hospital_delta, vendor_delta, hospital_after, vendor_after, order_id, daily_date, invoice, memo, created_by, created_at)
              VALUES ('2026-10-22', 'in', ?, ?, 0, ?, ?, 0, ?, ?, NULL, NULL, ?, '받기 목록 · 거래명세서대로 나눔', 'system', ?)`).bind(it.id, qty, amount, qty, Math.round(((it.hospital_stock || 0) + qty) * 1000) / 1000, it.vendor_stock || 0, old.invoice ? 1 : 0, now),
            ...keep]);
          const t = await db.prepare(`SELECT max(id) AS id FROM inv_tx WHERE item_id = ? AND date = '2026-10-22' AND kind = 'in'`).bind(it.id).first();
          if (links.length) await db.batch(links.map(l => db.prepare('INSERT OR IGNORE INTO inv_invoice_links (invoice_id, tx_id) VALUES (?, ?)').bind(l.invoice_id, t.id)));
        }
      }
      await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} splitfix1`.trim()).run();
      fixes = `${fixes} splitfix1`.trim();
    }
    if (!fixes.includes('paytime2')) {
      // 2026-11-12 사용자: 피부미소는 월말 결제(보고서 시안에서 결제 예정으로 지정). 앱에서 이미 고른 값은 그대로.
      await db.batch([
        db.prepare(`UPDATE inv_vendors SET pay_timing = 'month' WHERE id = 5 AND name = '피부미소' AND pay_timing IS NULL`),
        db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} paytime2`.trim()),
      ]);
      fixes = `${fixes} paytime2`.trim();
    }
    if (!fixes.includes('stopvend1')) {
      // 2026-11-12 사용자 '이건 우리가 주문 안 해, 필요 없어': 간호팀·셀퓨전씨·에스트라·쿠팡을 거래 중단(보고서·새 주문 목록에서 빠짐, 품목·기록은 그대로, 앱 '업체 정보'에서 재개 가능)
      await db.batch([
        db.prepare(`UPDATE inv_vendors SET active = 0 WHERE (id = 9 AND name = '간호팀') OR (id = 10 AND name = '셀퓨전씨') OR (id = 11 AND name = '에스트라') OR (id = 13 AND name = '쿠팡')`),
        db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} stopvend1`.trim()),
      ]);
      fixes = `${fixes} stopvend1`.trim();
    }
    if (!fixes.includes('book1')) {
      // 2026-11-13 일일 예약표: 표만 더함(기존 자료는 그대로)
      for (const q of BOOK_SCHEMA) await db.prepare(q).run(); // 표 다음에 색인(차례로)
      await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} book1`.trim()).run();
      fixes = `${fixes} book1`.trim();
    }
    if (!fixes.includes('vbal1')) {
      // 2026-11-19 업체 잔액(금액): 표만 더함(기존 자료는 그대로)
      for (const q of BAL_SCHEMA) await db.prepare(q).run();
      await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} vbal1`.trim()).run();
      fixes = `${fixes} vbal1`.trim();
    }
    if (!fixes.includes('jwbal2') && await db.prepare(`SELECT 1 FROM inv_meta WHERE key = 'import'`).first() && await claimFix(db, 'jwbal2')) {
      // 2026-11-19 사용자(jwbal1 대신): 중외 잔액은 '2025-10-30 중복 결제 347,994원'만 등록하고, 5월 구매(중화제 3개)를 기록해 그 잔액으로 차감.
      // 5월 것은 다 써서 병원재고는 늘리지 않음(입고 기록 증감 0). 11월 구매·명세서는 사용자가 직접 넣음. GA20%는 사지 않아 jwbal1의 11/12 GA20% 차감은 지움.
      try {
        const now = Date.now();
        await db.prepare(`UPDATE inv_vendor_bal SET deleted_at = ?, deleted_by = 'system' WHERE vendor_id = 3 AND created_by = 'system' AND deleted_at IS NULL`).bind(now).run();
        const v = await db.prepare(`SELECT id FROM inv_vendors WHERE id = 3 AND name = '중외'`).first();
        const it = v && await db.prepare(`SELECT * FROM inv_items WHERE vendor_id = 3 AND name = '중화제'`).first();
        const has = v && await db.prepare(`SELECT 1 FROM inv_vendor_bal WHERE vendor_id = 3 AND deleted_at IS NULL`).first();
        if (v && !has) {
          const stmts = [db.prepare(`INSERT INTO inv_vendor_bal (vendor_id, date, kind, amount, reason, memo, created_by, created_at) VALUES (3, '2025-10-30', 'add', 347994, '중복 결제', '2025-09-01 매출 347,994원을 10/1·10/30 두 번 결제(거래처별 거래원장)', 'system', ?)`).bind(now)];
          const may = it && await db.prepare(`SELECT 1 FROM inv_orders WHERE item_id = ? AND ordered_at = '2026-05-06'`).bind(it.id).first();
          if (it && !may) {
            const memo = '5월 구매 · 다 사용해서 병원재고 추가 안 함';
            stmts.push(
              db.prepare(`INSERT INTO inv_orders (item_id, option_id, option_label, ordered_at, qty, bonus_qty, amount, prepaid, status, received_at, memo, created_by, created_at) VALUES (?, NULL, '3개', '2026-05-06', 3, 0, 54543, 0, 'received', '2026-05-06', ?, 'system', ?)`).bind(it.id, memo, now),
              db.prepare(`INSERT INTO inv_tx (date, kind, item_id, qty, bonus_qty, amount, hospital_delta, vendor_delta, hospital_after, vendor_after, order_id, daily_date, invoice, memo, created_by, created_at)
                VALUES ('2026-05-06', 'in', ?, 3, 0, 54543, 0, 0, ?, ?, (SELECT max(id) FROM inv_orders), NULL, 0, ?, 'system', ?)`).bind(it.id, it.hospital_stock || 0, it.vendor_stock || 0, memo, now),
              db.prepare(`INSERT INTO inv_vendor_bal (vendor_id, date, kind, amount, reason, order_id, created_by, created_at) VALUES (3, '2026-05-06', 'use', 59997, '주문', (SELECT max(id) FROM inv_orders), 'system', ?)`).bind(now));
          }
          await db.batch(stmts);
        }
        await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} jwbal2`.trim()).run();
        fixes = `${fixes} jwbal2`.trim();
      } catch (e) { console.error('jwbal2', e); }
    }
    if (!fixes.includes('jwvat1') && await claimFix(db, 'jwvat1')) {
      // 2026-11-20 사용자 '차감을 부가세 포함으로 맞춰줘': 주문 금액 그대로 뺀 차감을 주문 금액 × 1.1로(남은 금액이 0보다 적어지지 않는 만큼만). 등록·환급은 그대로.
      try {
        const rows = (await db.prepare(`SELECT b.id, b.vendor_id, b.amount, o.amount AS oa FROM inv_vendor_bal b JOIN inv_orders o ON o.id = b.order_id
          WHERE b.kind = 'use' AND b.deleted_at IS NULL AND o.status <> 'cancelled' AND round(b.amount) = round(o.amount) ORDER BY b.date, b.id`).all()).results || [];
        const left = new Map();
        for (const r of rows) {
          if (!left.has(r.vendor_id)) left.set(r.vendor_id, Math.round((await db.prepare(`SELECT coalesce(sum(CASE kind WHEN 'add' THEN amount ELSE -amount END), 0) AS b FROM inv_vendor_bal WHERE vendor_id = ? AND deleted_at IS NULL`).bind(r.vendor_id).first())?.b || 0));
          const add = Math.max(0, Math.min(Math.round(r.oa * 1.1) - Math.round(r.amount), left.get(r.vendor_id)));
          if (!add) continue;
          await db.prepare(`UPDATE inv_vendor_bal SET amount = ?, updated_by = 'system', updated_at = ? WHERE id = ?`).bind(Math.round(r.amount) + add, Date.now(), r.id).run();
          left.set(r.vendor_id, left.get(r.vendor_id) - add);
        }
        await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} jwvat1`.trim()).run();
        fixes = `${fixes} jwvat1`.trim();
      } catch (e) { console.error('jwvat1', e); }
    }
    if (!fixes.includes('jwnov1') && fixes.includes('jwvat1') && await db.prepare(`SELECT 1 FROM inv_meta WHERE key = 'import'`).first() && await claimFix(db, 'jwnov1')) {
      // 2026-11-20 사용자 '일단 수정해줘': 중외 11월 구매 = 중화제 2개 + GA30% 2개(앱 가격, 업체 계산과 같음)를 받을 주문으로 넣고 업체 잔액에서 부가세 포함 차감
      // (39,998 + 103,998) → 남은 금액 144,001원. 11월에 이 두 품목 주문이 이미 있거나 5월 말고 다른 차감이 있으면 손대지 않음.
      try {
        const its = (await db.prepare(`SELECT * FROM inv_items WHERE vendor_id = 3 AND name IN ('중화제', 'GA30%')`).all()).results || [];
        const other = await db.prepare(`SELECT 1 FROM inv_vendor_bal WHERE vendor_id = 3 AND kind = 'use' AND deleted_at IS NULL AND date <> '2026-05-06'`).first();
        const dup = await db.prepare(`SELECT 1 FROM inv_orders o JOIN inv_items i ON i.id = o.item_id WHERE i.vendor_id = 3 AND i.name IN ('중화제', 'GA30%') AND o.ordered_at >= '2026-11-01' AND o.status <> 'cancelled'`).first();
        if (its.length === 2 && !other && !dup) {
          const now = Date.now(), memo = '11월 구매 · 업체 잔액 차감';
          const stmts = [];
          for (const it of its) {
            const opt = await db.prepare(`SELECT id FROM inv_options WHERE item_id = ? ORDER BY id LIMIT 1`).bind(it.id).first();
            const amount = Math.round(Number(it.price) * 2);
            stmts.push(db.prepare(`INSERT INTO inv_orders (item_id, option_id, option_label, ordered_at, qty, bonus_qty, amount, prepaid, status, memo, created_by, created_at) VALUES (?,?,'2개','2026-11-06',2,0,?,0,'ordered',?,'system',?)`).bind(it.id, opt?.id ?? null, amount, memo, now),
              db.prepare(`INSERT INTO inv_vendor_bal (vendor_id, date, kind, amount, reason, order_id, created_by, created_at) VALUES (3, '2026-11-06', 'use', ?, '주문', (SELECT max(id) FROM inv_orders), 'system', ?)`).bind(Math.round(amount * 1.1), now));
          }
          await db.batch(stmts);
        }
        await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} jwnov1`.trim()).run();
        fixes = `${fixes} jwnov1`.trim();
      } catch (e) { console.error('jwnov1', e); }
    }
    if (!fixes.includes('jwnov2') && fixes.includes('jwnov1') && await claimFix(db, 'jwnov2')) {
      // 2026-11-20 사용자 '6일이야, 중화제·GA30% 같은 날 왔어': jwnov1 주문(11월 구매 · 업체 잔액 차감)의 주문일·차감일을 11/6으로, 받기 전이면 11/6 입고(각 2개, 병원재고 +2)로.
      // 이미 받았으면 그 입고 날짜만 11/6으로(moveTxDate). 다른 주문·기록은 손대지 않음.
      try {
        const D = '2026-11-06', now = Date.now();
        const os = (await db.prepare(`SELECT o.* FROM inv_orders o JOIN inv_items i ON i.id = o.item_id WHERE i.vendor_id = 3 AND i.name IN ('중화제', 'GA30%')
          AND o.created_by = 'system' AND o.memo = '11월 구매 · 업체 잔액 차감' AND o.status <> 'cancelled'`).all()).results || [];
        for (const o of os) {
          await db.batch([db.prepare(`UPDATE inv_orders SET ordered_at = ? WHERE id = ?`).bind(D, o.id),
            db.prepare(`UPDATE inv_vendor_bal SET date = ? WHERE order_id = ? AND kind = 'use' AND deleted_at IS NULL`).bind(D, o.id)]);
          const txs = (await db.prepare(`SELECT * FROM inv_tx WHERE order_id = ? AND kind = 'in' AND deleted_at IS NULL ORDER BY id`).bind(o.id).all()).results || [];
          if (txs.length) { for (const t of txs) await moveTxDate(db, t, D, 'system'); continue; }
          if (o.status !== 'ordered') continue;
          const it = await db.prepare(`SELECT * FROM inv_items WHERE id = ?`).bind(o.item_id).first();
          const q = Number(o.qty) || 0, keep = await keepCountStmts(db, it.id, D, q, 'system');
          await db.batch([
            db.prepare(`UPDATE inv_items SET hospital_stock = round(hospital_stock + ?, 3), updated_at = ? WHERE id = ?`).bind(q, now, it.id),
            db.prepare(`INSERT INTO inv_tx (date, kind, item_id, qty, bonus_qty, amount, hospital_delta, vendor_delta, hospital_after, vendor_after, order_id, daily_date, invoice, memo, created_by, created_at)
              VALUES (?, 'in', ?, ?, 0, ?, ?, 0, ?, ?, ?, NULL, 0, ?, 'system', ?)`).bind(D, it.id, q, o.amount, q, Math.round(((it.hospital_stock || 0) + q) * 1000) / 1000, it.vendor_stock || 0, o.id, `주문 ${q} · 도착 ${q}`, now),
            db.prepare(`UPDATE inv_orders SET status = 'received', received_at = ? WHERE id = ?`).bind(D, o.id),
            ...keep]);
        }
        await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} jwnov2`.trim()).run();
        fixes = `${fixes} jwnov2`.trim();
      } catch (e) { console.error('jwnov2', e); }
    }
    if (!fixes.includes('jwrefund1') && fixes.includes('jwnov2') && await db.prepare(`SELECT 1 FROM inv_meta WHERE key = 'import'`).first() && await claimFix(db, 'jwrefund1')) {
      // 2026-11-20 사용자 '넣어줘': 중외가 11/19 남은 잔액 144,001원을 환급 입금 → 남은 금액 0원. 남은 금액이 144,001원이고 환급 기록이 없을 때만.
      try {
        const bal = await db.prepare(`SELECT coalesce(sum(CASE kind WHEN 'add' THEN amount ELSE -amount END), 0) AS b FROM inv_vendor_bal WHERE vendor_id = 3 AND deleted_at IS NULL`).first();
        const has = await db.prepare(`SELECT 1 FROM inv_vendor_bal WHERE vendor_id = 3 AND kind = 'refund' AND deleted_at IS NULL`).first();
        if (Math.round(bal?.b || 0) === 144001 && !has)
          await db.prepare(`INSERT INTO inv_vendor_bal (vendor_id, date, kind, amount, memo, created_by, created_at) VALUES (3, '2026-11-19', 'refund', 144001, '중복 결제 남은 금액 환급', 'system', ?)`).bind(Date.now()).run();
        await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} jwrefund1`.trim()).run();
        fixes = `${fixes} jwrefund1`.trim();
      } catch (e) { console.error('jwrefund1', e); }
    }
    if (!fixes.includes('jwnov3') && fixes.includes('jwrefund1') && await db.prepare(`SELECT 1 FROM inv_meta WHERE key = 'import'`).first() && await claimFix(db, 'jwnov3')) {
      // 2026-11-20 사용자: 11월 중외 구매는 사용자가 직접 넣은 GA30% 3개(11/6)·중화제 3개(11/9) — '3개는 전에 있던 1개씩과 온 2개를 더한 것일 수 있어'.
      // 업체 계산(중화제 2 + GA30% 2)대로: 두 주문·입고를 2개·11/6으로(금액도 2개 값), 병원재고는 그대로 두려고 같은 날 '이전 재고' +1(재고 맞추기),
      // 그 주문을 업체 잔액에서 부가세 포함 차감(39,998 · 103,998) → 남은 144,001, 11/19 환급 입금 144,001 → 0원.
      // 두 주문이 그 모양(11월·3개·받음·차감 없음·입고 한 줄 3개) 그대로일 때만. 다른 기록은 손대지 않음.
      try {
        const D = '2026-11-06', now = Date.now();
        const os = (await db.prepare(`SELECT o.*, i.name AS item_name FROM inv_orders o JOIN inv_items i ON i.id = o.item_id WHERE i.vendor_id = 3 AND i.name IN ('중화제', 'GA30%')
          AND o.ordered_at BETWEEN '2026-11-01' AND '2026-11-30' AND o.status <> 'cancelled' ORDER BY o.id`).all()).results || [];
        const plan = [];
        for (const o of os) {
          const txs = (await db.prepare(`SELECT * FROM inv_tx WHERE order_id = ? AND deleted_at IS NULL AND kind = 'in'`).bind(o.id).all()).results || [];
          const used = await db.prepare(`SELECT 1 FROM inv_vendor_bal WHERE order_id = ? AND kind = 'use' AND deleted_at IS NULL`).bind(o.id).first();
          if (Number(o.qty) === 3 && o.status === 'received' && !used && txs.length === 1 && !txs[0].cancelled_at && Number(txs[0].qty) === 3 && Number(txs[0].hospital_delta) === 3) plan.push({ o, t: txs[0] });
        }
        const names = new Set(plan.map(p => p.o.item_name));
        if (os.length === 2 && plan.length === 2 && names.size === 2) {
          const stmts = [];
          for (const { o, t } of plan) {
            const amt = Math.round((Number(o.amount) || 0) / 3 * 2);
            stmts.push(
              db.prepare(`UPDATE inv_orders SET qty = 2, amount = ?, ordered_at = ?, received_at = ? WHERE id = ?`).bind(amt, D, D, o.id),
              db.prepare(`UPDATE inv_tx SET qty = 2, hospital_delta = 2, amount = CASE WHEN coalesce(amount, 0) > 0 THEN ? ELSE amount END, date = ?, updated_at = ?, updated_by = 'system' WHERE id = ?`).bind(amt, D, now, t.id),
              db.prepare(`INSERT INTO inv_tx (item_id, kind, date, qty, hospital_delta, vendor_delta, memo, created_by, created_at) VALUES (?, 'adjust', ?, 1, 1, 0, '이전 재고 · 입고 때 같이 셈', 'system', ?)`).bind(o.item_id, D, now),
              db.prepare(`INSERT INTO inv_vendor_bal (vendor_id, date, kind, amount, reason, order_id, created_by, created_at) VALUES (3, ?, 'use', ?, '주문', ?, 'system', ?)`).bind(D, Math.round(amt * 1.1), o.id, now));
          }
          await db.batch(stmts);
          const bal = await db.prepare(`SELECT coalesce(sum(CASE kind WHEN 'add' THEN amount ELSE -amount END), 0) AS b FROM inv_vendor_bal WHERE vendor_id = 3 AND deleted_at IS NULL`).first();
          const has = await db.prepare(`SELECT 1 FROM inv_vendor_bal WHERE vendor_id = 3 AND kind = 'refund' AND deleted_at IS NULL`).first();
          if (Math.round(bal?.b || 0) === 144001 && !has)
            await db.prepare(`INSERT INTO inv_vendor_bal (vendor_id, date, kind, amount, memo, created_by, created_at) VALUES (3, '2026-11-19', 'refund', 144001, '중복 결제 남은 금액 환급', 'system', ?)`).bind(now).run();
        }
        await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} jwnov3`.trim()).run();
        fixes = `${fixes} jwnov3`.trim();
      } catch (e) { console.error('jwnov3', e); }
    }
    if (!fixes.includes('oldafter1') && await db.prepare(`SELECT 1 FROM inv_meta WHERE key = 'import'`).first() && await claimFix(db, 'oldafter1')) {
      // 2026-11-20 사용자 '달마다 재고 맞춰줘'(예전 앱 출고 내역 사진 48일, '출고 후 병원 재고' 칸): 일일재고가 아닌 품목 중 예전 앱 숫자와 달마다 다르게 보이던 4개.
      // 예전 앱에 기록 없이 줄어든 만큼(사진의 앞뒤 '출고 후 병원 재고' 차이)을 그 사이 날짜에 '재고 맞추기'로, 처음 재고는 첫 기록 전날 '기초 재고'로 넣어 각 줄의 병원재고가 사진과 같게.
      // 늘리고 줄이는 합이 0이라 지금 병원재고는 그대로. 위드베라 9/8은 입고 뒤 출고 순서로(같은 기록을 입고 뒤로 옮김, 재고 그대로).
      // 그 품목의 11/5까지 기록이 예전 앱 자료 그대로일 때만(날짜·종류·증감), 아니면 그 품목은 손대지 않음.
      try {
        const now = Date.now(), M1 = '예전 앱 재고에 맞춤 · 기초 재고', M2 = '예전 앱 재고에 맞춤 · 기록 없는 차이';
        const PLAN = OLD_AFTER_PLAN.map(p => ({ ...p, add: (p.add || []).map(([d, q, k]) => [d, q, k === 1 ? M1 : M2]) }));
        for (const p of PLAN) {
          const rows = (await db.prepare(`SELECT * FROM inv_tx WHERE item_id = ? AND deleted_at IS NULL AND date <= '2026-11-05' ORDER BY date, id`).bind(p.id).all()).results || [];
          const same = rows.length === p.expect.length && rows.every((r, k) => r.date === p.expect[k][0] && r.kind === p.expect[k][1] && Math.round(Number(r.hospital_delta) * 1000) === p.expect[k][2] * 1000);
          if (!same) continue;
          const stmts = (p.add || []).map(([d, q, m]) => db.prepare(`INSERT INTO inv_tx (date, kind, item_id, qty, hospital_delta, vendor_delta, memo, source, created_by, created_at) VALUES (?, 'adjust', ?, ?, ?, 0, ?, 'oldafter1', 'system', ?)`).bind(d, p.id, Math.abs(q), q, m, now));
          if (p.reorder) {
            const o = rows[0];
            stmts.push(db.prepare(`UPDATE inv_tx SET deleted_at = ?, deleted_by = 'system' WHERE id = ?`).bind(now, o.id),
              db.prepare(`INSERT INTO inv_tx (date, kind, item_id, qty, bonus_qty, amount, hospital_delta, vendor_delta, hospital_after, vendor_after, order_id, daily_date, invoice, memo, source, created_by, created_at)
                SELECT date, kind, item_id, qty, bonus_qty, amount, hospital_delta, vendor_delta, hospital_after, vendor_after, order_id, daily_date, invoice, memo, source, created_by, created_at FROM inv_tx WHERE id = ?`).bind(o.id));
          }
          if (stmts.length) await db.batch(stmts);
        }
        await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} oldafter1`.trim()).run();
        fixes = `${fixes} oldafter1`.trim();
      } catch (e) { console.error('oldafter1', e); }
    }
    if (!fixes.includes('paymethod1') && await claimFix(db, 'paymethod1')) {
      // 2026-11-20 사용자 '이제부터 중외 온라인으로 바뀌니깐 이번달까지만 계좌입금으로 표기': 업체 결제 방법 이력 칸(예전 방법·시점, 새 방법 시작 달)을 더하고
      // 중외(id 3)가 계좌입금이면 11월까지는 계좌입금·결제 시 배송, 2026-12부터 온라인결제(늘 결제 완료). 은행·계좌 정보는 그대로 둠.
      try {
        for (const col of ['prev_payment_method TEXT', 'prev_pay_timing TEXT', 'method_from TEXT']) {
          try { await db.prepare(`ALTER TABLE inv_vendors ADD COLUMN ${col}`).run(); } catch (e) { if (!/duplicate column/i.test(String(e?.message || e))) throw e; }
        }
        await db.prepare(`UPDATE inv_vendors SET prev_payment_method = payment_method, prev_pay_timing = coalesce(pay_timing, 'order'), payment_method = '온라인결제', pay_timing = 'order', method_from = '2026-12'
          WHERE id = 3 AND payment_method LIKE '%계좌입금%' AND method_from IS NULL`).run();
        await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} paymethod1`.trim()).run();
        fixes = `${fixes} paymethod1`.trim();
      } catch (e) { console.error('paymethod1', e); }
    }
    if (!fixes.includes('onlinepay1') && fixes.includes('paymethod1')) {
      // 2026-11-20 사용자 '홈페이지결제를 온라인결제로 수정해줘': 저장된 결제 방법 이름만 바꿈(뜻·결제 시점은 그대로)
      try {
        await db.prepare(`UPDATE inv_vendors SET payment_method = replace(payment_method, '홈페이지결제', '온라인결제') WHERE payment_method LIKE '%홈페이지결제%'`).run();
        await db.prepare(`UPDATE inv_vendors SET prev_payment_method = replace(prev_payment_method, '홈페이지결제', '온라인결제') WHERE prev_payment_method LIKE '%홈페이지결제%'`).run();
        await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} onlinepay1`.trim()).run();
        fixes = `${fixes} onlinepay1`.trim();
      } catch (e) { console.error('onlinepay1', e); }
    }
    if (!fixes.includes('idx1')) {
      // 2026-11-21 사이트가 D1 무료 하루 읽기 한도(500만 줄)에 걸려 멈춤: 품목별 '그 날 뒤 증감'(보고서·입출고 내역·일일재고)과 주문별 받은 수량이
      // inv_tx 전체를 줄마다 다시 읽었음 → 품목·날짜, 주문 색인. 기록·숫자는 그대로.
      try {
        for (const q of [`CREATE INDEX IF NOT EXISTS inv_tx_item_date ON inv_tx(item_id, date, id)`, `CREATE INDEX IF NOT EXISTS inv_tx_order ON inv_tx(order_id)`, `CREATE INDEX IF NOT EXISTS inv_orders_item ON inv_orders(item_id)`, `CREATE INDEX IF NOT EXISTS inv_tx_kind ON inv_tx(kind, item_id)`]) await db.prepare(q).run();
        await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} idx1`.trim()).run();
        fixes = `${fixes} idx1`.trim();
      } catch (e) { console.error('idx1', e); }
    }
    if (!fixes.includes('leaderpay1')) {
      // 2026-11-20 사용자: 바이더퀄리티는 원장님이 아니라 팀장이 결제 — 보고서엔 '팀장 결제'로 보이고 병원 지출·결제 합계에서 빠짐(재고 기록은 그대로)
      try {
        await db.prepare(`UPDATE inv_vendors SET pay_timing = 'leader' WHERE id = 16 AND name = '바이더퀄리티'`).run();
        await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} leaderpay1`.trim()).run();
        fixes = `${fixes} leaderpay1`.trim();
      } catch (e) { console.error('leaderpay1', e); }
    }
    if (!fixes.includes('leavelog1')) {
      // 2026-11-20 사용자: 연차 기록 수정·취소 — 기록은 지우지 않고 취소 표시(취소일·사유)와 정정 줄 연결(ref_id)만 더함. 있는 기록·숫자는 그대로.
      for (const col of ['cancelled_at TEXT', 'cancel_reason TEXT', 'ref_id INTEGER']) {
        try { await db.prepare(`ALTER TABLE staff_leave_log ADD COLUMN ${col}`).run(); } catch (e) { if (!/duplicate column/i.test(String(e?.message || e))) throw e; }
      }
      await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} leavelog1`.trim()).run();
      fixes = `${fixes} leavelog1`.trim();
    }
    if (!fixes.includes('leavefix1') && await claimFix(db, 'leavefix1')) {
      // 2026-11-19 사용자 '잘못 누름, 삭제해줘': 김유리 연차 이력의 11/19 '수동 수정 · 포상 연차 지급' 한 줄을 지움.
      // 그 수정이 지급·사용연차를 바꿨으면 지금 값이 그 결과 그대로일 때만 수정 전으로 되돌림(화면 '삭제'와 같은 규칙).
      try {
        const logs = (await db.prepare(`SELECT l.* FROM staff_leave_log l JOIN staff s ON s.id = l.staff_id WHERE s.name = '김유리' AND l.log_type = 'adjust' AND l.reason = '포상 연차 지급' AND l.created_at LIKE '2026-11-19%'`).all()).results || [];
        if (logs.length === 1) {
          const log = logs[0], cur = await db.prepare('SELECT total_leave, used_leave FROM staff WHERE id = ?').bind(log.staff_id).first();
          const changed = log.before_total !== log.after_total || log.before_used !== log.after_used;
          if (!changed || (cur && cur.total_leave === log.after_total && cur.used_leave === log.after_used)) {
            await db.batch([...(changed ? [db.prepare('UPDATE staff SET total_leave = ?, used_leave = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(log.before_total, log.before_used, log.staff_id)] : []),
              db.prepare('DELETE FROM staff_leave_log WHERE id = ?').bind(log.id)]);
          }
        }
        await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} leavefix1`.trim()).run();
        fixes = `${fixes} leavefix1`.trim();
      } catch (e) { console.error('leavefix1', e); }
    }
    if (!fixes.includes('jwbal1') && await db.prepare(`SELECT 1 FROM inv_meta WHERE key = 'import'`).first() && await claimFix(db, 'jwbal1')) {
      // 2026-11-19 사용자 '해줘': 중외 업체 잔액 — 2025-10-30 중복 결제로 남은 돈(업체 확인: 이달 주문 뒤 144,001원).
      // 앱 가격 그대로(사용자 '현재 가격대로'): 11/12 GA20% 1개 40,000원 주문이 있으면 등록 184,001원 + 그 주문에 40,000원 차감, 없으면 등록 144,001원만. 중외 잔액 기록이 이미 있으면 손대지 않음.
      try {
        const v = await db.prepare(`SELECT id FROM inv_vendors WHERE id = 3 AND name = '중외'`).first();
        const has = v && await db.prepare(`SELECT 1 FROM inv_vendor_bal WHERE vendor_id = 3`).first();
        if (v && !has) {
          const ords = (await db.prepare(`SELECT o.id FROM inv_orders o JOIN inv_items i ON i.id = o.item_id WHERE i.vendor_id = 3 AND i.name = 'GA20%' AND o.ordered_at = '2026-11-12' AND o.amount = 40000 AND o.status <> 'cancelled'`).all()).results || [];
          const now = Date.now(), memo = '2025-10-30 같은 금액 두 번 결제 · 업체 확인 남은 돈 144,001원';
          const stmts = [db.prepare(`INSERT INTO inv_vendor_bal (vendor_id, date, kind, amount, reason, memo, created_by, created_at) VALUES (3, '2025-10-30', 'add', ?, '중복 결제', ?, 'system', ?)`)
            .bind(ords.length === 1 ? 184001 : 144001, ords.length === 1 ? `${memo} + 11/12 주문 40,000원` : memo, now)];
          if (ords.length === 1) stmts.push(db.prepare(`INSERT INTO inv_vendor_bal (vendor_id, date, kind, amount, reason, order_id, created_by, created_at) VALUES (3, '2026-11-12', 'use', 40000, '주문', ?, 'system', ?)`).bind(ords[0].id, now));
          await db.batch(stmts);
        }
        await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} jwbal1`.trim()).run();
        fixes = `${fixes} jwbal1`.trim();
      } catch (e) { console.error('jwbal1', e); }
    }
    if (!fixes.includes('dupfix1') && await claimFix(db, 'dupfix1')) {
      // 2026-11-12 사용자 '이중으로 겹치는데': 처음 요청이 동시에 두 번 들어와 splitfix1이 두 번 돌아 10/22 피부미소 입고 4줄이 두 벌(8줄) 생김.
      // 품목마다 처음 한 줄만 남기고 뒤 줄은 지운 기록으로(명세서 사진 연결은 그대로), 그 줄이 늘린 병원재고만 되돌림 — 그 뒤 센 날 수량은 그대로(keepCountStmts).
      // 같은 이유로 aladdin1의 '주문단위 1개 = 단가' 조건이 두 번 생겼으면 하나만 남김(뒤 것은 목록에서 뺌).
      try {
        const rows = (await db.prepare(`SELECT id, item_id, hospital_delta FROM inv_tx WHERE deleted_at IS NULL AND date = '2026-10-22' AND kind = 'in' AND memo = '받기 목록 · 거래명세서대로 나눔' AND created_by = 'system' ORDER BY item_id, id`).all()).results || [];
        const seen = new Set(), now = Date.now();
        for (const r of rows) {
          if (!seen.has(r.item_id)) { seen.add(r.item_id); continue; }
          const it = await db.prepare('SELECT hospital_stock FROM inv_items WHERE id = ?').bind(r.item_id).first();
          const keep = await keepCountStmts(db, r.item_id, '2026-10-22', -r.hospital_delta, 'system');
          const net = keep.length ? 0 : r.hospital_delta; // 뒤에 센 날이 있으면 병원재고는 그 날 수량 그대로
          if (round3((it?.hospital_stock || 0) - net) < 0) continue; // 0 밑으로 내려가면 손대지 않음
          await db.batch([...keep,
            db.prepare(`UPDATE inv_tx SET deleted_at = ?, deleted_by = 'system', memo = memo || ' (두 번 들어간 줄 지움)' WHERE id = ?`).bind(now, r.id),
            db.prepare('UPDATE inv_items SET hospital_stock = round(hospital_stock - ?, 3), updated_at = ? WHERE id = ?').bind(r.hospital_delta, now, r.item_id)]);
        }
        const opts = (await db.prepare(`SELECT id, item_id, label, qty, amount FROM inv_options WHERE active = 1 AND item_id IN (1029, 1030, 1031) ORDER BY item_id, id`).all()).results || [];
        const seenO = new Set();
        for (const o of opts) { const k = `${o.item_id}|${o.label}|${o.qty}|${o.amount}`; if (seenO.has(k)) await db.prepare('UPDATE inv_options SET active = 0 WHERE id = ?').bind(o.id).run(); else seenO.add(k); }
        await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('fixes', ?)`).bind(`${fixes} dupfix1`.trim()).run();
        fixes = `${fixes} dupfix1`.trim();
      } catch (e) { console.error('dupfix1', e); }
    }
  }
  ready = db;
}
// 한 번 고치기를 동시에 두 요청이 돌리지 않게(처음 요청이 겹치면 같은 고치기가 두 번 돌던 문제): inv_meta에 자리를 먼저 잡은 요청만 실행, 1분 넘게 안 끝나면 다시 잡을 수 있음
async function claimFix(db, name) {
  const key = `lock_${name}`, now = Date.now();
  const r = await db.prepare('INSERT OR IGNORE INTO inv_meta (key, value) VALUES (?, ?)').bind(key, String(now)).run();
  if (r?.meta?.changes) return true;
  const cur = await db.prepare('SELECT value FROM inv_meta WHERE key = ?').bind(key).first();
  if (cur && now - Number(cur.value) > 60000) { const u = await db.prepare('UPDATE inv_meta SET value = ? WHERE key = ? AND value = ?').bind(String(now), key, cur.value).run(); return !!u?.meta?.changes; }
  return false;
}
const round3 = n => Math.round(n * 1000) / 1000;
export const resetInvSchemaCache = () => { ready = null; };

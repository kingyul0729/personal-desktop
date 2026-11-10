import { VENDOR_BASE, ITEMS, EXTRA_ITEMS } from './invMaster.js';
import { moveTxDate, keepCountStmts } from './invTxDate.js';
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
  `CREATE TABLE IF NOT EXISTS inv_vendors (id INTEGER PRIMARY KEY, name TEXT NOT NULL, company TEXT, category TEXT, manager TEXT, payment_method TEXT, contact TEXT, bank TEXT, account TEXT, holder TEXT, memo TEXT, sort INTEGER DEFAULT 0, active INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS inv_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, vendor_id INTEGER, category TEXT, stock_unit TEXT NOT NULL DEFAULT 'ea', order_unit TEXT, pack_qty REAL, price REAL, min_stock REAL DEFAULT 0,
     hospital_stock REAL NOT NULL DEFAULT 0, vendor_stock REAL NOT NULL DEFAULT 0, daily_mode TEXT, prepaid INTEGER NOT NULL DEFAULT 0, is_pack INTEGER NOT NULL DEFAULT 0, memo TEXT, sort INTEGER DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER, updated_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS inv_options (id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL, label TEXT, qty REAL NOT NULL, bonus_qty REAL NOT NULL DEFAULT 0, amount REAL, prepaid INTEGER NOT NULL DEFAULT 0, unit_label TEXT, sort INTEGER DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS inv_orders (id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL, option_id INTEGER, option_label TEXT, ordered_at TEXT NOT NULL, qty REAL NOT NULL, bonus_qty REAL NOT NULL DEFAULT 0, amount REAL, prepaid INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, received_at TEXT, memo TEXT, created_by TEXT, created_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS inv_tx (id INTEGER PRIMARY KEY, date TEXT NOT NULL, kind TEXT NOT NULL, item_id INTEGER NOT NULL, qty REAL NOT NULL, bonus_qty REAL NOT NULL DEFAULT 0, amount REAL,
     hospital_delta REAL NOT NULL DEFAULT 0, vendor_delta REAL NOT NULL DEFAULT 0, hospital_after REAL, vendor_after REAL, order_id INTEGER, daily_date TEXT, invoice INTEGER NOT NULL DEFAULT 0, memo TEXT, source TEXT, created_by TEXT, created_at INTEGER, deleted_at INTEGER, deleted_by TEXT)`,
  `CREATE INDEX IF NOT EXISTS inv_tx_date ON inv_tx(date)`,
  `CREATE INDEX IF NOT EXISTS inv_tx_daily ON inv_tx(daily_date, item_id)`,
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
  }
  ready = db;
}
export const resetInvSchemaCache = () => { ready = null; };

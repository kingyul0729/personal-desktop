// 예전 재고관리 앱의 직원 표 구조(마이그레이션 0009·0010·0014·0022) — tests/fixtures/inv-staff.sql 에서 만든 것.
// 빈 데이터베이스에 직원 표가 없을 때 한 번만 실행한다.
export const INV_STAFF_SCHEMA = [
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

// 재고 표(2026-11-08 새로 설계). 기록(inv_tx)마다 병원재고·업체재고 증감을 저장해 삭제 때 정확히 되돌린다.
export const INV_STOCK_SCHEMA = [
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
];

import { VENDOR_BASE, ITEMS, EXTRA_ITEMS } from './invMaster.js';

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
  let ok = null;
  try { ok = await db.prepare(`SELECT value FROM inv_meta WHERE key = 'schema'`).first(); } catch { ok = null; }
  if (!ok) await db.exec(schemaSql());
  ready = db;
}
export const resetInvSchemaCache = () => { ready = null; };

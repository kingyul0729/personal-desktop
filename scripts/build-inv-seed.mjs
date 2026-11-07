// 예전 재고관리 앱 화면 사진에서 옮긴 숫자(scripts/inv-data/*.json)로 직원·재고 DB 첫 자료를 만든다.
// 실제 서버 코드(worker/staff.js)로 근태를 한 건씩 저장해 근무시간·연차 차감을 서버 규칙 그대로 계산한 뒤,
// 결과 표를 JSON 파일(scripts/inv-data/old-app-data.json)로 뜬다. 직원 근태 등 개인 자료라 공개 저장소에 넣지 않고,
// 사이트의 '예전 자료 넣기'로 올린다.
// 실행: node scripts/build-inv-seed.mjs  → 확인 필요 목록을 출력한다.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { schemaSql, INV_TABLES } from '../worker/invSchema.js';
import { VENDORS } from './inv-data/vendors.mjs';

const here = p => new URL(p, import.meta.url);
const load = n => JSON.parse(readFileSync(here(`./inv-data/${n}.json`), 'utf8'));
const TODAY = '2026-11-08';
const notes = [];

const sqlite = new DatabaseSync(':memory:');
const d1 = {
  prepare(sql) { const s = sqlite.prepare(sql); const b = (...v) => ({ async first() { return s.get(...v) ?? null; }, async all() { return { results: s.all(...v) }; }, async run() { return { meta: { changes: s.run(...v).changes } }; } }); return { bind: b, ...b() }; },
  async batch(list) { const r = []; for (const x of list) r.push(await x.run()); return r; },
  async exec(sql) { sqlite.exec(sql); },
};
sqlite.exec(schemaSql(Date.parse(`${TODAY}T00:00:00+09:00`)));
const { handleStaff } = await import('../worker/staff.js');
const env = { INV_DB: d1 };
async function staffCall(method, path, body) {
  const res = await handleStaff(new Request(`https://x.test/api/staff${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, new URL(`https://x.test/api/staff${path}`));
  const data = await res.json();
  if (!res.ok) throw new Error(`${path} ${JSON.stringify(body)} → ${JSON.stringify(data)}`);
  return data;
}

/* ── 직원 ── */
const STAFF = Object.fromEntries(sqlite.prepare('SELECT id, name FROM staff').all().map(r => [r.name, r.id]));
const sched = load('schedule');
const perf = ['perf1', 'perf2', 'perf3', 'perf4'].filter(n => { try { load(n); return true; } catch { return false; } }).flatMap(n => load(n).daily);
const months = [...new Set(sched.months.map(m => m.month))].sort();
const entries = new Map(); // `${date}|${name}` → {label, seq}
const holidays = new Set(), unentered = new Set();
for (const m of sched.months) for (const day of m.days) {
  if (day.holiday) holidays.add(day.date);
  if (day.unentered) unentered.add(day.date);
  for (const e of day.entries || []) entries.set(`${day.date}|${e.name}`, { label: e.label, seq: e.leave_seq || null });
}
const perfOf = new Map(perf.flatMap(p => p.rows.map(r => [`${p.date}|${r.name}`, r])));
const weekday = d => new Date(`${d}T00:00:00Z`).getUTCDay();
const STD = d => (weekday(d) === 6 ? ['09:30', '15:30'] : ['10:00', '19:30']);
// 연차 총·사용 = 화면에 보인 마지막 'n/총' 표기
const lastSeq = {};
for (const [k, v] of [...entries].sort()) if (v.seq) { const [date, name] = k.split('|'); lastSeq[name] = { date, n: Number(v.seq.split('/')[0]), total: Number(v.seq.split('/')[1]) }; }
const firstSeq = {};
for (const [k, v] of [...entries].sort().reverse()) if (v.seq) { const name = k.split('|')[1]; firstSeq[name] = Number(v.seq.split('/')[0]); }
for (const [name, id] of Object.entries(STAFF)) {
  const seen = [...entries].filter(([k, v]) => k.endsWith(`|${name}`) && v.label === '연차').length;
  const last = lastSeq[name];
  // 재생 전 사용 연차 = 마지막 표기 - (재생하며 더해질 연차 수)
  const base = last ? last.n - seen : 0;
  sqlite.prepare('UPDATE staff SET total_leave = ?, used_leave = ? WHERE id = ?').run(last ? last.total : 15, Math.max(0, base), id);
  if (!last) notes.push(`직원 ${name}: 연차 총·사용 표기를 찾지 못해 총 15개(예전 기본값)로 둠`);
  if (last && base < 0) notes.push(`직원 ${name}: 연차 사용 수가 맞지 않음(마지막 ${last.n}/${last.total}, 기록 ${seen}건)`);
}
for (const d of [...holidays].sort()) await staffCall('POST', '/day-status', { work_date: d, status: 'clinic_off', memo: '예전 앱 휴일' });

const dates = [];
for (const m of months) for (let i = 1; i <= 31; i++) { const d = `${m}-${String(i).padStart(2, '0')}`; if (new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d) dates.push(d); }
let saved = 0;
for (const date of dates) {
  if (weekday(date) === 0 || holidays.has(date)) continue;
  for (const [name, id] of Object.entries(STAFF)) {
    const e = entries.get(`${date}|${name}`), p = perfOf.get(`${date}|${name}`);
    let label = e?.label;
    if (!label && p && !['정상근무', '스케줄 없음', '휴일'].includes(p.status)) { label = p.status === '출퇴근 기타' ? '기타' : p.status; notes.push(`근태 ${date} ${name}: 달력엔 없고 성과 화면에만 '${p.status}'`); }
    if (e && p && p.status && !['스케줄 없음'].includes(p.status)) {
      const pl = p.status === '출퇴근 기타' ? '기타' : p.status;
      if (pl !== e.label && !(pl === '정상근무' && !e.label)) notes.push(`근태 ${date} ${name}: 달력 '${e.label}' / 성과 화면 '${p.status}' → 달력 기준`);
    }
    if (!label && p && p.status === '정상근무') label = '정상근무'; // 성과 화면에 정상근무로 보인 날
    if (!label) {
      if (date > TODAY || unentered.has(date)) continue; // 미래 날·미입력 날은 정상근무를 지어내지 않음
      if (p && p.status === '스케줄 없음') continue;
      label = '정상근무';
    }
    const [s, t] = STD(date);
    const body = { staff_id: id, work_date: date, editor: '예전 앱 자료' };
    if (label === '정상근무') Object.assign(body, { attendance: '정상근무', start_time: s, end_time: t });
    else if (label === '2출') Object.assign(body, { attendance: '기타', etc_type: 'time', etc_detail: '2시 출근', start_time: '14:00', end_time: '19:30' });
    else if (label === '기타') {
      const special = date === '2026-08-08';
      Object.assign(body, { attendance: '기타', etc_type: 'time', start_time: special ? '09:30' : s, end_time: special ? '14:10' : t, memo: special ? '회식' : '예전 앱 출퇴근 기타 · 시간 확인 필요' });
      if (!special) notes.push(`근태 ${date} ${name}: 출퇴근 기타 시간이 화면에 없어 표준시간으로 넣음`);
    } else Object.assign(body, { attendance: label });
    if (label === '연차' && e?.seq) body.memo = `예전 앱 표기 ${e.seq}`;
    if (p) { if (p.managed != null) body.managed_count = p.managed; if (p.designated != null) body.designated_count = p.designated; }
    await staffCall('POST', '/attendance', body);
    saved++;
  }
}
for (const [name, id] of Object.entries(STAFF)) {
  const r = sqlite.prepare('SELECT total_leave, used_leave FROM staff WHERE id = ?').get(id);
  const last = lastSeq[name];
  if (last && r.used_leave !== last.n) notes.push(`직원 ${name}: 재생 후 사용 연차 ${r.used_leave} ≠ 화면 마지막 표기 ${last.n} → 화면 값으로 맞춤`);
  if (last) sqlite.prepare('UPDATE staff SET used_leave = ? WHERE id = ?').run(last.n, id);
}

/* ── 재고 기준: 거래처 전체 정보(담당자·연락처·계좌)를 채움 ── */
const updV = sqlite.prepare('UPDATE inv_vendors SET manager = ?, contact = ?, bank = ?, account = ?, holder = ?, memo = ? WHERE id = ?');
for (const [id, , , , manager, , contact, bank, account, holder, memo] of VENDORS) updV.run(manager, contact, bank, account, holder, memo, id);
const now = Date.parse(`${TODAY}T00:00:00+09:00`);
const ALIAS = { '팩붓 (금형)': '팩붓', '스파출라 (소)': '스파출라 소', '스파출라 (대)': '스파출라 대', '시카 비건썬 유기자차': '시카 비건썬', '절단솜 4×6': '절단솜4x6', '거즈 30×35': '거즈30x35' };
const itemId = name => { const n = ALIAS[name] || name; const r = sqlite.prepare('SELECT id FROM inv_items WHERE name = ?').get(n); if (!r) throw new Error(`품목 없음: ${name}`); return r.id; };

/* ── 출고 내역(예전 앱 출고 목록) ── */
const insT = sqlite.prepare(`INSERT INTO inv_tx (date, kind, item_id, qty, bonus_qty, amount, hospital_delta, vendor_delta, hospital_after, vendor_after, daily_date, invoice, memo, source, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const stocks = [load('stock1'), load('stock2'), load('stock3')].flatMap(s => s.screens);
const outRows = stocks.filter(s => s.tab === '출고 내역').flatMap(s => s.rows).filter(r => !r.struck);
const outKey = new Set();
const known = new Map(); // item → [{date, after, order}]
const note = (id, date, after, order) => { if (after == null) return; const l = known.get(id) || []; l.push({ date, after, order }); known.set(id, l); };
for (const r of outRows.sort((a, b) => a.date.localeCompare(b.date))) {
  const id = itemId(r.item), daily = /일일 마감/.test(r.sub || '');
  const memo = (r.sub || '').split(' · ').slice(1).join(' · ') || null;
  insT.run(r.date, 'out', id, r.qty, 0, null, -r.qty, 0, r.after_stock, null, daily ? r.date : null, 0, memo, 'old-app', '예전 앱', now);
  outKey.add(`${r.date}|${id}`); note(id, r.date, r.after_stock, 2);
}
/* ── 일일 재고 화면: 인원·상태, 출고 목록에 없는 사용량 ── */
const qn = v => { const m = /^(-?[\d.]+)/.exec(String(v ?? '').trim()); return m ? Number(m[1]) : null; };
const insD = sqlite.prepare('INSERT OR REPLACE INTO inv_daily (date, patients, status, extra, updated_by, updated_at) VALUES (?,?,?,?,?,?)');
for (const s of stocks.filter(s => s.tab === '일일 재고').sort((a, b) => a.header.마감일.localeCompare(b.header.마감일))) {
  const date = s.header.마감일, patients = typeof s.header['총 피부관리 인원'] === 'number' ? s.header['총 피부관리 인원'] : qn(s.header['총 피부관리 인원']);
  const status = s.status_text ? s.status_text.split(' · ')[0] : null;
  const extra = {};
  for (const c of s.cards || []) {
    const id = itemId(c.item), f = c.fields || {};
    if (c.item === '보관용 모델링팩') { extra.modeling_people = qn(f['사용 인원']); const left = qn(f['미개봉'] ?? f['마감재고']); if (left != null) note(id, date, left, 1); continue; }
    if (c.item === '일회용해면') { const left = qn(f['미개봉'] ?? f['마감재고']); if (left != null) note(id, date, left, 1); continue; }
    const used = qn(f['당일 사용량'] ?? f['당일 사용수']), after = qn(f['마감재고']);
    if (after != null) note(id, date, after, 1);
    if (used && !outKey.has(`${date}|${id}`)) { insT.run(date, 'out', id, used, 0, null, -used, 0, after, null, date, 0, '일일 마감 소모', 'old-app-daily', '예전 앱', now); outKey.add(`${date}|${id}`); }
  }
  if (patients != null || status) insD.run(date, patients ?? null, status, JSON.stringify(extra), '예전 앱', now);
}

/* ── 입고·구매(거래명세서·월 정리·받기 목록에서 확인된 것만) ── */
// [date, kind, item, qty, bonus, amount, invoice, memo]
const INBOUND = [
  ['2026-06-02', 'in', '클렌징 젤 300ml', 5, 1, 145000, 1, '더마소드 거래명세서 · 5개 + 1개(단가 빈칸)'],
  ['2026-06-02', 'prepaid_in', '보관용 3종 시트팩', 100, 0, 0, 1, '하라셀 명세서: 모이스처 케어 시트팩 100'],
  ['2026-06-02', 'prepaid_in', '보관용 모델링팩', 10, 0, 0, 1, '하라셀 명세서: 수드 차콜 5 + 페퍼민트 5'],
  ['2026-07-02', 'prepaid_buy', '보관용 3종 시트팩', 500, 0, 500000, 1, '선결제권 · 명세서(7/1): 모이스처 300 + 3종 200'],
  ['2026-07-02', 'prepaid_in', '보관용 3종 시트팩', 500, 0, 0, 1, '명세서(7/1) 반입 500장'],
  ['2026-07-07', 'in', '일회용해면', 60, 0, 270000, 1, '피부미소 명세서'],
  ['2026-07-07', 'in', '거즈30x35', 2, 0, 12000, 1, '피부미소 명세서'],
  ['2026-07-07', 'in', '절단솜4x6', 5, 0, 42500, 1, '피부미소 명세서'],
  ['2026-07-07', 'in', '소타올 32호 (흰색)', 20, 0, 34000, 1, '피부미소 명세서'],
  ['2026-07-07', 'in', '사각터번', 10, 0, 45000, 1, '피부미소 명세서'],
  ['2026-07-07', 'in', '비절단솜4x30', 1, 0, 8500, 1, '피부미소 명세서'],
  ['2026-07-07', 'in', '코메도', 5, 0, 25000, 1, '피부미소 명세서'],
  ['2026-07-07', 'in', '팩붓', 10, 0, 10000, 1, '피부미소 명세서'],
  ['2026-07-16', 'prepaid_in', '보관용 모델링팩', 15, 0, 0, 1, '하라셀 명세서(7/15): 차콜 8 + 페퍼민트 7'],
  ['2026-08-08', 'prepaid_in', '보관용 모델링팩', 10, 0, 0, 1, '하라셀 명세서(8/7): 페퍼민트 7 + 차콜 3'],
  ['2026-08-11', 'in', '쿠컴버 토너 1000ml', 3, 0, 138600, 1, '쎄라덤 홈페이지결제'],
  ['2026-09-01', 'in', '더마 리바이브 팩', 80, 24, 250000, 1, '더마소드 명세서: 10박스 + 3박스(단가 빈칸)'],
  ['2026-09-01', 'in', '더마 하이드로 팩', 25, 5, 105000, 1, '더마소드 명세서: 5박스 + 1박스(단가 빈칸)'],
  ['2026-09-08', 'in', '위드베라 500ml', 10, 0, 224000, 1, '바이더퀄리티 추석 행사 22,400원 × 10 · 날짜 확인 필요'],
  ['2026-09-08', 'prepaid_in', '보관용 3종 시트팩', 200, 0, 0, 1, '하라셀 명세서: 모이스처 케어 시트팩 200'],
  ['2026-09-08', 'prepaid_in', '보관용 모델링팩', 15, 0, 0, 1, '하라셀 명세서: 페퍼민트 10 + 차콜 5'],
  ['2026-10-01', 'in', '카프리가스', 6, 0, 264000, 1, '받기 목록'],
  ['2026-10-07', 'in', '시카 비건썬', 10, 0, 0, 0, '받기 목록 · 0원 · 명세서 없음'],
  ['2026-10-22', 'prepaid_in', '보관용 모델링팩', 15, 0, 0, 1, '받기 목록'],
  ['2026-10-22', 'in', '절단솜4x6', 0, 0, 67500, 1, '받기 목록: 절단솜 4×6 외 3건(4개 품목) · 품목별 수량 확인 필요'],
  ['2026-11-06', 'prepaid_buy', '보관용 3종 시트팩', 300, 0, 450000, 1, '하라셀 선결제 300장 ₩450,000 (사용자 확인 2026-11-08)'],
];
for (const [date, kind, name, qty, bonus, amount, invoice, memo] of INBOUND) {
  const id = itemId(name), recv = qty + bonus;
  const hd = kind === 'in' || kind === 'prepaid_in' ? recv : 0, vd = kind === 'prepaid_buy' ? recv : kind === 'prepaid_in' ? -recv : 0;
  insT.run(date, kind, id, qty, bonus, amount, hd, vd, null, null, null, invoice, memo, 'old-app', '예전 앱', now);
}
notes.push('입고 10/22 피부미소 4개 품목 ₩67,500: 품목별 수량을 몰라 금액만 기록(수량 0)');
notes.push('7월 지출: 원장님 보고 ₩918,000 / 7월 월 정리 ₩947,000 — 서로 다름, 기록은 명세서 기준(₩947,000)');

/* ── 현재 재고: 품목마다 마지막으로 보인 수량 + 그 뒤 입고 ── */
for (const it of sqlite.prepare('SELECT id, name, prepaid FROM inv_items').all()) {
  const l = (known.get(it.id) || []).sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  const last = l[l.length - 1];
  let stock = last ? last.after : null;
  if (last) {
    const after = sqlite.prepare(`SELECT coalesce(sum(hospital_delta), 0) AS d FROM inv_tx WHERE item_id = ? AND date > ? AND kind IN ('in','prepaid_in')`).get(it.id, last.date).d;
    const outs = sqlite.prepare(`SELECT coalesce(sum(hospital_delta), 0) AS d FROM inv_tx WHERE item_id = ? AND date > ? AND kind = 'out'`).get(it.id, last.date).d;
    stock = last.after + after + outs;
  }
  const vendor = it.prepaid ? sqlite.prepare(`SELECT coalesce(sum(vendor_delta), 0) AS d FROM inv_tx WHERE item_id = ? AND date >= '2026-11-01'`).get(it.id).d : 0;
  sqlite.prepare('UPDATE inv_items SET hospital_stock = ?, vendor_stock = ? WHERE id = ?').run(stock ?? 0, Math.max(0, vendor), it.id);
  if (stock == null) notes.push(`재고 ${it.name}: 사진에 수량이 없어 0으로 둠 → 재고체크에서 맞추기 필요`);
}
notes.push('선결제 잔량: 사진에 잔량 화면이 없어 11/6 구매 300장만 3종 시트팩 잔량으로 둠(모델링팩 0) → 재고체크에서 맞추기 필요');

/* ── JSON으로 뜨기 ── */
const tables = Object.fromEntries(INV_TABLES.map(t => [t, sqlite.prepare(`SELECT * FROM ${t}`).all().map(r => ({ ...r }))]));
writeFileSync(here('./inv-data/old-app-data.json'), JSON.stringify({ format: 'dachaeum-old-app', version: 1, made: TODAY, tables }));
writeFileSync(here('./inv-data/seed-notes.txt'), notes.join('\n') + '\n');
console.log(`근태 ${saved}건 · 출고 ${tables.inv_tx.filter(t => t.kind === 'out').length}건 · 입고 ${INBOUND.length}건 · 행 ${Object.values(tables).reduce((a, r) => a + r.length, 0)}개`);
console.log(notes.join('\n'));

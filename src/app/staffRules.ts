// 직원 스케줄 화면 규칙 — 예전 재고관리 앱(public/static/staff.js)의 상태·저장값을 그대로 옮김.
// 저장 형식은 서버(worker/staff.js)와 맞물려 있으므로 바꾸지 않는다.

export type StaffMember = {
  id: number; name: string; position?: string; is_leader?: number; hire_date?: string | null; retire_date?: string | null;
  status?: string; total_leave?: number; used_leave?: number; remain_leave?: number; personal_color?: string | null;
};
export type AttendanceRecord = {
  staff_id?: number; work_date: string; attendance: string; etc_type?: string | null; etc_detail?: string | null;
  record_mode?: string | null; start_time?: string | null; end_time?: string | null; manual_adjust?: number;
  work_minutes?: number | null; adjust_reason?: string | null; managed_count?: number | null; designated_count?: number | null;
  partial_start?: string | null; partial_end?: string | null; memo?: string | null; is_demo?: number;
};
export type MonthData = { attendance?: AttendanceRecord[]; day_status?: { work_date: string; status: string }[]; leader_excluded_dates?: string[] };

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const ST_LEADER = ['정상근무', '출퇴근 기타', '상담', '휴무', '연차', '휴일', '병원휴무', '미기록'];
export const ST_STAFF = ['정상근무', '출퇴근 기타', '휴무', '연차'];
export const WORK_STATES = ['정상근무', '출퇴근 기타', '2출'];
const SHORT: Record<string, string> = { '정상근무': '근무', '출퇴근 기타': '기타', '2출': '2출', '상담': '상담', '휴무': '휴무', '연차': '연차', '휴일': '휴일', '병원휴무': '병원휴무', '미기록': '미기록', '무급 기타': '무급' };
const STD = { weekday: { s: '10:00', e: '19:30' }, saturday: { s: '09:30', e: '15:30' } };
const TWO_PM = { s: '14:00', e: '19:30' };

// 날짜 문자열(YYYY-MM-DD) 계산 — 시간대와 무관한 달력 날짜
const utc = (date: string) => new Date(`${date}T00:00:00Z`);
export const weekdayOf = (date: string) => utc(date).getUTCDay();
export const daysInMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
export const shiftMonth = (month: string, by: number) => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
export const dateIn = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}`;
export const todayLocal = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
export const monthLabel = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`;
export const dayLabelKo = (date: string) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 (${WEEKDAYS[weekdayOf(date)]})`;

export const isTimeEtc = (r?: AttendanceRecord | null) => !!r && r.attendance === '기타' && r.etc_type === 'time';
export function stateOf(r?: AttendanceRecord | null): string | null {
  if (!r) return null;
  if (isTimeEtc(r)) return r.etc_detail === '2시 출근' ? '2출' : '출퇴근 기타';
  if (r.attendance === '기타') return '무급 기타';
  if (r.attendance === '공휴일') return '휴일';
  return r.attendance;
}
export const optionsFor = (s: StaffMember) => (s.is_leader ? ST_LEADER : ST_STAFF).flatMap(x => (x === '출퇴근 기타' ? [x, '2출'] : [x]));
export const stdTime = (date: string) => (weekdayOf(date) === 6 ? STD.saturday : STD.weekday);
export function diffMin(s?: string | null, e?: string | null) {
  const tm = (t?: string | null) => { if (!/^\d{1,2}:\d{2}$/.test(t || '')) return null; const [h, m] = (t as string).split(':').map(Number); return h * 60 + m; };
  const a = tm(s), b = tm(e);
  if (a == null || b == null) return null;
  return b - a > 0 ? b - a : null;
}

// 기존 기록 전체를 싣고 바뀐 값만 덮는다(서버 POST /attendance 는 행 전체 upsert)
export function payloadFor(s: StaffMember, date: string, rec: AttendanceRecord | null, patch: Partial<AttendanceRecord>) {
  return {
    staff_id: s.id, work_date: date,
    attendance: rec ? rec.attendance : null, etc_type: rec ? rec.etc_type : null, etc_detail: rec ? rec.etc_detail : null,
    record_mode: rec ? rec.record_mode : null,
    start_time: rec ? rec.start_time : null, end_time: rec ? rec.end_time : null,
    manual_adjust: rec && rec.manual_adjust ? 1 : 0, work_minutes: rec && rec.manual_adjust ? rec.work_minutes : null,
    adjust_reason: rec ? rec.adjust_reason : null,
    managed_count: rec ? rec.managed_count : null, designated_count: rec ? rec.designated_count : null,
    partial_start: rec ? rec.partial_start : null, partial_end: rec ? rec.partial_end : null,
    memo: rec ? rec.memo : null, is_demo: !!(rec && rec.is_demo),
    ...patch,
  };
}
// 화면 상태 → 저장값 (정상근무는 표준시간을 채워 저장)
export function statePatch(st: string, s: StaffMember, date: string, rec: AttendanceRecord | null, times?: { s: string; e: string }): Partial<AttendanceRecord> {
  const prev = stateOf(rec);
  const noTime = { start_time: null, end_time: null, manual_adjust: 0, work_minutes: null, adjust_reason: null };
  if (st === '정상근무') {
    if (prev === '정상근무') return { attendance: '정상근무', etc_type: null, etc_detail: null, record_mode: null };
    const d = stdTime(date);
    return { attendance: '정상근무', etc_type: null, etc_detail: null, record_mode: null, start_time: d.s, end_time: d.e, manual_adjust: 0, work_minutes: null, adjust_reason: null };
  }
  if (st === '2출') return { attendance: '기타', etc_type: 'time', etc_detail: '2시 출근', record_mode: null, start_time: TWO_PM.s, end_time: TWO_PM.e, manual_adjust: 0, work_minutes: null, adjust_reason: null };
  if (st === '출퇴근 기타') {
    const t = times || (rec && WORK_STATES.includes(prev || '') && rec.start_time && rec.end_time ? { s: rec.start_time, e: rec.end_time } : stdTime(date));
    return { attendance: '기타', etc_type: 'time', etc_detail: null, record_mode: null, start_time: t.s, end_time: t.e, manual_adjust: 0, work_minutes: null, adjust_reason: null };
  }
  if (st === '휴일') return { attendance: '공휴일', etc_type: null, etc_detail: null, record_mode: null, ...noTime };
  if (st === '병원휴무') return { attendance: '병원휴무', etc_type: null, etc_detail: null, record_mode: null, ...noTime }; // 개인 연차에서 차감하지 않음
  if (st === '미기록') return { attendance: '미기록', etc_type: null, etc_detail: null, record_mode: (prev === '미기록' && rec?.record_mode) || (s.is_leader ? 'stock' : null), ...noTime };
  return { attendance: st, etc_type: null, etc_detail: null, record_mode: null, ...noTime };
}
// 관리 인원이 서버 규칙(정상근무·출퇴근 기타만 저장)으로 비워지는지

// 그 해 연차 날짜 → 날마다 누적 순번 (달력 '연차 3/15' 표기)
export function leaveCumulative(byStaff: Record<string, string[]>) {
  const out: Record<string, Record<string, number>> = {};
  for (const sid of Object.keys(byStaff || {})) {
    const cum: Record<string, number> = {};
    (byStaff[sid] || []).slice().sort().forEach((d, i) => { cum[d] = i + 1; });
    out[sid] = cum;
  }
  return out;
}

// 그 해 사용 순번 = 지금 사용 연차 - (이 날 뒤에 쓴 연차 수). 앞 기록이 빠진 해에도 최근 순번이 맞게.
export function leaveSeq(s: StaffMember, idx: Record<string, number> | undefined, date: string) {
  if (!idx || idx[date] == null) return s.used_leave ?? '-';
  const later = Object.keys(idx).length - idx[date];
  return (s.used_leave ?? 0) - later;
}

// 빨간 날 = 병원 휴일(사용자 지정 2026-11-08: 일요일·공휴일·대체공휴일은 병원도 쉬어서 근태를 따로 적지 않는다).
// 2026년 공휴일은 한국천문연구원 월력요항 기준(선거일 6/3 포함). 새해 공휴일은 해마다 여기에 더한다.
export const KR_RED_DAYS = new Set([
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02', '2026-05-05', '2026-05-24', '2026-05-25',
  '2026-06-03', '2026-06-06', '2026-07-17', '2026-08-15', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26',
  '2026-10-03', '2026-10-05', '2026-10-09', '2026-12-25',
]);
export const isRedDay = (date: string) => weekdayOf(date) === 0 || KR_RED_DAYS.has(date);

export const isReadonly = (s: StaffMember, date: string) => s.status === 'retired' && !!s.retire_date && date > s.retire_date;

// 달력 한 칸에 적을 줄: 정상근무가 아닌 사람만, 기록 없는 지난 평일은 '미입력 n'
export function calendarLines(date: string, staff: StaffMember[], recOf: (sid: number, date: string) => AttendanceRecord | null,
  holiday: boolean, cum: Record<string, Record<string, number>>, today: string) {
  if (holiday && staff.every(s => { const r = recOf(s.id, date); return !r || stateOf(r) === '휴일'; })) return { all: '휴일', lines: [] as { sid: number; name: string; label: string; kind: string }[], none: 0 };
  const lines: { sid: number; name: string; label: string; kind: string }[] = [];
  let none = 0;
  for (const s of staff) {
    if (s.hire_date && date < s.hire_date) continue;
    if (isReadonly(s, date)) continue;
    const rec = recOf(s.id, date);
    let st = stateOf(rec);
    if (!rec && holiday) st = '휴일';
    if (!st) { if (weekdayOf(date) !== 0 && date <= today) none++; continue; }
    if (st === '정상근무') continue;
    let label = SHORT[st] || st;
    const shown = /표기 (\d+\/\d+)/.exec(rec?.memo || '');
    if (st === '연차') label = shown ? `연차 ${shown[1]}` : `연차 ${leaveSeq(s, cum[s.id], date)}/${s.total_leave ?? '-'}`;
    const kind = st === '휴일' || st === '병원휴무' || st === '무급 기타' ? 'hol' : WORK_STATES.includes(st) ? 'work' : st === '연차' ? 'leave' : 'off';
    lines.push({ sid: s.id, name: s.name, label, kind });
  }
  return { all: '', lines, none };
}

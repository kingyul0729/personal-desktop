import { askConfirm } from './AlertDialog';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoadingBox, SavingMark } from './Feedback';
import { OldDataBanner } from './Inventory';
import { StaffAvatar } from './staffTone';
import { staffGet, staffPost, StaffApiError } from '../staffApi';
import {
  type AttendanceRecord, type MonthData, type StaffMember, WEEKDAYS, WORK_STATES, ST_LEADER, ST_STAFF, calendarLines, dateIn, dayLabelKo, daysInMonth, diffMin,
  isReadonly, isRedDay, isTimeEtc, leaveCumulative, monthLabel, optionsFor, payloadFor, shiftMonth, stateOf, statePatch, stdTime, todayLocal, weekdayOf,
} from '../staffRules';

// 직원스케줄/성과표 — 예전 재고관리 앱의 직원 달력(스케줄)과 성과 입력을 그대로 옮긴 화면.
// 상태를 고르면 바로 저장한다(예전 앱과 같은 저장값, 서버 계산 그대로).
type PerfRow = { id: number; name: string; status?: string; total_hours: number | null; total_managed: number | null; avg_managed: number | null; total_designated: number | null; remain_leave: number | null; work_days?: number; leave_used?: number; exclusions?: { date: string; reason: string }[] };

// 빨리 보이게(2026-11-08 사용자 '느려'): 달마다 받은 자료를 기억해 두고 다시 열면 바로 보여 준 뒤 뒤에서 새로 받는다.
// 직원별 달 자료는 한꺼번에(동시에) 받고, 앞뒤 달은 미리 받아 둔다.
type MonthBundle = { list: StaffMember[]; months: Record<number, MonthData>; cum: Record<string, Record<string, number>> };
const monthCache = new Map<string, MonthBundle>();
async function fetchMonth(month: string): Promise<MonthBundle> {
  const [list, ld] = await Promise.all([
    staffGet('/list', { include_retired: 0 }) as Promise<StaffMember[]>,
    staffGet('/leave-dates', { year: month.slice(0, 4) }).catch(() => ({ leave_dates: {} })),
  ]);
  const rows = await Promise.all(list.map(s => staffGet('/month', { staff_id: s.id, month }) as Promise<MonthData>));
  const months: Record<number, MonthData> = {};
  list.forEach((s, i) => { months[s.id] = rows[i]; });
  const b = { list, months, cum: leaveCumulative(ld.leave_dates || {}) };
  monthCache.set(month, b);
  return b;
}
function prefetch(month: string) { if (!monthCache.has(month)) void fetchMonth(month).catch(() => undefined); }
if (typeof window !== 'undefined') window.addEventListener('staff-data-changed', () => monthCache.clear());

function useStaffMonth(month: string) {
  const [staff, setStaff] = useState<StaffMember[]>(() => monthCache.get(month)?.list || []);
  const [all, setAll] = useState<Record<number, MonthData>>(() => monthCache.get(month)?.months || {});
  const [cum, setCum] = useState<Record<string, Record<string, number>>>(() => monthCache.get(month)?.cum || {});
  const [state, setState] = useState<{ loading: boolean; error: string; unavailable: boolean; detail?: string }>(() => ({ loading: !monthCache.has(month), error: '', unavailable: false }));
  const seq = useRef(0);
  const load = useCallback(async (quiet = false) => {
    const n = ++seq.current;
    const hit = monthCache.get(month);
    if (hit && !quiet) { setStaff(hit.list); setAll(hit.months); setCum(hit.cum); setState({ loading: false, error: '', unavailable: false }); }
    else if (!quiet) setState(s => ({ ...s, loading: true }));
    try {
      const { list, months, cum: c } = await fetchMonth(month);
      prefetch(shiftMonth(month, -1)); prefetch(shiftMonth(month, 1));
      if (n !== seq.current) return;
      setStaff(list); setAll(months); setCum(c); setState({ loading: false, error: '', unavailable: false });
    } catch (e) {
      if (n !== seq.current || (hit && !quiet)) return; // 기억해 둔 화면이 있으면 그대로 둔다
      setState({ loading: false, error: e instanceof Error ? e.message : '불러오지 못했어요.', unavailable: e instanceof StaffApiError && e.unavailable, detail: e instanceof StaffApiError ? e.detail : '' });
    }
  }, [month]);
  useEffect(() => { void load(); const on = () => void load(); window.addEventListener('staff-data-changed', on); return () => window.removeEventListener('staff-data-changed', on); }, [load]);
  return { staff, setStaff, all, cum, ...state, reload: load };
}

export function StaffUnavailable({ message, unavailable, detail }: { message: string; unavailable: boolean; detail?: string }) {
  return <div className="pending-screen"><strong>{unavailable ? '직원 자료 연결 전' : '불러오지 못했어요'}</strong>
    <p>{message}</p>
    {detail && <pre className="sf-detail">{detail}</pre>}</div>;
}

export default function StaffSchedule() {
  const [tab, setTab] = useState<'schedule' | 'perf'>('schedule');
  const [month, setMonth] = useState(() => todayLocal().slice(0, 7));
  const data = useStaffMonth(month);
  const [toast, setToast] = useState('');
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2200); return () => clearTimeout(t); }, [toast]);
  return <div className="sf-wrap">
    <OldDataBanner />
    <div className="sf-bar">
      <div className="sf-month">
        <button type="button" aria-label="이전 달" onClick={() => setMonth(m => shiftMonth(m, -1))}><ChevronLeft size={18} strokeWidth={2} /></button>
        <strong>{monthLabel(month)}</strong>
        <button type="button" aria-label="다음 달" onClick={() => setMonth(m => shiftMonth(m, 1))}><ChevronRight size={18} strokeWidth={2} /></button>
        <button type="button" className="sf-today" onClick={() => setMonth(todayLocal().slice(0, 7))}>오늘</button>
      </div>
      <div className="sf-seg" role="tablist" aria-label="보기">
        <button type="button" role="tab" aria-selected={tab === 'schedule'} onClick={() => setTab('schedule')}>스케줄</button>
        <button type="button" role="tab" aria-selected={tab === 'perf'} onClick={() => setTab('perf')}>성과</button>
      </div>
    </div>
    {data.loading && !data.staff.length ? <LoadingBox /> : data.error ? <StaffUnavailable message={data.error} unavailable={data.unavailable} detail={data.detail} />
      : tab === 'schedule' ? <Schedule month={month} data={data} notify={setToast} /> : <Performance month={month} data={data} notify={setToast} />}
    {toast && <div className="sf-toast" role="status">{toast}</div>}
  </div>;
}

type Data = ReturnType<typeof useStaffMonth>;

function Schedule({ month, data, notify }: { month: string; data: Data; notify: (m: string) => void }) {
  const today = todayLocal();
  const [sel, setSel] = useState(() => (today.slice(0, 7) === month ? today : `${month}-01`));
  useEffect(() => { setSel(s => (s.slice(0, 7) === month ? s : today.slice(0, 7) === month ? today : `${month}-01`)); }, [month, today]);
  const [busy, setBusy] = useState<number | null>(null);
  const [bulk, setBulk] = useState(false);
  const [importing, setImporting] = useState(false);
  const { staff, all, cum } = data;
  const recOf = useCallback((sid: number, date: string) => (all[sid]?.attendance || []).find(r => r.work_date === date) || null, [all]);
  const leader = staff.find(s => s.is_leader);
  const dayStatus = all[staff[0]?.id]?.day_status || [];
  const clinicOff = (date: string) => dayStatus.some(r => r.work_date === date && r.status === 'clinic_off');
  const isHoliday = (date: string) => isRedDay(date) || clinicOff(date) || (!!leader && ['공휴일', '병원휴무'].includes(recOf(leader.id, date)?.attendance || ''));

  // 성과는 팀장 기준이라 팀장 근태를 바꾸면 그날 직원 성과도 바뀐다 — 직원 실적이 이미 있는 날이면 먼저 묻는다(2026-11-08 사용자 요청)
  const staffWithPerf = (date: string) => staff.filter(x => !x.is_leader && (() => { const r = recOf(x.id, date); return !!r && (r.managed_count != null || r.designated_count != null); })()).length;
  const save = async (s: StaffMember, date: string, patch: Partial<AttendanceRecord>, msg = '저장되었습니다', asked = false) => {
    const onlyMemo = Object.keys(patch).every(k => k === 'memo');
    const n = s.is_leader && !onlyMemo && !asked ? staffWithPerf(date) : 0;
    if (n && !await askConfirm({ title: '팀장 근태를 바꿀까요?', message: `${dayLabelKo(date)} 직원 ${n}명의 관리 실적이 다시 계산돼요.` })) return;
    setBusy(s.id);
    try { await staffPost('/attendance', payloadFor(s, date, recOf(s.id, date), patch)); notify(msg); await data.reload(true); }
    catch (e) { notify(e instanceof Error ? e.message : '저장 실패'); }
    finally { setBusy(null); }
  };
  const choose = (s: StaffMember, st: string) => {
    const rec = recOf(s.id, sel);
    if (stateOf(rec) === st) return;
    const patch = statePatch(st, s, sel, rec);
    void save(s, sel, patch, st === '연차' ? '연차로 저장되었습니다' : '저장되었습니다');
  };

  const n = daysInMonth(month), lead = weekdayOf(`${month}-01`), tail = (7 - ((lead + n) % 7)) % 7;
  const list = staff.filter(s => !(s.hire_date && sel < s.hire_date));
  const off = clinicOff(sel);
  let working = 0;
  return <div className="sf-sched">
    <div className="sf-cal" aria-label={`${monthLabel(month)} 달력`}>
      <div className="sf-wk">{WEEKDAYS.map((w, i) => <span key={w} className={i === 0 ? 'is-sun' : ''}>{w}</span>)}</div>
      <div className="sf-days">
        {Array.from({ length: lead }, (_, i) => <span key={`a${i}`} className="sf-day is-blank" />)}
        {Array.from({ length: n }, (_, i) => {
          const date = dateIn(month, i + 1), cell = calendarLines(date, staff, recOf, isHoliday(date), cum, today);
          return <button key={date} type="button" className={`sf-day${date === sel ? ' is-sel' : ''}${date === today ? ' is-today' : ''}${isRedDay(date) ? ' is-sun' : ''}`} aria-pressed={date === sel} onClick={() => { setSel(date); setConfirmClear(false); }}>
            <span className="sf-dn">{i + 1}</span>
            {cell.all ? <span className="sf-ev is-hol">휴일</span> : cell.lines.map(l => <span key={l.sid} className={`sf-ev is-${l.kind}`}><b><i>{l.name.length >= 3 ? l.name[0] : ''}</i>{l.name.length >= 3 ? l.name.slice(1) : l.name}</b> <span>{l.label}</span></span>)}
            {cell.none > 0 && <span className="sf-ev is-none">미입력 {cell.none}</span>}
          </button>;
        })}
        {Array.from({ length: tail }, (_, i) => <span key={`z${i}`} className="sf-day is-blank" />)}
      </div>
    </div>
    <div className="sf-side">
      <div className="sf-dhead"><h3>{dayLabelKo(sel)}</h3>
        <span className="sf-dhead-btns"><button type="button" className="sf-btn" onClick={() => setImporting(true)}>파일로 넣기</button>
        <button type="button" className="sf-btn" onClick={() => setBulk(true)}>일괄 설정</button></span></div>
      {off && <div className="sf-confirm">병원 휴일로 정해진 날이에요. <button type="button" className="sf-btn" onClick={async () => { if (!await askConfirm({ title: '이 날짜의 휴일을 해제할까요?', message: dayLabelKo(sel) })) return; try { await staffPost('/day-status', { work_date: sel, clear: true }); await data.reload(true); } catch (e) { notify(e instanceof Error ? e.message : '휴무 해제 실패'); } }}>휴일 해제</button></div>}
      {list.map(s => {
        const rec = recOf(s.id, sel), st = stateOf(rec), locked = isReadonly(s, sel) || off, opts = optionsFor(s);
        if (WORK_STATES.includes(st || '')) working++;
        const cur = st || (isHoliday(sel) ? '휴일' : '');
        const blank = isReadonly(s, sel) ? '퇴사' : sel <= today && weekdayOf(sel) !== 0 ? '미입력' : '-';
        return <div key={s.id} className="sf-srow">
          <div className="sf-sline"><StaffAvatar id={s.id} name={s.name} /><b>{s.name}</b>{s.is_leader ? <small>팀장</small> : null}
            {busy === s.id && <SavingMark />}
            <select className={`sf-select${st && st !== '정상근무' ? ' is-ch' : ''}${!cur ? ' is-none' : ''}`} value={cur} disabled={locked || busy === s.id} aria-label={`${s.name} 상태`} onChange={e => choose(s, e.target.value)}>
              {!cur && <option value="" disabled>{blank}</option>}
              {cur && !opts.includes(cur) && <option value={cur} disabled>{cur}</option>}
              {opts.map(x => <option key={x} value={x}>{x}</option>)}
            </select></div>
          {st === '출퇴근 기타' && !locked && rec && <EtcTimes key={`${sel}-${rec.start_time}-${rec.end_time}-${rec.memo}`} rec={rec} date={sel} onSave={(patch, msg) => void save(s, sel, patch, msg)} />}
          {st === '2출' && <p className="sf-hint">14:00 – 19:30</p>}
        </div>;
      })}
      <div className="sf-sum">출근 {working} / {list.length}</div>
    </div>
    {importing && <ScheduleImport staff={staff} onClose={() => setImporting(false)} onDone={async msg => { notify(msg); await data.reload(true); }} />}
    {bulk && <BulkDialog month={month} staff={staff} all={all} onClose={() => setBulk(false)} onDone={async msg => { notify(msg); await data.reload(true); }} />}
  </div>;
}

function EtcTimes({ rec, date, onSave }: { rec: AttendanceRecord; date: string; onSave: (p: Partial<AttendanceRecord>, msg: string) => void }) {
  const [a, setA] = useState(rec.start_time || stdTime(date).s), [z, setZ] = useState(rec.end_time || stdTime(date).e), [memo, setMemo] = useState(rec.memo || '');
  const bad = diffMin(a, z) == null;
  const commit = (na: string, nz: string) => { if (!na || !nz || diffMin(na, nz) == null) return; if (na === rec.start_time && nz === rec.end_time) return; onSave({ start_time: na, end_time: nz }, '시간이 저장되었습니다'); };
  return <div className="sf-times">
    <label><span>시작</span><input type="time" value={a} onChange={e => setA(e.target.value)} onBlur={() => commit(a, z)} /></label>
    <label><span>종료</span><input type="time" value={z} onChange={e => setZ(e.target.value)} onBlur={() => commit(a, z)} /></label>
    <label className="sf-grow"><span>메모</span><input type="text" value={memo} placeholder="선택 입력" onChange={e => setMemo(e.target.value)} onBlur={() => { if ((memo || null) !== (rec.memo || null)) onSave({ memo: memo || null }, '메모가 저장되었습니다'); }} /></label>
    {bad && <p className="sf-hint is-warn">종료 시간이 시작 시간보다 늦어야 합니다.</p>}
  </div>;
}

// 한 달 스케줄 파일 넣기(2026-11-08 사용자: '매달 스케줄이 나오면 자동 입력'): Claude가 스케줄 사진·표를 옮겨 만든
// JSON 파일 { format: 'dachaeum-schedule', month, rows: [{ name, date, state, start?, end?, memo? }] } 을 한 건씩 저장한다.
// 저장은 직원스케줄에서 고르는 것과 같은 길(statePatch → POST /attendance)이라 연차 차감·팀장 기준 규칙이 그대로 적용된다.
// 팀장 줄을 먼저 저장하고, 빨간 날은 건너뛴다.
type ImportRow = { name: string; date: string; state: string; start?: string; end?: string; memo?: string };
function ScheduleImport({ staff, onClose, onDone }: { staff: StaffMember[]; onClose: () => void; onDone: (msg: string) => Promise<void> }) {
  const [rows, setRows] = useState<(ImportRow & { s: StaffMember })[] | null>(null);
  const [error, setError] = useState(''), [running, setRunning] = useState(false), [done, setDone] = useState(0), [fileName, setFileName] = useState('');
  const pick = async (f?: File) => {
    setError(''); setRows(null); if (!f) return; setFileName(f.name);
    try {
      const j = JSON.parse(await f.text());
      if (j?.format !== 'dachaeum-schedule' || !Array.isArray(j.rows)) throw new Error('스케줄 파일이 아니에요');
      const out: (ImportRow & { s: StaffMember })[] = [], bad: string[] = [];
      const valid = new Set([...ST_LEADER, '2출', '출퇴근 기타']);
      for (const r of j.rows as ImportRow[]) {
        const sm = staff.find(x => x.name === r.name || x.name.slice(1) === r.name);
        if (!sm || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !valid.has(r.state) || (!sm.is_leader && !optionsFor(sm).includes(r.state))) { bad.push(`${r.name} ${r.date} ${r.state}`); continue; }
        if (isRedDay(r.date) && !WORK_STATES.includes(r.state)) continue;
        out.push({ ...r, s: sm });
      }
      if (bad.length) throw new Error(`확인 필요: ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? ` 외 ${bad.length - 5}건` : ''}`);
      out.sort((a, b) => (b.s.is_leader ? 1 : 0) - (a.s.is_leader ? 1 : 0) || a.date.localeCompare(b.date));
      setRows(out);
    } catch (e) { setError(e instanceof Error ? e.message : '파일을 읽지 못했어요'); }
  };
  const apply = async () => {
    if (!rows) return; setRunning(true);
    const cache: Record<string, AttendanceRecord[]> = {};
    const recOf = async (sm: StaffMember, d: string) => {
      const k = `${sm.id}|${d.slice(0, 7)}`;
      if (!cache[k]) cache[k] = ((await staffGet('/month', { staff_id: sm.id, month: d.slice(0, 7) })) as MonthData).attendance || [];
      return cache[k].find(r => r.work_date === d) || null;
    };
    const fail: string[] = []; let ok = 0;
    for (const r of rows) {
      try {
        const rec = await recOf(r.s, r.date);
        const times = r.start && r.end ? { s: r.start, e: r.end } : undefined;
        const patch = { ...statePatch(r.state, r.s, r.date, rec, times), ...(r.memo ? { memo: r.memo } : {}) };
        await staffPost('/attendance', payloadFor(r.s, r.date, rec, patch)); ok++; setDone(ok);
      } catch (e) { fail.push(`${r.name} ${Number(r.date.slice(5, 7))}/${Number(r.date.slice(8))}`); }
    }
    setRunning(false);
    await onDone(fail.length ? `완료 ${ok}건 · 실패 ${fail.length}건` : `${ok}건 넣었습니다`);
    if (fail.length) setError(`실패: ${fail.join(', ')}`); else onClose();
  };
  const leaves = rows?.filter(r => r.state === '연차').length || 0;
  return <div className="sf-modal" role="dialog" aria-modal="true" aria-label="스케줄 파일로 넣기">
    <div className="sf-modal-back" onClick={() => !running && onClose()} />
    <div className="sf-modal-panel">
      <div className="sf-modal-head"><strong>스케줄 파일로 넣기</strong><button type="button" aria-label="닫기" onClick={() => !running && onClose()}>×</button></div>
      <label className="sf-btn"><input type="file" accept="application/json,.json" hidden onChange={e => void pick(e.target.files?.[0])} />{fileName || '파일 고르기'}</label>
      {rows && <p className="sf-ask">{rows.length}건{leaves ? ` · 연차 ${leaves}건` : ''}{running ? ` · ${done}/${rows.length}` : ''}</p>}
      {error && <p className="sf-hint is-warn">{error}</p>}
      <div className="sf-modal-foot"><button type="button" className="sf-btn" disabled={running} onClick={onClose}>닫기</button>
        <button type="button" className="sf-btn is-primary" disabled={!rows?.length || running} onClick={() => void apply()}>{running && <SavingMark />}넣기</button></div>
    </div>
  </div>;
}

function BulkDialog({ month, staff, all, onClose, onDone }: { month: string; staff: StaffMember[]; all: Record<number, MonthData>; onClose: () => void; onDone: (msg: string) => Promise<void> }) {
  const active = staff.filter(s => s.status !== 'retired');
  const [sid, setSid] = useState(() => (active.find(s => s.is_leader) || active[0])?.id);
  const [mode, setMode] = useState<'dates' | 'weekday' | 'range'>('dates');
  const [days, setDays] = useState<Set<string>>(new Set());
  const [wd, setWd] = useState<number[]>([]);
  const [from, setFrom] = useState(`${month}-01`), [to, setTo] = useState(dateIn(month, daysInMonth(month)));
  const [st, setSt] = useState<string | null>(null), [etc, setEtc] = useState<'two' | 'free'>('free'), [ts, setTs] = useState('10:00'), [te, setTe] = useState('19:30');
  const [error, setError] = useState(''), [ask, setAsk] = useState(''), [running, setRunning] = useState(false);
  const s = staff.find(x => x.id === sid);
  const states = s?.is_leader ? ST_LEADER : ST_STAFF;
  const n = daysInMonth(month);
  const dates = useMemo(() => {
    let out: string[] = [];
    if (mode === 'dates') out = [...days];
    else if (mode === 'weekday') for (let d = 1; d <= n; d++) { const x = dateIn(month, d); if (wd.includes(weekdayOf(x))) out.push(x); }
    else if (from && to && from <= to) {
      const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5;
      if (span <= 92) for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 864e5) out.push(new Date(t).toISOString().slice(0, 10));
    }
    return out.sort().filter(d => !(s && isReadonly(s, d)));
  }, [mode, days, wd, from, to, month, n, s]);
  const finalSt = st === '출퇴근 기타' && etc === 'two' ? '2출' : st;
  const times = st === '출퇴근 기타' && etc === 'free' ? { s: ts, e: te } : undefined;
  const plan = async () => {
    setError('');
    if (!s) return;
    if (!finalSt) return setError('적용할 상태를 고르세요');
    if (!dates.length) return setError(mode === 'range' ? '기간을 확인하세요(93일 이내)' : '적용할 날짜를 고르세요');
    if (times && diffMin(times.s, times.e) == null) return setError('종료 시간이 시작 시간보다 늦어야 합니다');
    const recs: Record<string, AttendanceRecord> = {}, offs = new Set<string>();
    for (const mo of [...new Set(dates.map(d => d.slice(0, 7)))]) {
      const d: MonthData = mo === month ? all[s.id] || {} : await staffGet('/month', { staff_id: s.id, month: mo });
      (d.attendance || []).forEach(r => { recs[r.work_date] = r; });
      (d.day_status || []).forEach(r => { if (r.status === 'clinic_off') offs.add(r.work_date); });
    }
    const targets = dates.filter(d => !offs.has(d));
    if (!targets.length) return setError('고른 날짜가 모두 휴일입니다');
    const over = targets.filter(d => recs[d]).length;
    // 팀장 근태를 바꾸면 직원 성과가 다시 계산되므로, 고른 날짜가 어느 달이든 직원 관리 실적이 있는 날을 센다(스케줄·성과 연동)
    let perfDays = 0;
    if (s.is_leader) {
      const others = staff.filter(x => !x.is_leader && x.status !== 'retired');
      const byStaff: Record<number, AttendanceRecord[]> = {};
      for (const x of others) byStaff[x.id] = [...(all[x.id]?.attendance || [])];
      for (const mo of [...new Set(targets.map(d => d.slice(0, 7)))].filter(m => m !== month))
        for (const x of others) { try { byStaff[x.id].push(...(((await staffGet('/month', { staff_id: x.id, month: mo })) as MonthData).attendance || [])); } catch { /* 못 불러오면 그 달은 안내에서 빠짐 */ } }
      perfDays = targets.filter(d => others.some(x => byStaff[x.id].some(r => r.work_date === d && (r.managed_count != null || r.designated_count != null)))).length;
    }
    const msg = `${targets.length}일에 '${finalSt === '2출' ? '출퇴근 기타 · 2출' : finalSt}' 적용${over ? ` · 기존 기록 ${over}건 바뀜` : ''}${perfDays ? ` · 직원 관리 실적이 있는 ${perfDays}일은 팀장 기준으로 직원 성과가 다시 계산됨` : ''}${dates.length > targets.length ? ` · 휴일 ${dates.length - targets.length}일 제외` : ''}`;
    return { targets, recs, msg };
  };
  const apply = async () => {
    if (!s || !finalSt) return;
    const p = await plan(); if (!p) return;
    if (!await askConfirm({ title: '일괄 설정을 적용할까요?', message: p.msg, kind: 'save' })) return;
    setRunning(true);
    let ok = 0; const fail: string[] = [];
    for (const d of p.targets) {
      try { await staffPost('/attendance', payloadFor(s, d, p.recs[d] || null, statePatch(finalSt, s, d, p.recs[d] || null, times))); ok++; }
      catch (e) { fail.push(`${Number(d.slice(5, 7))}/${Number(d.slice(8))} ${e instanceof Error ? e.message : '실패'}`); }
    }
    setRunning(false);
    await onDone(fail.length ? `완료 ${ok}건 · 실패 ${fail.length}건` : `${ok}일 적용되었습니다`);
    if (fail.length) { setAsk(''); setError(`실패: ${fail.join(', ')}`); } else onClose();
  };
  return <div className="sf-modal" role="dialog" aria-modal="true" aria-label="일괄 설정">
    <div className="sf-modal-back" onClick={onClose} />
    <div className="sf-modal-panel">
      <div className="sf-modal-head"><strong>일괄 설정</strong><button type="button" aria-label="닫기" onClick={onClose}>×</button></div>
      <div className="sf-field"><span>직원</span><div className="sf-pills">{active.map(x => <button key={x.id} type="button" aria-pressed={x.id === sid} onClick={() => { setSid(x.id); setAsk(''); }}>{x.name}</button>)}</div></div>
      <div className="sf-field"><span>대상</span><div className="sf-pills">{([['dates', '날짜'], ['weekday', '요일'], ['range', '기간']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={mode === k} onClick={() => { setMode(k); setAsk(''); }}>{l}</button>)}</div></div>
      <div className="sf-field">
        {mode === 'dates' && <div className="sf-pills sf-daypick">{Array.from({ length: n }, (_, i) => { const d = dateIn(month, i + 1); return <button key={d} type="button" aria-pressed={days.has(d)} onClick={() => { setDays(cur => { const x = new Set(cur); x.has(d) ? x.delete(d) : x.add(d); return x; }); setAsk(''); }}>{i + 1}</button>; })}</div>}
        {mode === 'weekday' && <div className="sf-pills">{[1, 2, 3, 4, 5, 6, 0].map(w => <button key={w} type="button" aria-pressed={wd.includes(w)} onClick={() => { setWd(cur => cur.includes(w) ? cur.filter(x => x !== w) : [...cur, w]); setAsk(''); }}>{WEEKDAYS[w]}</button>)}</div>}
        {mode === 'range' && <div className="sf-range"><input type="date" value={from} onChange={e => { setFrom(e.target.value); setAsk(''); }} /> – <input type="date" value={to} onChange={e => { setTo(e.target.value); setAsk(''); }} /></div>}
      </div>
      <div className="sf-field"><span>상태</span><div className="sf-pills">{states.map(x => <button key={x} type="button" aria-pressed={st === x} onClick={() => { setSt(x); setAsk(''); }}>{x}</button>)}</div></div>
      {st === '출퇴근 기타' && <div className="sf-field"><span /><div className="sf-pills">
        <button type="button" aria-pressed={etc === 'two'} onClick={() => setEtc('two')}>2출</button><button type="button" aria-pressed={etc === 'free'} onClick={() => setEtc('free')}>직접 입력</button>
        {etc === 'two' ? <small>14:00 – 19:30</small> : <span className="sf-range"><input type="time" value={ts} aria-label="시작" onChange={e => setTs(e.target.value)} /> – <input type="time" value={te} aria-label="종료" onChange={e => setTe(e.target.value)} /></span>}
      </div></div>}
      <p className="sf-hint">{dates.length}일 선택</p>
      {error && <p className="sf-hint is-warn">{error}</p>}
      <div className="sf-modal-foot"><button type="button" className="sf-btn" onClick={onClose}>닫기</button>
        <button type="button" className="sf-btn is-primary" disabled={running} onClick={() => void apply()}>{running && <SavingMark />}적용</button></div>
    </div>
  </div>;
}

const perfCache = new Map<string, PerfRow[]>();
function Performance({ month, data, notify }: { month: string; data: Data; notify: (m: string) => void }) {
  const today = todayLocal();
  const [date, setDate] = useState(() => (today.slice(0, 7) === month ? today : `${month}-01`));
  useEffect(() => { setDate(d => (d.slice(0, 7) === month ? d : today.slice(0, 7) === month ? today : `${month}-01`)); }, [month, today]);
  const [rows, setRows] = useState<PerfRow[] | null>(null);
  const [detail, setDetail] = useState<PerfRow | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const loadPerf = useCallback(async () => { try { const r = await staffGet('/performance', { month, include_retired: 0 }); perfCache.set(month, r); setRows(r); } catch { setRows(perfCache.get(month) || []); } }, [month]);
  useEffect(() => { setRows(perfCache.get(month) || null); void loadPerf(); }, [loadPerf, month]);
  // 다른 화면(직원연차 등)에서 바꾼 값도 성과표에 바로 반영
  useEffect(() => { const on = () => void loadPerf(); window.addEventListener('staff-data-changed', on); return () => window.removeEventListener('staff-data-changed', on); }, [loadPerf]);
  const { staff, all } = data;
  const recOf = (sid: number) => (all[sid]?.attendance || []).find(r => r.work_date === date) || null;
  const list = staff.filter(s => s.status !== 'retired' && !(s.hire_date && s.hire_date > date));
  const saveCell = async (s: StaffMember, field: 'managed_count' | 'designated_count', raw: string) => {
    const r = recOf(s.id); if (!r) return;
    const v = raw.trim();
    if (v !== '' && !(Number.isFinite(Number(v)) && Number(v) >= 0)) { notify('0 이상의 숫자로 입력하세요'); return; }
    const val = v === '' ? null : Number(v);
    if (val === (r[field] ?? null)) return;
    try { await staffPost('/attendance', payloadFor(s, date, r, { [field]: val })); setSaved(s.id); await data.reload(true); void loadPerf(); }
    catch (e) { notify(e instanceof Error ? e.message : '저장 실패'); }
  };
  // 풀상담일(팀장 '상담'): 그날은 팀장·직원 모두 관리 인원을 받지 않는다(지정 환자 수는 기록만)
  const leaderId = staff.find(x => x.is_leader)?.id;
  const fullConsult = leaderId != null && recOf(leaderId)?.attendance === '상담';
  // 팀장이 근무하지 않은 날(휴무·연차 등)은 직원 관리 인원을 받지 않는다. 팀장 근태가 아직 없으면 막지 않는다
  const leaderRec = leaderId != null ? recOf(leaderId) : null;
  const leaderOff = !!leaderRec && !(leaderRec.attendance === '정상근무' || isTimeEtc(leaderRec)) && leaderRec.attendance !== '상담';
  // 본인이 휴무·연차·휴일이면 지정 환자 수도 닫는다(팀장·직원 공통)
  // 빨간 날은 병원 휴무 — 관리수·지정 환자 수 모두 닫음(2026-11-11 사용자)
  const can = (r: AttendanceRecord, field: string, s: StaffMember) => isRedDay(date) ? false : field === 'managed_count'
    ? !fullConsult && !(leaderOff && !s.is_leader) && (r.attendance === '정상근무' || isTimeEtc(r))
    : !((r.attendance === '기타' && r.etc_type === 'unpaid') || ['병원휴무', '휴무', '연차', '공휴일'].includes(r.attendance));
  const n = daysInMonth(month);
  const dash = (v: unknown, unit = '') => (v == null || v === '' ? '—' : `${v}${unit}`);
  return <div className="sf-perf">
    <section className="sf-perf-in">
    <div className="sf-perf-head"><h3>날짜별 입력</h3>
      <select className="sf-select" value={date} aria-label="날짜" onChange={e => setDate(e.target.value)}>
        {Array.from({ length: n }, (_, i) => { const d = dateIn(month, i + 1); return <option key={d} value={d}>{dayLabelKo(d)}</option>; })}
      </select></div>
    <table className="sf-table">
      <thead><tr><th>직원</th><th className="num">관리수<br /><small>지정 포함</small></th><th className="num">지정 환자 수</th><th /></tr></thead>
      <tbody>{list.map(s => { const r = recOf(s.id); return <tr key={s.id}>
        <td><b>{s.name}</b> <small>{r ? stateOf(r) : '스케줄 없음'}</small></td>
        {(['managed_count', 'designated_count'] as const).map(f => <td key={f} className="num">{r && can(r, f, s)
          ? <input key={`${date}-${r[f]}`} type="number" min={0} inputMode="numeric" className="sf-num" defaultValue={r[f] ?? ''} aria-label={`${s.name} ${f === 'managed_count' ? '관리수' : '지정 환자 수'}`}
            onBlur={e => void saveCell(s, f, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          : <small>{f === 'managed_count' && r && fullConsult && (s.is_leader || r.attendance === '정상근무' || isTimeEtc(r)) ? '풀상담일 · 관리실적 제외' : '—'}</small>}</td>)}
        <td><small>{saved === s.id ? '저장됨' : ''}</small></td>
      </tr>; })}</tbody>
    </table>
    </section>
    <section className="sf-perf-out">
    <h3 className="sf-perf-title">{monthLabel(month)} 성과</h3>
    {rows == null ? <LoadingBox /> : !rows.length ? <p className="sf-hint">해당 월 성과 데이터가 없습니다</p> :
      <table className="sf-table is-click">
        <thead><tr><th>직원</th><th className="num">실근무시간</th><th className="num">관리수<br /><small>지정 포함</small></th><th className="num">시간당 관리수</th><th className="num">지정 환자 수</th><th className="num">잔여연차</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id} onClick={() => setDetail(r)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') setDetail(r); }}>
          <td><b>{r.name}</b></td><td className="num">{dash(r.total_hours, '시간')}</td><td className="num">{dash(r.total_managed, '명')}</td>
          <td className="num">{dash(r.avg_managed, '명')}</td><td className="num">{dash(r.total_designated, '명')}</td>
          <td className={`num${(r.remain_leave ?? 0) < 0 ? ' is-warn' : ''}`}>{dash(r.remain_leave, '개')}</td></tr>)}</tbody>
      </table>}
    </section>
    {detail && <div className="sf-modal" role="dialog" aria-modal="true" aria-label={`${detail.name} 세부 근태`}>
      <div className="sf-modal-back" onClick={() => setDetail(null)} />
      <div className="sf-modal-panel">
        <div className="sf-modal-head"><strong>{detail.name} · {Number(month.slice(5))}월 세부 근태</strong><button type="button" aria-label="닫기" onClick={() => setDetail(null)}>×</button></div>
        <dl className="sf-dl"><dt>근무일</dt><dd>{dash(detail.work_days, '일')}</dd><dt>실근무시간</dt><dd>{dash(detail.total_hours, '시간')}</dd><dt>이달 사용연차</dt><dd>{dash(detail.leave_used, '개')}</dd><dt>잔여연차</dt><dd>{dash(detail.remain_leave, '개')}</dd></dl>
        <p className="sf-sub">성과 확인 사유</p>
        {detail.exclusions?.length ? <ul className="sf-list">{detail.exclusions.map(e => <li key={e.date + e.reason}><span>{Number(e.date.slice(5, 7))}/{Number(e.date.slice(8))}</span>{e.reason}</li>)}</ul> : <p className="sf-hint">성과 확인이 필요한 사유가 없습니다</p>}
      </div>
    </div>}
  </div>;
}

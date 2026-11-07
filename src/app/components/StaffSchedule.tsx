import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoadingBox, SavingMark } from './Feedback';
import { staffGet, staffPost, StaffApiError } from '../staffApi';
import {
  type AttendanceRecord, type MonthData, type StaffMember, WEEKDAYS, WORK_STATES, ST_LEADER, ST_STAFF, calendarLines, dateIn, dayLabelKo, daysInMonth, diffMin,
  isReadonly, isTimeEtc, leaveCumulative, losesManaged, monthLabel, optionsFor, payloadFor, shiftMonth, stateOf, statePatch, stdTime, todayLocal, weekdayOf,
} from '../staffRules';

// 직원스케줄/성과표 — 예전 재고관리 앱의 직원 달력(스케줄)과 성과 입력을 그대로 옮긴 화면.
// 상태를 고르면 바로 저장한다(예전 앱과 같은 저장값, 서버 계산 그대로).
type PerfRow = { id: number; name: string; status?: string; total_hours: number | null; total_managed: number | null; avg_managed: number | null; total_designated: number | null; remain_leave: number | null; work_days?: number; leave_used?: number; exclusions?: { date: string; reason: string }[] };

export function useStaffMonth(month: string) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [all, setAll] = useState<Record<number, MonthData>>({});
  const [cum, setCum] = useState<Record<string, Record<string, number>>>({});
  const [state, setState] = useState<{ loading: boolean; error: string; unavailable: boolean; detail?: string }>({ loading: true, error: '', unavailable: false });
  const seq = useRef(0);
  const load = useCallback(async (quiet = false) => {
    const n = ++seq.current;
    if (!quiet) setState(s => ({ ...s, loading: true }));
    try {
      const list: StaffMember[] = await staffGet('/list', { include_retired: 0 });
      const months: Record<number, MonthData> = {};
      for (const s of list) months[s.id] = await staffGet('/month', { staff_id: s.id, month }); // 예전 앱처럼 차례로 읽는다
      let c = {};
      try { c = leaveCumulative((await staffGet('/leave-dates', { year: month.slice(0, 4) })).leave_dates || {}); } catch { /* 누적 표기만 빠짐 */ }
      if (n !== seq.current) return;
      setStaff(list); setAll(months); setCum(c); setState({ loading: false, error: '', unavailable: false });
    } catch (e) {
      if (n !== seq.current) return;
      setState({ loading: false, error: e instanceof Error ? e.message : '불러오지 못했어요.', unavailable: e instanceof StaffApiError && e.unavailable, detail: e instanceof StaffApiError ? e.detail : '' });
    }
  }, [month]);
  useEffect(() => { void load(); const on = () => void load(); window.addEventListener('staff-data-changed', on); return () => window.removeEventListener('staff-data-changed', on); }, [load]);
  return { staff, setStaff, all, cum, ...state, reload: load };
}

export function StaffUnavailable({ message, unavailable, detail }: { message: string; unavailable: boolean; detail?: string }) {
  return <div className="pending-screen"><strong>{unavailable ? '직원 자료 연결 전' : '불러오지 못했어요'}</strong>
    <p>{message}</p>
    {unavailable && <small>예전 재고관리 앱의 데이터베이스를 이 사이트에 연결하면 바로 보여요.</small>}
    {detail && <pre className="sf-detail">{detail}</pre>}</div>;
}

export default function StaffSchedule() {
  const [tab, setTab] = useState<'schedule' | 'perf'>('schedule');
  const [month, setMonth] = useState(() => todayLocal().slice(0, 7));
  const data = useStaffMonth(month);
  const [toast, setToast] = useState('');
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2200); return () => clearTimeout(t); }, [toast]);
  return <div className="sf-wrap">
    <div className="sf-bar">
      <div className="sf-month">
        <button type="button" aria-label="이전 달" onClick={() => setMonth(m => shiftMonth(m, -1))}>‹</button>
        <strong>{monthLabel(month)}</strong>
        <button type="button" aria-label="다음 달" onClick={() => setMonth(m => shiftMonth(m, 1))}>›</button>
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
  const [pending, setPending] = useState<{ sid: number; patch: Partial<AttendanceRecord> } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [bulk, setBulk] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const { staff, all, cum } = data;
  const recOf = useCallback((sid: number, date: string) => (all[sid]?.attendance || []).find(r => r.work_date === date) || null, [all]);
  const leader = staff.find(s => s.is_leader);
  const dayStatus = all[staff[0]?.id]?.day_status || [];
  const clinicOff = (date: string) => dayStatus.some(r => r.work_date === date && r.status === 'clinic_off');
  const isHoliday = (date: string) => clinicOff(date) || (!!leader && ['공휴일', '병원휴무'].includes(recOf(leader.id, date)?.attendance || ''));

  const save = async (s: StaffMember, date: string, patch: Partial<AttendanceRecord>, msg = '저장되었습니다') => {
    setBusy(s.id);
    try { await staffPost('/attendance', payloadFor(s, date, recOf(s.id, date), patch)); notify(msg); setPending(null); await data.reload(true); }
    catch (e) { notify(e instanceof Error ? e.message : '저장 실패'); }
    finally { setBusy(null); }
  };
  const choose = (s: StaffMember, st: string) => {
    const rec = recOf(s.id, sel);
    if (stateOf(rec) === st) return;
    const patch = statePatch(st, s, sel, rec);
    if (losesManaged(rec, patch)) { setPending({ sid: s.id, patch }); return; }
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
          return <button key={date} type="button" className={`sf-day${date === sel ? ' is-sel' : ''}${date === today ? ' is-today' : ''}${weekdayOf(date) === 0 ? ' is-sun' : ''}`} aria-pressed={date === sel} onClick={() => { setSel(date); setPending(null); setConfirmClear(false); }}>
            <span className="sf-dn">{i + 1}</span>
            {cell.all ? <span className="sf-ev is-hol">휴일</span> : cell.lines.map(l => <span key={l.sid} className={`sf-ev is-${l.kind}`}><b>{l.name}</b> {l.label}</span>)}
            {cell.none > 0 && <span className="sf-ev is-none">미입력 {cell.none}</span>}
          </button>;
        })}
        {Array.from({ length: tail }, (_, i) => <span key={`z${i}`} className="sf-day is-blank" />)}
      </div>
    </div>
    <div className="sf-side">
      <div className="sf-dhead"><h3>{dayLabelKo(sel)}</h3>
        <button type="button" className="sf-btn" onClick={() => setBulk(true)}>일괄 설정</button></div>
      {off && <div className="sf-confirm">{confirmClear ? <>이 날짜의 휴일을 해제할까요?
        <span><button type="button" className="sf-btn" onClick={() => setConfirmClear(false)}>취소</button>
          <button type="button" className="sf-btn is-primary" onClick={async () => { try { await staffPost('/day-status', { work_date: sel, clear: true }); setConfirmClear(false); await data.reload(true); } catch (e) { notify(e instanceof Error ? e.message : '휴무 해제 실패'); } }}>해제</button></span></>
        : <>병원 휴일로 정해진 날이에요. <button type="button" className="sf-btn" onClick={() => setConfirmClear(true)}>휴일 해제</button></>}</div>}
      {list.map(s => {
        const rec = recOf(s.id, sel), st = stateOf(rec), locked = isReadonly(s, sel) || off, opts = optionsFor(s);
        if (WORK_STATES.includes(st || '')) working++;
        const cur = st || (isHoliday(sel) ? '휴일' : '');
        const blank = isReadonly(s, sel) ? '퇴사' : sel <= today && weekdayOf(sel) !== 0 ? '미입력' : '-';
        return <div key={s.id} className="sf-srow">
          <div className="sf-sline"><b>{s.name}</b>{s.is_leader ? <small>팀장</small> : null}
            {busy === s.id && <SavingMark />}
            <select className={`sf-select${st && st !== '정상근무' ? ' is-ch' : ''}${!cur ? ' is-none' : ''}`} value={cur} disabled={locked || busy === s.id} aria-label={`${s.name} 상태`} onChange={e => choose(s, e.target.value)}>
              {!cur && <option value="" disabled>{blank}</option>}
              {cur && !opts.includes(cur) && <option value={cur} disabled>{cur}</option>}
              {opts.map(x => <option key={x} value={x}>{x}</option>)}
            </select></div>
          {pending?.sid === s.id && <div className="sf-confirm">관리 인원({rec?.managed_count}명)이 비워집니다. 바꿀까요?
            <span><button type="button" className="sf-btn" onClick={() => setPending(null)}>취소</button><button type="button" className="sf-btn is-primary" onClick={() => void save(s, sel, pending.patch)}>변경</button></span></div>}
          {st === '출퇴근 기타' && !locked && rec && <EtcTimes key={`${sel}-${rec.start_time}-${rec.end_time}-${rec.memo}`} rec={rec} date={sel} onSave={(patch, msg) => void save(s, sel, patch, msg)} />}
          {st === '2출' && <p className="sf-hint">14:00 – 19:30</p>}
        </div>;
      })}
      <div className="sf-sum">출근 {working} / {list.length}</div>
    </div>
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
    const over = targets.filter(d => recs[d]).length, lose = targets.filter(d => losesManaged(recs[d] || null, statePatch(finalSt, s, d, recs[d] || null, times))).length;
    setAsk(`${targets.length}일에 '${finalSt === '2출' ? '출퇴근 기타 · 2출' : finalSt}' 적용${over ? ` · 기존 기록 ${over}건 바뀜` : ''}${lose ? ` · 관리 인원 ${lose}건 비워짐` : ''}${dates.length > targets.length ? ` · 휴일 ${dates.length - targets.length}일 제외` : ''}`);
    return { targets, recs };
  };
  const apply = async () => {
    if (!s || !finalSt) return;
    setRunning(true);
    const p = await plan(); if (!p) { setRunning(false); return; }
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
      {ask && <p className="sf-ask">{ask}</p>}
      <div className="sf-modal-foot"><button type="button" className="sf-btn" onClick={onClose}>닫기</button>
        {ask ? <button type="button" className="sf-btn is-primary" disabled={running} onClick={() => void apply()}>{running && <SavingMark />}적용</button>
          : <button type="button" className="sf-btn is-primary" onClick={() => void plan()}>확인</button>}</div>
    </div>
  </div>;
}

function Performance({ month, data, notify }: { month: string; data: Data; notify: (m: string) => void }) {
  const today = todayLocal();
  const [date, setDate] = useState(() => (today.slice(0, 7) === month ? today : `${month}-01`));
  useEffect(() => { setDate(d => (d.slice(0, 7) === month ? d : today.slice(0, 7) === month ? today : `${month}-01`)); }, [month, today]);
  const [rows, setRows] = useState<PerfRow[] | null>(null);
  const [detail, setDetail] = useState<PerfRow | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const loadPerf = useCallback(async () => { try { setRows(await staffGet('/performance', { month, include_retired: 0 })); } catch { setRows([]); } }, [month]);
  useEffect(() => { setRows(null); void loadPerf(); }, [loadPerf]);
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
  const can = (r: AttendanceRecord, field: string) => field === 'managed_count' ? (r.attendance === '정상근무' || isTimeEtc(r)) : !((r.attendance === '기타' && r.etc_type === 'unpaid') || r.attendance === '병원휴무');
  const n = daysInMonth(month);
  const dash = (v: unknown, unit = '') => (v == null || v === '' ? '-' : `${v}${unit}`);
  return <div className="sf-perf">
    <div className="sf-perf-head"><h3>날짜별 입력</h3>
      <select className="sf-select" value={date} aria-label="날짜" onChange={e => setDate(e.target.value)}>
        {Array.from({ length: n }, (_, i) => { const d = dateIn(month, i + 1); return <option key={d} value={d}>{dayLabelKo(d)}</option>; })}
      </select></div>
    <table className="sf-table">
      <thead><tr><th>직원</th><th className="num">관리 인원</th><th className="num">지정 환자 수</th><th /></tr></thead>
      <tbody>{list.map(s => { const r = recOf(s.id); return <tr key={s.id}>
        <td><b>{s.name}</b> <small>{r ? stateOf(r) : '스케줄 없음'}</small></td>
        {(['managed_count', 'designated_count'] as const).map(f => <td key={f} className="num">{r && can(r, f)
          ? <input key={`${date}-${r[f]}`} type="number" min={0} inputMode="numeric" className="sf-num" defaultValue={r[f] ?? ''} aria-label={`${s.name} ${f === 'managed_count' ? '관리 인원' : '지정 환자 수'}`}
            onBlur={e => void saveCell(s, f, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          : <small>—</small>}</td>)}
        <td><small>{saved === s.id ? '저장됨' : ''}</small></td>
      </tr>; })}</tbody>
    </table>
    <h3 className="sf-perf-title">{monthLabel(month)} 성과</h3>
    {rows == null ? <LoadingBox /> : !rows.length ? <p className="sf-hint">해당 월 성과 데이터가 없습니다</p> :
      <table className="sf-table is-click">
        <thead><tr><th>직원</th><th className="num">실근무시간</th><th className="num">관리수</th><th className="num">시간당 관리수</th><th className="num">지정 수</th><th className="num">잔여 연차</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id} onClick={() => setDetail(r)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') setDetail(r); }}>
          <td><b>{r.name}</b></td><td className="num">{dash(r.total_hours, '시간')}</td><td className="num">{dash(r.total_managed, '명')}</td>
          <td className="num">{dash(r.avg_managed, '명')}</td><td className="num">{dash(r.total_designated, '명')}</td>
          <td className={`num${(r.remain_leave ?? 0) < 0 ? ' is-warn' : ''}`}>{dash(r.remain_leave, '개')}</td></tr>)}</tbody>
      </table>}
    {detail && <div className="sf-modal" role="dialog" aria-modal="true" aria-label={`${detail.name} 세부 근태`}>
      <div className="sf-modal-back" onClick={() => setDetail(null)} />
      <div className="sf-modal-panel">
        <div className="sf-modal-head"><strong>{detail.name} · {Number(month.slice(5))}월 세부 근태</strong><button type="button" aria-label="닫기" onClick={() => setDetail(null)}>×</button></div>
        <dl className="sf-dl"><dt>근무일</dt><dd>{dash(detail.work_days, '일')}</dd><dt>실근무시간</dt><dd>{dash(detail.total_hours, '시간')}</dd><dt>이달 연차 사용</dt><dd>{dash(detail.leave_used, '개')}</dd><dt>잔여 연차</dt><dd>{dash(detail.remain_leave, '개')}</dd></dl>
        <p className="sf-sub">성과 확인 사유</p>
        {detail.exclusions?.length ? <ul className="sf-list">{detail.exclusions.map(e => <li key={e.date + e.reason}><span>{Number(e.date.slice(5, 7))}/{Number(e.date.slice(8))}</span>{e.reason}</li>)}</ul> : <p className="sf-hint">성과 확인이 필요한 사유가 없습니다</p>}
      </div>
    </div>}
  </div>;
}

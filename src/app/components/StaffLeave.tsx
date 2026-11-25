import { CalendarCheck, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Layers, Pencil } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { LoadingBox, SavingMark } from './Feedback';
import { OldDataBanner } from './Inventory';
import { StaffUnavailable } from './StaffSchedule';
import { toneOf, vividOf } from './staffTone';
import { staffGet, staffPost, StaffApiError } from '../staffApi';
import { runUseFix } from '../leaveFixFlow';
import { type MonthData, type StaffMember, WEEKDAYS, dateIn, daysInMonth, isRedDay, leaveCumulative, leavePeriodStart, leaveSeq, monthLabel, optionsFor, payloadFor, shiftMonth, statePatch, todayLocal, weekdayOf } from '../staffRules';

// 직원연차 — 직원마다 자기 달력에 연차 날짜(순번 n/총)를 표시하고, 위에 지급연차 / 사용연차 / 잔여연차(누적, 월별 아님)를 보인다(2026-11-08 사용자 지정).
// 연차 사용/되돌림은 직원스케줄 달력에서 '연차'를 고르면 서버가 처리한다(예전 앱과 같음).
const LEAVE_REASONS = ['포상 연차 지급', '재계약 연차 재세팅', '연차 촉진 초기화', '행정 오류 수정', '신입 연차 당겨쓰기', '직접 입력'];
const LOG_TYPE: Record<string, string> = { use: '연차 사용', revert: '사용 되돌림', adjust: '수동 수정', grant: '월 지급연차', convert: '정직원 전환', fix: '정정', pending: '미리 등록' };
type LeaveLog = { id: number; log_type: string; log_date?: string | null; amount?: number | null; reason?: string | null; memo?: string | null; before_total?: number | null; after_total?: number | null; before_used?: number | null; after_used?: number | null; after_remain?: number | null; editor?: string | null; created_at?: string; cancelled_at?: string | null; cancel_reason?: string | null; ref_id?: number | null; remain_now?: number; can_fix?: boolean };

export default function StaffLeave({ tabs, hide = false }: { tabs?: React.ReactNode; hide?: boolean } = {}) {
  const [month, setMonth] = useState(() => todayLocal().slice(0, 7));
  const year = month.slice(0, 4);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [dates, setDates] = useState<Record<string, string[]>>({});
  const [bases, setBases] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<StaffMember | null>(null);
  const [state, setState] = useState({ loading: true, error: '', unavailable: false, detail: '' });
  const load = useCallback(async () => {
    try {
      const [list, ld] = await Promise.all([staffGet('/list', { include_retired: 0 }), staffGet('/leave-dates', { year })]);
      setStaff(list); setDates(ld.leave_dates || {}); setBases(ld.leave_bases || {}); setState({ loading: false, error: '', unavailable: false, detail: '' });
    } catch (e) { setState({ loading: false, error: e instanceof Error ? e.message : '불러오지 못했어요.', unavailable: e instanceof StaffApiError && e.unavailable, detail: e instanceof StaffApiError ? e.detail : '' }); }
  }, [year]);
  useEffect(() => { void load(); const on = () => void load(); window.addEventListener('staff-data-changed', on); return () => window.removeEventListener('staff-data-changed', on); }, [load]);
  if ((state.loading && !staff.length) || state.error) return hide ? null : <div className="sf-wrap sf-leave">{tabs}
    {state.error ? <StaffUnavailable message={state.error} unavailable={state.unavailable} detail={state.detail} /> : <LoadingBox />}</div>;
  const today = todayLocal(), n = daysInMonth(month), lead = weekdayOf(`${month}-01`); // 달력은 늘 6줄(42칸)로 그려 달마다 카드 높이가 같게
  return <div className="sf-wrap sf-leave" hidden={hide}>
    {tabs}
    <OldDataBanner />
    <div className="sf-bar">
      <div className="sf-month">
        <button type="button" aria-label="이전 달" onClick={() => setMonth(m => shiftMonth(m, -1))}><ChevronLeft size={18} strokeWidth={2} /></button>
        <strong>{monthLabel(month)}</strong>
        <button type="button" aria-label="다음 달" onClick={() => setMonth(m => shiftMonth(m, 1))}><ChevronRight size={18} strokeWidth={2} /></button>
        <button type="button" className="sf-today" onClick={() => setMonth(todayLocal().slice(0, 7))}>이번 달</button>
      </div>
    </div>
    <div className="lv-grid">{staff.map(x => {
      const base = bases[String(x.id)] || null;
      const every = (dates[String(x.id)] || []).slice().sort();
      const idx = leaveCumulative({ [x.id]: every }, { [x.id]: base })[String(x.id)] || {};
      const key = leavePeriodStart(base, `${month}-01`); // 보고 있는 달의 기간(기준일이 없으면 그 해)
      const all = every.filter(d => leavePeriodStart(base, d) === key);
      const mine = new Set(every);
      const remain = x.remain_leave ?? (x.total_leave ?? 0) - (x.used_leave ?? 0);
      const [ink, tint, line] = toneOf(x.id), [vInk, vTint, vLine] = vividOf(x.id);
      return <section key={x.id} className="lv-card" style={{ '--c': ink, '--c-bg': tint, '--c-line': line, '--cv': vInk, '--cv-bg': vTint, '--cv-line': vLine } as React.CSSProperties}>
        <div className="lv-top">
          <strong className="lv-name" title={x.name}>{x.name.length >= 3 ? x.name.slice(1) : x.name}</strong>
          <div className="lv-sum" aria-label={`${x.name} 연차`}>
            <div><span>지급연차</span><b>{x.total_leave ?? '-'}</b></div>
            <div><span>사용연차</span><b>{x.used_leave ?? '-'}</b></div>
            <div className="lv-rest"><span>잔여연차</span><b className={remain < 0 ? 'is-warn' : ''}>{remain}</b></div>
          </div>
        </div>
        <div className="lv-cal">{WEEKDAYS.map((w, k) => <i key={w} className={k === 0 ? 'is-sun' : k === 6 ? 'is-sat' : ''}>{w}</i>)}
          {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
          {Array.from({ length: n }, (_, d) => {
            const date = dateIn(month, d + 1), on = mine.has(date), wd = weekdayOf(date);
            const seq = on ? `${leaveSeq(x, idx, date)}/${x.total_leave ?? '-'}` : '';
            return <span key={date} className={`${on ? 'is-leave' : ''}${date === today ? ' is-today' : ''}${isRedDay(date) ? ' is-sun' : wd === 6 ? ' is-sat' : ''}`} title={on ? `${date} 연차 ${seq}` : undefined}>
              <b>{d + 1}</b>{on && <em>{seq}</em>}</span>;
          })}
          {Array.from({ length: 42 - lead - n }, (_, i) => <span key={`a${i}`} aria-hidden="true" />)}
        </div>
        <div className="lv-list">
          <div className="lv-list-head"><p>{base ? `${Number(key.slice(5, 7))}/${Number(key.slice(8))}부터` : `${month.slice(0, 4)}년`} 사용 내역 <b>{all.length}일</b></p><button type="button" className="lv-link" onClick={() => setOpen(x)}>이력·수정</button></div>
          {all.length ? <ul className="lv-tags">{all.map(d => <li key={d}><button type="button" className={d.slice(0, 7) === month ? 'is-here' : ''} onClick={() => setMonth(d.slice(0, 7))} title="이 달 달력 보기">
            {Number(d.slice(5, 7))}/{Number(d.slice(8))}<small>{WEEKDAYS[weekdayOf(d)]}</small><span className="lv-seq" aria-label={`${`${leaveSeq(x, idx, d)}/${x.total_leave ?? '-'}`.split('/')[0]}번째`}>{`${leaveSeq(x, idx, d)}/${x.total_leave ?? '-'}`.split('/')[0]}</span></button></li>)}</ul>
            : <p className="lv-none">아직 사용한 연차가 없어요</p>}
        </div>
      </section>;
    })}</div>
    {open && <LeaveDetail staff={open} base={bases[String(open.id)] || null} dates={dates[String(open.id)] || []} onClose={() => setOpen(null)} onSaved={async () => { setOpen(null); await load(); }} />}
  </div>;
}

// 연차 이력 · 수정·취소(2026-11-20 사용자 지정): 기록은 지우지 않고 그 줄 아래에서 바로 고친다(창 하나).
// 지급 = 지급일·지급일수 / 사용 = 사용일(사용일수는 1일 고정, 2026-11-20 사용자 2-가) / 수동 수정 = 지급·사용연차 수치 — 각각 수정·취소.
// 취소된 기록·정정 줄은 다시 고칠 수 없음. 저장 전에 변경 전후 지급·사용·잔여를 보여 주고, 잔여는 서버가 다시 계산(뒤 줄 잔여도 remain_now로 같이 바뀜).
// 연차 사용 수정·취소는 직원스케줄과 같은 길(POST /attendance)로 그날 근태를 먼저 바꾼 뒤(사용자 1-나: 바꿀 근태를 고름) 기록에 표시.
type FixMode = { id: number; kind: 'edit' | 'cancel' };
const KIND_CHIP: Record<string, [string, string]> = { grant: ['지급', 'g'], use: ['사용', 'u'], revert: ['되돌림', 'c'], adjust: ['수동 수정', 'a'], fix: ['정정', 'f'], convert: ['전환', 'a'], pending: ['미리 등록', 'c'] };
const mdDay = (d?: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '');
const dayOf = (l: LeaveLog) => l.log_date || (l.created_at || '').slice(0, 10);
function logTitle(l: LeaveLog) {
  if (l.log_type === 'grant') return `${mdDay(dayOf(l))} · ${l.amount ?? 0}일`;
  if (l.log_type === 'use' || l.log_type === 'revert' || l.log_type === 'pending') return `${mdDay(l.log_date)}(${WEEKDAYS[weekdayOf(l.log_date || todayLocal())]}) · 1일`;
  if (l.log_type === 'adjust') return [l.before_total !== l.after_total ? `지급연차 ${l.before_total} → ${l.after_total}` : '', l.before_used !== l.after_used ? `사용연차 ${l.before_used} → ${l.after_used}` : ''].filter(Boolean).join(' · ') || '수치 변화 없음';
  if (l.log_type === 'fix') return l.memo || '정정';
  if (l.log_type === 'convert') return `지급연차 ${l.before_total} → ${l.after_total}`;
  return LOG_TYPE[l.log_type] || l.log_type;
}

// 연차 이력 창 v2(2026-11-25 사용자가 그림으로 지정): 위 네 칸(기준일 · 지급 · 사용 · 잔여) → 이번 기간 연차 날짜 줄(순번 · 날짜 · 연차/예정 · 남은 N일 · ›)
// → 지난 기간(접힘) → 수정 기록(접힘) → 아래 '숫자 직접 고치기' · 닫기. 줄을 누르면 그 줄 아래에 [날짜 바꾸기] [연차 아님].
// 색은 앱 청회색(2026-11-26 사용자 '색상은 기존 하늘색 계열, 레이아웃만 그림처럼'). 기준일을 적으면 서버가 해마다 리셋(worker/staff.js applyLeaveReset).
const ymd = (d: string) => `${d.slice(2, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}`;
const dayBefore = (d: string) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
function nextStart(base: string | null, ps: string) { if (!base) return `${Number(ps.slice(0, 4)) + 1}-01-01`; const md = base.slice(5) === '02-29' ? '02-28' : base.slice(5); return `${Number(ps.slice(0, 4)) + 1}-${md}`; }

function LeaveDetail({ staff, base, dates, onClose, onSaved }: { staff: StaffMember; base: string | null; dates: string[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [logs, setLogs] = useState<LeaveLog[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [row, setRow] = useState<{ date: string; kind: 'edit' | 'cancel' | null } | null>(null);
  const [fold, setFold] = useState<'' | 'prev' | 'log'>('');
  const [baseEdit, setBaseEdit] = useState(false), [baseVal, setBaseVal] = useState(base || ''), [baseErr, setBaseErr] = useState(''), [baseBusy, setBaseBusy] = useState(false);
  const [nums, setNums] = useState({ total: staff.total_leave ?? 0, used: staff.used_leave ?? 0 });
  const [logMode, setLogMode] = useState<FixMode | null>(null);
  const load = useCallback(async () => {
    try { setLogs(await staffGet(`/leave-log/${staff.id}`)); } catch { setLogs([]); }
    try { const l = await staffGet('/list') as StaffMember[]; const me = (l || []).find(x => x.id === staff.id); if (me) setNums({ total: me.total_leave ?? 0, used: me.used_leave ?? 0 }); } catch { /* 숫자는 다음에 */ }
  }, [staff.id]);
  useEffect(() => { void load(); }, [load]);
  if (editing) return <LeaveAdjust staff={staff} onClose={() => setEditing(false)} onSaved={onSaved} />;
  const today = todayLocal(), ps = leavePeriodStart(base, today), pe = dayBefore(nextStart(base, ps));
  const years = base ? Number(ps.slice(0, 4)) - Number(base.slice(0, 4)) : null;
  const sorted = dates.slice().sort();
  const cur = sorted.filter(d => leavePeriodStart(base, d) === ps);
  const prevStart = leavePeriodStart(base, dayBefore(ps));
  const prev = sorted.filter(d => d < ps && leavePeriodStart(base, d) === prevStart);
  const future = (d: string) => d.slice(0, 7) > today.slice(0, 7);
  const useLog: Record<string, LeaveLog> = {};
  for (const l of logs || []) if (l.log_type === 'use' && l.can_fix && l.log_date) useLog[l.log_date] = l;
  // 남은 연차: 마지막 연차 줄 = 지금 잔여연차, 예정은 그 뒤로 하나씩 줄어듦
  const R = nums.total - nums.used, k = cur.filter(d => !future(d)).length;
  const remainAt = (i: number) => R + (k - i);
  const prevCx = (logs || []).filter(l => l.log_type === 'use' && l.cancelled_at && l.log_date && l.log_date >= prevStart && l.log_date < ps).length;
  const otherLogs = (logs || []).filter(l => !['use', 'revert', 'pending', 'base'].includes(l.log_type) && !(l.log_type === 'reset' && l.cancelled_at));
  const done = async () => { setRow(null); setLogMode(null); await load(); await onSaved(); };
  const saveBase = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(baseVal)) return setBaseErr('날짜를 골라 주세요');
    setBaseBusy(true); setBaseErr('');
    try { await staffPost(`/leave-base/${staff.id}`, { date: baseVal }); await done(); } catch (e) { setBaseErr(e instanceof Error ? e.message : '저장하지 못했어요'); setBaseBusy(false); }
  };
  const line = (d: string, i: number | null, kind: 'cur' | 'prev') => {
    const fut = future(d), opened = row?.date === d, log = useLog[d];
    return <li key={d} className={opened ? 'is-open' : ''}>
      <button type="button" className="lv2-row" onClick={() => setRow(opened ? null : { date: d, kind: null })} aria-expanded={opened}>
        <span className="lv2-n">{i ?? '·'}</span>
        <span className="lv2-d">{mdDay(d)}<small>{WEEKDAYS[weekdayOf(d)]}</small></span>
        <span className={`lv2-t${fut ? ' is-e' : ''}`}>{fut ? '예정' : '연차'}</span>
        <span className="lv2-r">{kind === 'cur' && i != null ? `남은 ${remainAt(i)}일` : ''}</span>
        <ChevronRight size={16} strokeWidth={1.8} className="lv2-c" />
      </button>
      {opened && <div className="lv2-act">
        {row?.kind == null ? <div className="lv2-act-btns">
          {log && <button type="button" className="sf-btn" onClick={() => setRow({ date: d, kind: 'edit' })}>날짜 바꾸기</button>}
          <button type="button" className="sf-btn" onClick={() => setRow({ date: d, kind: 'cancel' })}>연차 아님</button></div>
          : log ? <LeaveFix key={`${d}${row.kind}`} staff={staff} log={log} kind={row.kind} nums={nums} after={0} onClose={() => setRow(null)} onDone={done} />
            : <LeaveOff staff={staff} date={d} onClose={() => setRow(null)} onDone={done} />}
      </div>}
    </li>;
  };
  return <div className="sf-modal" role="dialog" aria-modal="true" aria-label={`${staff.name} 연차 이력`}>
    <div className="sf-modal-back" onClick={onClose} />
    <div className="sf-modal-panel lv-hist lv2">
      <div className="sf-modal-head"><strong>{staff.name} · 연차 이력</strong><button type="button" aria-label="닫기" onClick={onClose}>×</button></div>
      <div className="lv2-sum">
        <button type="button" className="lv2-base" onClick={() => { setBaseEdit(v => !v); setBaseVal(base || ''); setBaseErr(''); }}>
          <span><CalendarDays size={16} strokeWidth={1.7} />기준일</span><b>{base ? ymd(base) : '—'}</b><small>{years != null ? `(${years}년차)` : '눌러서 적기'}</small></button>
        <div><span><Layers size={16} strokeWidth={1.7} />지급연차</span><b>{nums.total}</b></div>
        <div><span><CheckCircle2 size={16} strokeWidth={1.7} />사용연차</span><b>{nums.used}</b></div>
        <div className="lv2-rest"><span><CalendarCheck size={16} strokeWidth={1.7} />잔여연차</span><b>{R}</b></div>
      </div>
      {baseEdit && <div className="lv2-baseedit">
        <label className="sf-input"><span>기준일</span><input type="date" value={baseVal} max={today} onChange={e => setBaseVal(e.target.value)} /></label>
        <button type="button" className="sf-btn" onClick={() => setBaseEdit(false)}>닫기</button>
        <button type="button" className="sf-btn is-primary" disabled={baseBusy} onClick={() => void saveBase()}>{baseBusy && <SavingMark />}저장</button>
        {baseErr && <p className="sf-hint is-warn">{baseErr}</p>}
      </div>}
      {logs == null ? <LoadingBox /> : <>
        <div className="lv2-sec"><b><CalendarDays size={18} strokeWidth={1.7} />이번 기간</b><span>{ymd(ps)} ~ {ymd(pe)}</span></div>
        <div className="lv2-head" aria-hidden="true"><span>No.</span><span>사용일</span><span>구분</span><span>잔여</span><span /></div>
        {cur.length ? <ul className="lv2-list">{cur.map((d, i) => line(d, i + 1, 'cur'))}</ul> : <p className="lv2-none">기록 없음</p>}
        {prev.length > 0 && <>
          <div className="lv2-sec"><b><CalendarCheck size={18} strokeWidth={1.7} />지난 기간</b><span>{ymd(prevStart)} ~ {ymd(dayBefore(ps))}</span></div>
          <button type="button" className={`lv2-fold${fold === 'prev' ? ' is-open' : ''}`} onClick={() => setFold(f => (f === 'prev' ? '' : 'prev'))} aria-expanded={fold === 'prev'}><span>연차 {prev.length}일{prevCx ? ` · 취소 ${prevCx}` : ''}</span><span>{fold === 'prev' ? '접기' : '펼치기'}<ChevronDown size={15} strokeWidth={1.8} /></span></button>
          {fold === 'prev' && <ul className="lv2-list">{prev.map((d, i) => line(d, i + 1, 'prev'))}</ul>}
        </>}
        {otherLogs.length > 0 && <>
          <button type="button" className={`lv2-fold is-log${fold === 'log' ? ' is-open' : ''}`} onClick={() => setFold(f => (f === 'log' ? '' : 'log'))} aria-expanded={fold === 'log'}><span>수정 기록 {otherLogs.length}건</span><span>{fold === 'log' ? '접기' : '펼치기'}<ChevronDown size={15} strokeWidth={1.8} /></span></button>
          {fold === 'log' && <ul className="lv2-logs">{otherLogs.map(l => { const opened = logMode?.id === l.id;
            const name = l.log_type === 'reset' ? '리셋' : l.cancelled_at ? '취소됨' : (KIND_CHIP[l.log_type] || [LOG_TYPE[l.log_type] || l.log_type])[0];
            const text = l.log_type === 'reset' ? `${mdDay(l.log_date)} · ${l.reason || ''} · 지급 ${l.after_total} · 사용 ${l.after_used}` : logTitle(l);
            return <li key={l.id} className={l.cancelled_at ? 'is-cx' : ''}><div className="lv2-logrow"><span className="lv2-lt">{name}</span><span className="lv2-ltx">{text}</span>
              {l.can_fix && l.log_type !== 'use' && <button type="button" className="lv2-lb" onClick={() => setLogMode(opened ? null : { id: l.id, kind: 'cancel' })}>취소</button>}</div>
              {opened && <LeaveFix key={l.id} staff={staff} log={l} kind="cancel" nums={nums} after={0} onClose={() => setLogMode(null)} onDone={done} />}</li>; })}</ul>}
        </>}
      </>}
      <div className="lv2-foot"><button type="button" className="lv2-adj" onClick={() => setEditing(true)}><Pencil size={17} strokeWidth={1.8} />숫자 직접 고치기</button>
        <button type="button" className="sf-btn lv2-close" onClick={onClose}>닫기</button></div>
    </div>
  </div>;
}

// 고칠 '사용' 기록이 없는 연차 날(예정·예전 앱 자료): 그날 근태만 바꾼다(직원스케줄과 같은 길 — 사용연차는 서버가 맞춤)
function LeaveOff({ staff, date, onClose, onDone }: { staff: StaffMember; date: string; onClose: () => void; onDone: () => Promise<void> }) {
  const states = optionsFor(staff).filter(s => s !== '연차');
  const [state, setState] = useState(states.includes('정상근무') ? '정상근무' : states[0]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    try {
      const rec = (((await staffGet('/month', { staff_id: staff.id, month: date.slice(0, 7) })) as MonthData).attendance || []).find(r => r.work_date === date) || null;
      await staffPost('/attendance', payloadFor(staff, date, rec, statePatch(state, staff, date, rec)));
      await onDone();
    } catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했어요'); setBusy(false); }
  };
  return <div className="lv-fix">
    <label className="sf-input"><span>{mdDay(date)} 근태</span><select value={state} onChange={e => setState(e.target.value)}>{states.map(s => <option key={s}>{s}</option>)}</select></label>
    {error && <p className="sf-hint is-warn">{error}</p>}
    <div className="lv-fix-foot"><button type="button" className="sf-btn" onClick={onClose}>닫기</button>
      <button type="button" className="sf-btn is-primary" disabled={busy} onClick={() => void save()}>{busy && <SavingMark />}저장</button></div>
  </div>;
}

function LeaveFix({ staff, log, kind, nums, after, onClose, onDone }: { staff: StaffMember; log: LeaveLog; kind: 'edit' | 'cancel'; nums: { total: number; used: number }; after: number; onClose: () => void; onDone: () => Promise<void> }) {
  const T = nums.total, U = nums.used;
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(log.log_type === 'grant' ? dayOf(log) : log.log_date || todayLocal());
  const [amount, setAmount] = useState(String(log.amount ?? 1));
  const [at, setAt] = useState(String(log.after_total ?? T)), [au, setAu] = useState(String(log.after_used ?? U));
  const states = optionsFor(staff).filter(s => s !== '연차');
  const [state, setState] = useState(states.includes('정상근무') ? '정상근무' : states[0]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  // 변경 후 숫자(서버와 같은 계산: 지금 값에 차이만)
  let nT = T, nU = U;
  const dT = (log.after_total ?? 0) - (log.before_total ?? 0), dU = (log.after_used ?? 0) - (log.before_used ?? 0);
  if (log.log_type === 'grant') nT = kind === 'cancel' ? T - (log.amount ?? 0) : T + ((Number(amount) || 0) - (log.amount ?? 0));
  if (log.log_type === 'adjust') { if (kind === 'cancel') { nT = T - dT; nU = U - dU; } else { nT = T + ((Number(at) - (log.before_total ?? 0)) - dT); nU = U + ((Number(au) - (log.before_used ?? 0)) - dU); } }
  if (log.log_type === 'use' && kind === 'cancel') nU = U - 1;
  const bad = nT < 0 || nU < 0 || (nT - nU < 0 && nT - nU < T - U);
  const recOf = async (d: string) => (((await staffGet('/month', { staff_id: staff.id, month: d.slice(0, 7) })) as MonthData).attendance || []).find(r => r.work_date === d) || null;
  const save = async () => {
    if (!reason.trim()) return setError('사유를 적어 주세요');
    setBusy(true); setError('');
    try {
      if (log.log_type === 'use') {
        await runUseFix({ rec: recOf, post: staffPost }, staff, { logId: log.id, from: log.log_date!, kind, date, state, reason: reason.trim() });
      } else {
        await staffPost(`/leave-fix/${log.id}`, { action: kind, reason: reason.trim(), date, amount: Number(amount), total: Number(at), used: Number(au) });
      }
      await onDone();
    } catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했어요'); setBusy(false); }
  };
  const isUse = log.log_type === 'use';
  return <div className="lv-fix">
    {kind === 'edit' && log.log_type === 'grant' && <div className="lv-fix-2"><label className="sf-input"><span>지급일</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="sf-input"><span>지급일수</span><input type="number" min={1} step={1} inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} /></label></div>}
    {kind === 'edit' && log.log_type === 'adjust' && <div className="lv-fix-2"><label className="sf-input"><span>지급연차</span><input type="number" min={0} step={1} inputMode="numeric" value={at} onChange={e => setAt(e.target.value)} /></label>
      <label className="sf-input"><span>사용연차</span><input type="number" min={0} step={1} inputMode="numeric" value={au} onChange={e => setAu(e.target.value)} /></label></div>}
    {isUse && <div className="lv-fix-2">
      {kind === 'edit' && <label className="sf-input"><span>사용일</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>}
      <label className="sf-input"><span>{mdDay(log.log_date)} 근태</span><select value={state} onChange={e => setState(e.target.value)}>{states.map(s => <option key={s}>{s}</option>)}</select></label></div>}
    <label className="sf-input"><span>{kind === 'cancel' ? '취소 사유' : '수정 사유'}</span><input value={reason} onChange={e => setReason(e.target.value)} placeholder="사유" /></label>
    <table className="lv-fix-tbl"><thead><tr><th /><th>지급연차</th><th>사용연차</th><th>잔여연차</th></tr></thead>
      <tbody><tr><td>{kind === 'cancel' ? '취소 전' : '수정 전'}</td><td>{T}</td><td>{U}</td><td>{T - U}</td></tr>
        <tr><td>{kind === 'cancel' ? '취소 후' : '수정 후'}</td><td className={nT !== T ? 'is-ch' : ''}>{nT}</td><td className={nU !== U ? 'is-ch' : ''}>{nU}</td><td className={nT - nU !== T - U ? 'is-ch' : ''}>{nT - nU}</td></tr></tbody></table>
    {isUse && <p className="lv-fix-note">스케줄 <b>{mdDay(log.log_date)} 연차 → {state}</b>{kind === 'edit' && date !== log.log_date ? <> · <b>{mdDay(date)} 연차</b></> : null}</p>}
    {after > 0 && (nT !== T || nU !== U) && <p className="lv-fix-note">이후 기록 <b>{after}건</b> 잔여연차 다시 계산</p>}
    {bad && <p className="sf-hint is-warn">잔여연차가 0보다 적어져요</p>}
    {error && <p className="sf-hint is-warn">{error}</p>}
    <div className="lv-fix-foot"><button type="button" className="sf-btn" onClick={onClose}>닫기</button>
      <button type="button" className={`sf-btn ${kind === 'cancel' ? 'is-danger' : 'is-primary'}`} disabled={busy || bad} onClick={() => void save()}>{busy && <SavingMark />}{kind === 'cancel' ? '취소하기' : '저장'}</button></div>
  </div>;
}

function LeaveAdjust({ staff, onClose, onSaved }: { staff: StaffMember; onClose: () => void; onSaved: () => Promise<void> }) {
  const [total, setTotal] = useState(String(staff.total_leave ?? 0)), [used, setUsed] = useState(String(staff.used_leave ?? 0));
  const [reason, setReason] = useState(LEAVE_REASONS[0]), [memo, setMemo] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const save = async () => {
    if (!Number.isFinite(Number(total)) || !Number.isFinite(Number(used))) return setError('숫자로 입력하세요');
    setBusy(true);
    try { await staffPost(`/leave-adjust/${staff.id}`, { total_leave: Number(total), used_leave: Number(used), reason, memo: memo || null }); await onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : '연차 수정 실패'); setBusy(false); }
  };
  return <div className="sf-modal" role="dialog" aria-modal="true" aria-label="연차 수정">
    <div className="sf-modal-back" onClick={onClose} />
    <div className="sf-modal-panel">
      <div className="sf-modal-head"><strong>{staff.name} · 연차 수정</strong><button type="button" aria-label="닫기" onClick={onClose}>×</button></div>
      <label className="sf-input"><span>지급연차</span><input type="number" value={total} onChange={e => setTotal(e.target.value)} /></label>
      <label className="sf-input"><span>사용연차</span><input type="number" value={used} onChange={e => setUsed(e.target.value)} /></label>
      <label className="sf-input"><span>수정 사유</span><select value={reason} onChange={e => setReason(e.target.value)}>{LEAVE_REASONS.map(r => <option key={r}>{r}</option>)}</select></label>
      <label className="sf-input"><span>메모</span><textarea rows={2} value={memo} onChange={e => setMemo(e.target.value)} /></label>
      {error && <p className="sf-hint is-warn">{error}</p>}
      <div className="sf-modal-foot"><button type="button" className="sf-btn" onClick={onClose}>닫기</button>
        <button type="button" className="sf-btn is-primary" disabled={busy} onClick={() => void save()}>{busy && <SavingMark />}수정 저장</button></div>
    </div>
  </div>;
}

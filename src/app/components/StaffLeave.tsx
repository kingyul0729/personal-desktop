import { ChevronLeft, ChevronRight } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { LoadingBox, SavingMark } from './Feedback';
import { OldDataBanner } from './Inventory';
import { StaffUnavailable } from './StaffSchedule';
import { toneOf, vividOf } from './staffTone';
import { staffGet, staffPost, StaffApiError } from '../staffApi';
import { runUseFix } from '../leaveFixFlow';
import { type MonthData, type StaffMember, WEEKDAYS, dateIn, daysInMonth, isRedDay, leaveSeq, monthLabel, optionsFor, shiftMonth, todayLocal, weekdayOf } from '../staffRules';

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
  const [memos, setMemos] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<StaffMember | null>(null);
  const [state, setState] = useState({ loading: true, error: '', unavailable: false, detail: '' });
  const load = useCallback(async () => {
    try {
      const [list, ld] = await Promise.all([staffGet('/list', { include_retired: 0 }), staffGet('/leave-dates', { year })]);
      // 예전 앱 표기(예: 7/17)는 그 날 기록의 메모에 있다
      const m: Record<string, string> = {};
      for (const [sid, list2] of Object.entries((ld.leave_marks || {}) as Record<string, { date: string; memo: string | null }[]>))
        for (const r of list2) { const hit = /표기 (\d+\/\d+)/.exec(r.memo || ''); if (hit) m[`${sid}|${r.date}`] = hit[1]; }
      setStaff(list); setDates(ld.leave_dates || {}); setMemos(m); setState({ loading: false, error: '', unavailable: false, detail: '' });
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
      const all = (dates[String(x.id)] || []).slice().sort();
      const idx: Record<string, number> = {}; all.forEach((d, i) => { idx[d] = i + 1; });
      const mine = new Set(all);
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
          <div className="lv-list-head"><p>{month.slice(0, 4)}년 사용 내역 <b>{all.length}일</b></p><button type="button" className="lv-link" onClick={() => setOpen(x)}>이력·수정</button></div>
          {all.length ? <ul className="lv-tags">{all.map(d => <li key={d}><button type="button" className={d.slice(0, 7) === month ? 'is-here' : ''} onClick={() => setMonth(d.slice(0, 7))} title="이 달 달력 보기">
            {Number(d.slice(5, 7))}/{Number(d.slice(8))}<small>{WEEKDAYS[weekdayOf(d)]}</small><span className="lv-seq" aria-label={`${`${leaveSeq(x, idx, d)}/${x.total_leave ?? '-'}`.split('/')[0]}번째`}>{`${leaveSeq(x, idx, d)}/${x.total_leave ?? '-'}`.split('/')[0]}</span></button></li>)}</ul>
            : <p className="lv-none">아직 사용한 연차가 없어요</p>}
        </div>
      </section>;
    })}</div>
    {open && <LeaveDetail staff={open} onClose={() => setOpen(null)} onSaved={async () => { setOpen(null); await load(); }} />}
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

function LeaveDetail({ staff, onClose, onSaved }: { staff: StaffMember; onClose: () => void; onSaved: () => Promise<void> }) {
  const [logs, setLogs] = useState<LeaveLog[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<FixMode | null>(null);
  const [nums, setNums] = useState({ total: staff.total_leave ?? 0, used: staff.used_leave ?? 0 });
  const load = useCallback(async () => {
    try { setLogs(await staffGet(`/leave-log/${staff.id}`)); } catch { setLogs([]); }
    try { const l = await staffGet('/list') as StaffMember[]; const me = (l || []).find(x => x.id === staff.id); if (me) setNums({ total: me.total_leave ?? 0, used: me.used_leave ?? 0 }); } catch { /* 숫자는 다음에 */ }
  }, [staff.id]);
  useEffect(() => { void load(); }, [load]);
  if (editing) return <LeaveAdjust staff={staff} onClose={() => setEditing(false)} onSaved={onSaved} />;
  // 자동 '사용 되돌림' 중 정정으로 생긴 것(ref_id)은 정정 줄 하나로 보이게 숨김
  const shown = (logs || []).filter(l => !(l.log_type === 'revert' && l.ref_id));
  const done = async () => { setMode(null); await load(); await onSaved(); };
  return <div className="sf-modal" role="dialog" aria-modal="true" aria-label={`${staff.name} 연차 이력`}>
    <div className="sf-modal-back" onClick={onClose} />
    <div className="sf-modal-panel lv-hist">
      <div className="sf-modal-head"><strong>{staff.name} · 연차 이력</strong><button type="button" aria-label="닫기" onClick={onClose}>×</button></div>
      <dl className="lv-hist-sum"><div><dt>지급연차</dt><dd>{nums.total}</dd></div><div><dt>사용연차</dt><dd>{nums.used}</dd></div><div><dt>잔여연차</dt><dd className="is-r">{nums.total - nums.used}</dd></div></dl>
      {logs == null ? <LoadingBox /> : !shown.length ? <p className="sf-hint">기록 없음</p>
        : <ul className="lv-hist-list">{shown.map(l => { const [chip, tone] = l.cancelled_at ? ['취소됨', 'c'] : KIND_CHIP[l.log_type] || [l.log_type, 'c'];
          const open = mode?.id === l.id;
          const after = shown.slice(0, shown.indexOf(l)).filter(x => !x.cancelled_at && x.log_type !== 'fix').length; // 잔여가 다시 계산되는 뒤 기록(정정·취소 줄은 그때 숫자 그대로)
          return <li key={l.id} className={`${l.cancelled_at ? 'is-cx' : ''}${l.log_type === 'fix' ? ' is-fix' : ''}`}>
            <div className="lv-hist-row">
              <div className="lv-hist-main"><b><span className={`lv-chip is-${tone}`}>{chip}</span><span className="lv-hist-title">{l.cancelled_at ? `${LOG_TYPE[l.log_type] || ''} ${logTitle(l)}` : logTitle(l)}</span></b>
                <small>{l.cancelled_at ? `사유: ${l.cancel_reason || '—'}`
                  : l.log_type === 'fix' ? [`지급 ${l.before_total} → ${l.after_total}`, `사용 ${l.before_used} → ${l.after_used}`, `잔여 ${(l.before_total ?? 0) - (l.before_used ?? 0)} → ${l.after_remain ?? '—'}`, l.reason ? `사유: ${l.reason}` : ''].filter(Boolean).join(' · ')
                  : [l.reason, l.remain_now != null ? `잔여 ${l.remain_now}` : ''].filter(Boolean).join(' · ')}</small></div>
              {l.can_fix && <div className="lv-hist-acts">
                <button type="button" className={`sf-btn${open && mode?.kind === 'edit' ? ' is-on' : ''}`} onClick={() => setMode(open && mode?.kind === 'edit' ? null : { id: l.id, kind: 'edit' })}>수정</button>
                <button type="button" className={`sf-btn${open && mode?.kind === 'cancel' ? ' is-on' : ''}`} onClick={() => setMode(open && mode?.kind === 'cancel' ? null : { id: l.id, kind: 'cancel' })}>취소</button></div>}
            </div>
            {open && <LeaveFix key={`${l.id}${mode!.kind}`} staff={staff} log={l} kind={mode!.kind} nums={nums} after={after} onClose={() => setMode(null)} onDone={done} />}
          </li>; })}</ul>}
      <div className="sf-modal-foot"><button type="button" className="sf-btn" onClick={onClose}>닫기</button><button type="button" className="sf-btn is-primary" onClick={() => setEditing(true)}>연차 수정</button></div>
    </div>
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

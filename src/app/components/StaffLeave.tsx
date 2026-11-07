import { useCallback, useEffect, useState } from 'react';
import { LoadingBox, SavingMark } from './Feedback';
import { OldDataBanner } from './Inventory';
import { StaffUnavailable } from './StaffSchedule';
import { staffGet, staffPost, StaffApiError } from '../staffApi';
import { type StaffMember, WEEKDAYS, dateIn, daysInMonth, leaveSeq, monthLabel, shiftMonth, todayLocal, weekdayOf } from '../staffRules';

// 직원연차 — 직원마다 자기 달력에 연차 날짜(순번 n/총)를 표시하고, 위에 총 부여 / 총 사용 / 잔여(누적, 월별 아님)를 보인다(2026-11-08 사용자 지정).
// 연차 사용/되돌림은 직원스케줄 달력에서 '연차'를 고르면 서버가 처리한다(예전 앱과 같음).
const LEAVE_REASONS = ['포상 연차 지급', '재계약 연차 재세팅', '연차 촉진 초기화', '행정 오류 수정', '신입 연차 당겨쓰기', '직접 입력'];
const LOG_TYPE: Record<string, string> = { use: '연차 사용', revert: '사용 되돌림', adjust: '수동 수정', grant: '월 발생 지급', convert: '정직원 전환' };
type LeaveLog = { id: number; log_type: string; log_date?: string | null; reason?: string | null; after_remain?: number | null; editor?: string | null; created_at?: string };

export default function StaffLeave() {
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
  if (state.loading && !staff.length) return <LoadingBox />;
  if (state.error) return <StaffUnavailable message={state.error} unavailable={state.unavailable} detail={state.detail} />;
  const today = todayLocal(), n = daysInMonth(month), lead = weekdayOf(`${month}-01`);
  return <div className="sf-wrap sf-leave">
    <OldDataBanner />
    <div className="sf-bar">
      <div className="sf-month">
        <button type="button" aria-label="이전 달" onClick={() => setMonth(m => shiftMonth(m, -1))}>‹</button>
        <strong>{monthLabel(month)}</strong>
        <button type="button" aria-label="다음 달" onClick={() => setMonth(m => shiftMonth(m, 1))}>›</button>
        <button type="button" className="sf-today" onClick={() => setMonth(todayLocal().slice(0, 7))}>이번 달</button>
      </div>
      <small className="sf-hint">연차 숫자는 달과 상관없이 지금까지의 누적이에요.</small>
    </div>
    <div className="sf-lv-grid">{staff.map(x => {
      const all = (dates[String(x.id)] || []).slice().sort();
      const idx: Record<string, number> = {}; all.forEach((d, i) => { idx[d] = i + 1; });
      const mine = new Set(all);
      const remain = x.remain_leave ?? (x.total_leave ?? 0) - (x.used_leave ?? 0);
      return <section key={x.id} className="sf-lv-card">
        <header><b>{x.name}</b>{x.is_leader ? <small>팀장</small> : null}<button type="button" className="sf-btn" onClick={() => setOpen(x)}>이력·수정</button></header>
        <dl className="sf-lv-nums"><div><dt>총 부여</dt><dd>{x.total_leave ?? '-'}</dd></div><div><dt>총 사용</dt><dd>{x.used_leave ?? '-'}</dd></div><div className={remain < 0 ? 'is-warn' : ''}><dt>잔여</dt><dd>{remain}</dd></div></dl>
        <div className="sf-mini-grid sf-lv-cal">{WEEKDAYS.map(w => <i key={w}>{w}</i>)}
          {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
          {Array.from({ length: n }, (_, d) => {
            const date = dateIn(month, d + 1), on = mine.has(date);
            const seq = on ? memos[`${x.id}|${date}`] || `${leaveSeq(x, idx, date)}/${x.total_leave ?? '-'}` : '';
            return <span key={date} className={`${on ? 'is-leave' : ''}${date === today ? ' is-today' : ''}${weekdayOf(date) === 0 ? ' is-sun' : ''}`} title={on ? `${date} 연차 ${seq}` : undefined}>{d + 1}{on && <em>{seq}</em>}</span>;
          })}
        </div>
        <div className="sf-lv-list"><small>{month.slice(0, 4)}년 연차 {all.length}일</small>
          {all.length ? all.map(d => <button key={d} type="button" className={d.slice(0, 7) === month ? 'is-here' : ''} onClick={() => setMonth(d.slice(0, 7))} title="이 달 달력 보기">
            {Number(d.slice(5, 7))}/{Number(d.slice(8))}<em>{memos[`${x.id}|${d}`] || `${leaveSeq(x, idx, d)}/${x.total_leave ?? '-'}`}</em></button>) : <small>없음</small>}</div>
      </section>;
    })}</div>
    {open && <LeaveDetail staff={open} onClose={() => setOpen(null)} onSaved={async () => { setOpen(null); await load(); }} />}
  </div>;
}

function LeaveDetail({ staff, onClose, onSaved }: { staff: StaffMember; onClose: () => void; onSaved: () => Promise<void> }) {
  const [logs, setLogs] = useState<LeaveLog[] | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => { staffGet(`/leave-log/${staff.id}`).then(setLogs, () => setLogs([])); }, [staff.id]);
  if (editing) return <LeaveAdjust staff={staff} onClose={() => setEditing(false)} onSaved={onSaved} />;
  return <div className="sf-modal" role="dialog" aria-modal="true" aria-label={`${staff.name} 연차 이력`}>
    <div className="sf-modal-back" onClick={onClose} />
    <div className="sf-modal-panel">
      <div className="sf-modal-head"><strong>{staff.name} · 연차 이력</strong><button type="button" aria-label="닫기" onClick={onClose}>×</button></div>
      {logs == null ? <LoadingBox /> : !logs.length ? <p className="sf-hint">연차 이력이 없습니다</p>
        : <ul className="sf-list sf-log">{logs.map(l => <li key={l.id}><b>{LOG_TYPE[l.log_type] || l.log_type}</b>
          <span>{[l.log_date, l.reason, `잔여 ${l.after_remain ?? '-'}`].filter(Boolean).join(' · ')}</span>
          <small>{(l.created_at || '').slice(0, 16).replace('T', ' ')}{l.editor ? ` · ${l.editor}` : ''}</small></li>)}</ul>}
      <div className="sf-modal-foot"><button type="button" className="sf-btn" onClick={onClose}>닫기</button><button type="button" className="sf-btn is-primary" onClick={() => setEditing(true)}>연차 수정</button></div>
    </div>
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
      <label className="sf-input"><span>총 발생 연차</span><input type="number" value={total} onChange={e => setTotal(e.target.value)} /></label>
      <label className="sf-input"><span>사용 연차</span><input type="number" value={used} onChange={e => setUsed(e.target.value)} /></label>
      <label className="sf-input"><span>수정 사유</span><select value={reason} onChange={e => setReason(e.target.value)}>{LEAVE_REASONS.map(r => <option key={r}>{r}</option>)}</select></label>
      <label className="sf-input"><span>메모</span><textarea rows={2} value={memo} onChange={e => setMemo(e.target.value)} /></label>
      {error && <p className="sf-hint is-warn">{error}</p>}
      <div className="sf-modal-foot"><button type="button" className="sf-btn" onClick={onClose}>닫기</button>
        <button type="button" className="sf-btn is-primary" disabled={busy} onClick={() => void save()}>{busy && <SavingMark />}수정 저장</button></div>
    </div>
  </div>;
}

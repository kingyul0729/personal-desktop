import { useCallback, useEffect, useState } from 'react';
import { LoadingBox, SavingMark } from './Feedback';
import { StaffUnavailable } from './StaffSchedule';
import { staffGet, staffPost, StaffApiError } from '../staffApi';
import { type StaffMember, WEEKDAYS, dateIn, daysInMonth, todayLocal, weekdayOf } from '../staffRules';

// 직원연차 — 예전 재고관리 앱의 연차 자료(총 발생·사용·잔여, 연차 이력, 연차 수정)와 한 해 연차 달력.
// 연차 사용/되돌림은 직원스케줄 달력에서 '연차'를 고르면 서버가 처리한다(예전 앱과 같음).
const LEAVE_REASONS = ['포상 연차 지급', '재계약 연차 재세팅', '연차 촉진 초기화', '행정 오류 수정', '신입 연차 당겨쓰기', '직접 입력'];
const LOG_TYPE: Record<string, string> = { use: '연차 사용', revert: '사용 되돌림', adjust: '수동 수정', grant: '월 발생 지급', convert: '정직원 전환' };
type LeaveLog = { id: number; log_type: string; log_date?: string | null; reason?: string | null; after_remain?: number | null; editor?: string | null; created_at?: string };

export default function StaffLeave() {
  const [year, setYear] = useState(() => Number(todayLocal().slice(0, 4)));
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [dates, setDates] = useState<Record<string, string[]>>({});
  const [sid, setSid] = useState<number | null>(null);
  const [logs, setLogs] = useState<LeaveLog[] | null>(null);
  const [state, setState] = useState({ loading: true, error: '', unavailable: false, detail: '' });
  const [editing, setEditing] = useState(false);
  const load = useCallback(async () => {
    try {
      const [list, ld] = await Promise.all([staffGet('/list', { include_retired: 0 }), staffGet('/leave-dates', { year })]);
      setStaff(list); setDates(ld.leave_dates || {}); setState({ loading: false, error: '', unavailable: false, detail: '' });
      setSid(cur => (cur && list.some((s: StaffMember) => s.id === cur) ? cur : list[0]?.id ?? null));
    } catch (e) { setState({ loading: false, error: e instanceof Error ? e.message : '불러오지 못했어요.', unavailable: e instanceof StaffApiError && e.unavailable, detail: e instanceof StaffApiError ? e.detail : '' }); }
  }, [year]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (sid == null) return; setLogs(null); staffGet(`/leave-log/${sid}`).then(setLogs, () => setLogs([])); }, [sid, staff]);
  if (state.loading) return <LoadingBox />;
  if (state.error) return <StaffUnavailable message={state.error} unavailable={state.unavailable} detail={state.detail} />;
  const s = staff.find(x => x.id === sid);
  const mine = new Set(dates[String(sid)] || []);
  const today = todayLocal();
  return <div className="sf-wrap sf-leave">
    <div className="sf-bar">
      <div className="sf-month">
        <button type="button" aria-label="이전 해" onClick={() => setYear(y => y - 1)}>‹</button>
        <strong>{year}년</strong>
        <button type="button" aria-label="다음 해" onClick={() => setYear(y => y + 1)}>›</button>
      </div>
    </div>
    <table className="sf-table is-click">
      <thead><tr><th>직원</th><th className="num">총 발생</th><th className="num">사용</th><th className="num">잔여</th><th className="num">{year}년 사용일</th></tr></thead>
      <tbody>{staff.map(x => <tr key={x.id} aria-selected={x.id === sid} onClick={() => setSid(x.id)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') setSid(x.id); }}>
        <td><b>{x.name}</b>{x.is_leader ? <small> 팀장</small> : null}</td><td className="num">{x.total_leave ?? '-'}</td><td className="num">{x.used_leave ?? '-'}</td>
        <td className={`num${(x.remain_leave ?? 0) < 0 ? ' is-warn' : ''}`}>{x.remain_leave ?? '-'}</td><td className="num">{(dates[String(x.id)] || []).length}일</td></tr>)}</tbody>
    </table>
    {s && <>
      <div className="sf-perf-head"><h3>{s.name} · {year}년 연차 달력</h3><button type="button" className="sf-btn" onClick={() => setEditing(true)}>연차 수정</button></div>
      <div className="sf-year">{Array.from({ length: 12 }, (_, m) => {
        const month = `${year}-${String(m + 1).padStart(2, '0')}`, n = daysInMonth(month), lead = weekdayOf(`${month}-01`);
        const used = Array.from({ length: n }, (_, d) => dateIn(month, d + 1)).filter(d => mine.has(d)).length;
        return <div key={month} className="sf-mini">
          <p>{m + 1}월{used ? <small> 연차 {used}</small> : null}</p>
          <div className="sf-mini-grid">{WEEKDAYS.map(w => <i key={w}>{w}</i>)}
            {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
            {Array.from({ length: n }, (_, d) => { const date = dateIn(month, d + 1); return <span key={date} className={`${mine.has(date) ? 'is-leave' : ''}${date === today ? ' is-today' : ''}${weekdayOf(date) === 0 ? ' is-sun' : ''}`} title={mine.has(date) ? `${date} 연차` : undefined}>{d + 1}</span>; })}
          </div>
        </div>;
      })}</div>
      <h3 className="sf-perf-title">연차 이력</h3>
      {logs == null ? <LoadingBox /> : !logs.length ? <p className="sf-hint">연차 이력이 없습니다</p>
        : <ul className="sf-list sf-log">{logs.map(l => <li key={l.id}><b>{LOG_TYPE[l.log_type] || l.log_type}</b>
          <span>{[l.log_date, l.reason, `잔여 ${l.after_remain ?? '-'}`].filter(Boolean).join(' · ')}</span>
          <small>{(l.created_at || '').slice(0, 16).replace('T', ' ')}{l.editor ? ` · ${l.editor}` : ''}</small></li>)}</ul>}
    </>}
    {editing && s && <LeaveAdjust staff={s} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await load(); }} />}
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

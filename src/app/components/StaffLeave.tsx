import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { LoadingBox, SavingMark } from './Feedback';
import { OldDataBanner } from './Inventory';
import { StaffUnavailable } from './StaffSchedule';
import { staffGet, staffPost, StaffApiError } from '../staffApi';
import { type StaffMember, WEEKDAYS, dateIn, daysInMonth, leaveSeq, monthLabel, shiftMonth, todayLocal, weekdayOf } from '../staffRules';

// 직원연차 — 직원마다 자기 달력에 연차 날짜(순번 n/총)를 표시하고, 위에 지급연차 / 사용연차 / 잔여연차(누적, 월별 아님)를 보인다(2026-11-08 사용자 지정).
// 연차 사용/되돌림은 직원스케줄 달력에서 '연차'를 고르면 서버가 처리한다(예전 앱과 같음).
// 직원별 고유 파스텔 색(id로 고정 배정 — 새로고침해도 같은 색). [글자색, 연한 바탕, 테두리]
// 2026-11-08 사용자 '너무 쨍해' → 채도를 낮춘 차분한 톤.
const STAFF_TONES: [string, string, string][] = [
  ['#5e7a66', '#eef3ef', '#c6d7cb'], // 세이지
  ['#6c6690', '#f1f0f6', '#cfcbe0'], // 라벤더
  ['#966b55', '#f7f0eb', '#e2cbbd'], // 피치
  ['#7f6c3a', '#f8f3e2', '#e0d3aa'], // 버터
  ['#8f6273', '#f6eff1', '#dcc6ce'], // 로즈
  ['#557a76', '#eef4f3', '#c2d8d5'], // 민트그린
];
const toneOf = (id: number) => STAFF_TONES[(id - 1 + STAFF_TONES.length) % STAFF_TONES.length];

const LEAVE_REASONS = ['포상 연차 지급', '재계약 연차 재세팅', '연차 촉진 초기화', '행정 오류 수정', '신입 연차 당겨쓰기', '직접 입력'];
const LOG_TYPE: Record<string, string> = { use: '연차 사용', revert: '사용 되돌림', adjust: '수동 수정', grant: '월 지급연차', convert: '정직원 전환' };
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
      <small className="sf-hint">지급연차·사용연차·잔여연차는 달과 상관없이 지금까지의 누적이에요.</small>
    </div>
    <div className="lv-grid">{staff.map(x => {
      const all = (dates[String(x.id)] || []).slice().sort();
      const idx: Record<string, number> = {}; all.forEach((d, i) => { idx[d] = i + 1; });
      const mine = new Set(all);
      const remain = x.remain_leave ?? (x.total_leave ?? 0) - (x.used_leave ?? 0);
      const [ink, tint, line] = toneOf(x.id);
      return <section key={x.id} className="lv-card" style={{ '--c': ink, '--c-bg': tint, '--c-line': line } as React.CSSProperties}>
        <div className="lv-sum" aria-label={`${x.name} 연차`}>
          <strong className="lv-name" title={x.name}><i>{x.name.length >= 3 ? x.name.slice(1) : x.name}</i></strong>
          <div><span>지급연차</span><b>{x.total_leave ?? '-'}</b></div>
          <div><span>사용연차</span><b>{x.used_leave ?? '-'}</b></div>
          <div className="lv-rest"><span>잔여연차</span><b className={remain < 0 ? 'is-warn' : ''}>{remain}</b></div>
        </div>
        <div className="lv-cal">{WEEKDAYS.map((w, k) => <i key={w} className={k === 0 ? 'is-sun' : k === 6 ? 'is-sat' : ''}>{w}</i>)}
          {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
          {Array.from({ length: n }, (_, d) => {
            const date = dateIn(month, d + 1), on = mine.has(date), wd = weekdayOf(date);
            const seq = on ? memos[`${x.id}|${date}`] || `${leaveSeq(x, idx, date)}/${x.total_leave ?? '-'}` : '';
            return <span key={date} className={`${on ? 'is-leave' : ''}${date === today ? ' is-today' : ''}${wd === 0 ? ' is-sun' : wd === 6 ? ' is-sat' : ''}`} title={on ? `${date} 연차 ${seq.split('/')[0]}번째` : undefined}>
              <b>{d + 1}</b>{on && <em>{seq.split('/')[0]}번째</em>}</span>;
          })}
        </div>
        <div className="lv-list">
          <div className="lv-list-head"><p>{month.slice(0, 4)}년 사용 내역 <b>{all.length}일</b></p><button type="button" className="lv-link" onClick={() => setOpen(x)}>이력·수정</button></div>
          {all.length ? <ul className="lv-tags">{all.map(d => <li key={d}><button type="button" className={d.slice(0, 7) === month ? 'is-here' : ''} onClick={() => setMonth(d.slice(0, 7))} title="이 달 달력 보기">
            {Number(d.slice(5, 7))}.{String(Number(d.slice(8))).padStart(2, '0')}<small>{WEEKDAYS[weekdayOf(d)]}</small><span className="lv-seq">{(memos[`${x.id}|${d}`] || `${leaveSeq(x, idx, d)}/${x.total_leave ?? '-'}`).split('/')[0]}회</span></button></li>)}</ul>
            : <p className="lv-none">아직 사용한 연차가 없어요</p>}
        </div>
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
          <span>{[l.log_date, l.reason, `잔여연차 ${l.after_remain ?? '-'}`].filter(Boolean).join(' · ')}</span>
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

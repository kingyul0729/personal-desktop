import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { askConfirm } from './AlertDialog';
import { LoadingBox } from './Feedback';
import { staffGet, staffPost } from '../staffApi';
import { dayLabelKo, todayLocal } from '../staffRules';

// 일일 예약표(2026-11-13 사용자 지정): Claude가 예약표 사진을 옮겨 만든 파일
// { format: 'dachaeum-booking', date, rows: [{ time, name, laser }] } 을 올리면 줄이 생기고,
// 줄마다 관리담당(그날 출근한 사람 위주)·관리(S·M·더마·히알·X, 여러 개)·취소(줄긋기)를 표시한다.
// 당일예약·신환은 아래 칸에서 직접 더한다. 월말·연말 보고에 예약 / 당일예약 / 신환가 각각 따로 나온다.
export type BookKind = 'book' | 'day_book' | 'day_care';
export type BookRow = { id: number; date: string; kind: BookKind; time: string; customer: string; laser: string; staff_id: number | null; care: string[]; cancelled: boolean };
type BookStaff = { id: number; name: string; is_leader?: number };
type BookDay = { date: string; rows: BookRow[]; staff: BookStaff[]; working: number[] };
export const BOOK_CARE = ['S', 'M', '더마', '히알', 'X'];
export const BOOK_KIND_LABEL: Record<BookKind, string> = { book: '예약', day_book: '당일예약', day_care: '신환' };
const short = (name: string) => (name.length >= 3 ? name.slice(1) : name);
const shiftDay = (date: string, by: number) => { const d = new Date(`${date}T00:00:00`); d.setDate(d.getDate() + by); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// X(뒷관리 없음)는 다른 관리와 같이 고르지 않는다
export const toggleCare = (care: string[], k: string) => {
  if (care.includes(k)) return care.filter(x => x !== k);
  return k === 'X' ? ['X'] : BOOK_CARE.filter(x => x !== 'X' && (x === k || care.includes(x)));
};

export default function StaffBook() {
  const [date, setDate] = useState(todayLocal);
  const [day, setDay] = useState<BookDay | null>(null);
  const [error, setError] = useState(''), [toast, setToast] = useState('');
  const file = useRef<HTMLInputElement>(null), want = useRef(date);
  const load = useCallback(async (d: string) => {
    want.current = d;
    try { const data = await staffGet('/book', { date: d }) as BookDay; if (want.current === d) { setDay(data); setError(''); } }
    catch (e) { if (want.current === d) setError(e instanceof Error ? e.message : '불러오지 못했어요'); }
  }, []);
  useEffect(() => { setDay(null); void load(date); }, [date, load]);
  useEffect(() => { const on = () => void load(want.current); window.addEventListener('staff-data-changed', on); return () => window.removeEventListener('staff-data-changed', on); }, [load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2200); return () => clearTimeout(t); }, [toast]);

  const patchRow = (row: BookRow) => setDay(cur => cur && { ...cur, rows: cur.rows.map(r => (r.id === row.id ? row : r)) });
  const update = async (row: BookRow, patch: Partial<BookRow>) => {
    patchRow({ ...row, ...patch }); // 바로 보이게 먼저 바꾸고, 실패하면 되돌린다
    try { const r = await staffPost('/book/update', { id: row.id, ...patch }); patchRow(r.row); }
    catch (e) { patchRow(row); setToast(e instanceof Error ? e.message : '저장 실패'); }
  };
  const remove = async (row: BookRow) => {
    if (!await askConfirm({ title: '삭제하시겠습니까?', message: `${row.time ? `${row.time} ` : ''}${row.customer}`, kind: 'delete' })) return;
    try { await staffPost('/book/delete', { id: row.id }); setDay(cur => cur && { ...cur, rows: cur.rows.filter(r => r.id !== row.id) }); }
    catch (e) { setToast(e instanceof Error ? e.message : '삭제 실패'); }
  };
  const add = async (kind: BookKind, f: { time: string; customer: string; laser: string }) => {
    try { const r = await staffPost('/book/add', { date, kind, ...f }); setDay(cur => cur && { ...cur, rows: [...cur.rows, r.row] }); return true; }
    catch (e) { setToast(e instanceof Error ? e.message : '저장 실패'); return false; }
  };
  const pick = async (f?: File) => {
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j?.format !== 'dachaeum-booking' || !/^\d{4}-\d{2}-\d{2}$/.test(j.date) || !Array.isArray(j.rows)) throw new Error('예약표 파일이 아니에요');
      const r = await staffPost('/book/import', { date: j.date, rows: j.rows });
      setToast(r.skipped ? `${r.added}줄 넣음 · 이미 있는 ${r.skipped}줄` : `${r.added}줄 넣었습니다`);
      if (j.date === date) await load(date); else setDate(j.date);
    } catch (e) { setToast(e instanceof Error ? e.message : '파일을 읽지 못했어요'); }
    finally { if (file.current) file.current.value = ''; }
  };

  const rows = day?.rows || [];
  const of = (kind: BookKind) => rows.filter(r => r.kind === kind);
  const live = (kind: BookKind) => of(kind).filter(r => !r.cancelled).length;
  const cancelled = rows.filter(r => r.cancelled).length;
  // 관리담당 목록: 그날 출근한 사람만(근태가 아직 없으면 모두)
  const people = day ? (day.working.length ? day.staff.filter(s => day.working.includes(s.id)) : day.staff) : [];

  return <div className="sf-wrap bk-wrap">
    <div className="sf-bar">
      <div className="sf-month">
        <button type="button" aria-label="전날" onClick={() => setDate(d => shiftDay(d, -1))}><ChevronLeft size={18} strokeWidth={1.8} /></button>
        <strong>{dayLabelKo(date)}</strong>
        <button type="button" aria-label="다음 날" onClick={() => setDate(d => shiftDay(d, 1))}><ChevronRight size={18} strokeWidth={1.8} /></button>
        <button type="button" className="sf-today" onClick={() => setDate(todayLocal())}>오늘</button>
      </div>
      <div className="iv-inline">
        <label className="sf-input"><span>날짜</span><input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} /></label>
        <button type="button" className="sf-btn" onClick={() => file.current?.click()}>파일로 넣기</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={e => void pick(e.target.files?.[0])} />
      </div>
    </div>
    {error && <p className="sf-hint is-warn">{error}</p>}
    {!day ? (!error && <LoadingBox />) : <>
      <dl className="bk-sum">
        <div><dt>예약</dt><dd>{live('book')}</dd></div><div><dt>예약취소</dt><dd>{cancelled}</dd></div>
        <div><dt>당일예약</dt><dd>{live('day_book')}</dd></div><div><dt>신환</dt><dd>{live('day_care')}</dd></div>
      </dl>
      <BookTable title="예약" rows={of('book')} people={people} staff={day.staff} onUpdate={update} onRemove={remove} />
      <BookTable title="당일예약" rows={of('day_book')} people={people} staff={day.staff} onUpdate={update} onRemove={remove} onAdd={f => add('day_book', f)} />
      <BookTable title="신환" rows={of('day_care')} people={people} staff={day.staff} onUpdate={update} onRemove={remove} onAdd={f => add('day_care', f)} />
    </>}
    {toast && <div className="sf-toast" role="status">{toast}</div>}
  </div>;
}

type AddForm = { time: string; customer: string; laser: string };
export function BookTable({ title, rows, people, staff, onUpdate, onRemove, onAdd }: { title: string; rows: BookRow[]; people: BookStaff[]; staff: BookStaff[];
  onUpdate: (row: BookRow, patch: Partial<BookRow>) => void; onRemove: (row: BookRow) => void; onAdd?: (f: AddForm) => Promise<boolean> }) {
  const [f, setF] = useState<AddForm>({ time: '', customer: '', laser: '' });
  const submit = async () => { if (!f.customer.trim() || !onAdd) return; if (await onAdd(f)) setF({ time: '', customer: '', laser: '' }); };
  return <section className="bk-card" aria-label={title}>
    <h3>{title}<small>{rows.filter(r => !r.cancelled).length}</small></h3>
    {rows.length === 0 && !onAdd ? <p className="sf-hint">기록 없음</p> : <div className="bk-scroll"><table className="bk-table">
      <thead><tr><th>시간</th><th>고객명</th><th>관리담당</th><th>관리</th><th>레이저</th><th aria-label="취소·삭제" /></tr></thead>
      <tbody>
        {rows.map(r => {
          // 이미 고른 담당이 오늘 목록에 없어도(나중에 근태를 고친 경우) 그대로 보이게 넣는다
          const opts = r.staff_id && !people.some(s => s.id === r.staff_id) ? [...people, ...staff.filter(s => s.id === r.staff_id)] : people;
          return <tr key={r.id} className={r.cancelled ? 'is-cancelled' : ''}>
            <td className="bk-time">{r.time || '—'}</td>
            <td className="bk-name">{r.customer}</td>
            <td><select aria-label={`${r.customer} 관리담당`} value={r.staff_id ?? ''} disabled={r.cancelled} onChange={e => onUpdate(r, { staff_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">—</option>{opts.map(s => <option key={s.id} value={s.id}>{short(s.name)}</option>)}</select></td>
            <td><span className="bk-care" role="group" aria-label={`${r.customer} 관리`}>{BOOK_CARE.map(k => <button key={k} type="button" aria-pressed={r.care.includes(k)} disabled={r.cancelled} onClick={() => onUpdate(r, { care: toggleCare(r.care, k) })}>{k}</button>)}</span></td>
            <td className="bk-laser">{r.laser || '—'}</td>
            <td className="bk-act"><button type="button" className="bk-cancel" aria-pressed={r.cancelled} onClick={() => onUpdate(r, { cancelled: !r.cancelled })}>취소</button>
              <button type="button" className="bk-del" aria-label={`${r.customer} 삭제`} title="삭제" onClick={() => onRemove(r)}><Trash2 size={16} strokeWidth={1.7} /></button></td>
          </tr>;
        })}
        {onAdd && <tr className="bk-add">
          <td><input type="time" aria-label={`${title} 시간`} value={f.time} onChange={e => setF({ ...f, time: e.target.value })} /></td>
          <td><input type="text" aria-label={`${title} 고객명`} placeholder="고객명" value={f.customer} onChange={e => setF({ ...f, customer: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') void submit(); }} /></td>
          <td /><td />
          <td><input type="text" aria-label={`${title} 레이저`} placeholder="레이저" value={f.laser} onChange={e => setF({ ...f, laser: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') void submit(); }} /></td>
          <td className="bk-act"><button type="button" className="sf-btn is-primary" disabled={!f.customer.trim()} onClick={() => void submit()}>추가</button></td>
        </tr>}
      </tbody></table></div>}
  </section>;
}

// 월말·연말 보고의 '예약표 집계'(2026-11-13 사용자: 직원 성과는 직접 계산 → 직원별로 나누지 않음):
// 예약 / 당일예약 / 신환을 한 줄씩 따로 — 고객 수(취소 뺀 줄 수)·관리 종류별 건수·취소 수.
export type BookSum = Record<BookKind, { staff_id: number | null; name: string; count: number; cancelled: number; care: Record<string, number> }[]>;
export function BookSummary({ sum }: { sum: BookSum }) {
  const dash = (v: number) => (v ? String(v) : '—');
  const rows = (Object.keys(BOOK_KIND_LABEL) as BookKind[]).map(kind => { const list = sum[kind] || []; const t = (f: (x: BookSum[BookKind][number]) => number) => list.reduce((a, x) => a + f(x), 0);
    return { kind, count: t(x => x.count), cancelled: t(x => x.cancelled), care: Object.fromEntries(BOOK_CARE.map(k => [k, t(x => x.care[k] || 0)])) as Record<string, number> }; });
  // 예약취소(줄 그은 예약)는 구분의 한 줄로 따로 센다 — 고객 수에만, 관리 칸은 비움(2026-11-13 사용자 '취소도 구분에 넣어줘, 월말·연말 계산만')
  const cancelled = rows.reduce((a, r) => a + r.cancelled, 0);
  return <div className="iv-scroll"><table className="sf-table iv-year"><thead><tr><th>구분</th><th className="num">고객 수</th>{BOOK_CARE.map(k => <th key={k} className="num">{k}</th>)}</tr></thead>
    <tbody>{rows.map(r => <tr key={r.kind}><td><b>{BOOK_KIND_LABEL[r.kind]}</b></td><td className="num">{dash(r.count)}</td>{BOOK_CARE.map(k => <td key={k} className="num">{dash(r.care[k])}</td>)}</tr>)}
      <tr><td><b>예약취소</b></td><td className="num">{dash(cancelled)}</td>{BOOK_CARE.map(k => <td key={k} className="num">—</td>)}</tr></tbody></table></div>;
}
export const bookHasAny = (sum?: BookSum | null) => !!sum && (Object.keys(BOOK_KIND_LABEL) as BookKind[]).some(k => (sum[k] || []).length > 0);

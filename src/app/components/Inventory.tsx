import { useCallback, useEffect, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, Pencil, Trash2, X } from 'lucide-react';
import { LoadingBox, SavingMark } from './Feedback';
import { readWon } from '../koreanAmount';
import { type InvItem, type InvOption, type InvOrder, type InvState, type InvTx, InvError, KIND_LABEL, announceInventory, fmtQty, fmtWon, invGet, invSend, invUploadInvoice, invoiceSrc, shiftMonth, todayLocal, unitHint, useInventory, subscribeInventory } from '../inventoryApi';

// 재고 화면 4개(재고체크·재고주문·재고입출고·월말/연말보고서). 숫자는 예전 앱에서, 화면은 새로 만듦.

function useToast() {
  const [toast, setToast] = useState('');
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2400); return () => clearTimeout(t); }, [toast]);
  return [toast, setToast] as const;
}
const errText = (e: unknown) => (e instanceof Error ? e.message : '처리하지 못했어요.');
function Problem({ error }: { error: InvError }) {
  return <div className="pending-screen"><strong>불러오지 못했어요</strong><p>{error.message}</p>{error.detail && <pre className="sf-detail">{error.detail}</pre>}</div>;
}
function Shell({ children, toast }: { children: React.ReactNode; toast: string }) {
  return <div className="sf-wrap iv-wrap">{children}{toast && <div className="sf-toast" role="status">{toast}</div>}</div>;
}
function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, React.ReactNode][]; label: string }) {
  return <div className="sf-seg" role="tablist" aria-label={label}>{options.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}>{l}</button>)}</div>;
}
const lowOf = (it: InvItem) => it.min_stock > 0 && it.hospital_stock <= it.min_stock;
// 재고 표시(2026-11-09 사용자 지정, 겹치지 않게 하나만): 받기 전 반입 예정 → '입고 대기', 받기 전 주문 → '주문 중',
// 병원재고가 기준 이하인데 업체 보관 잔량을 합치면 넘음 → '입고 필요', 합쳐도 기준 이하 → '부족'(새로 구매).
type Flag = 'bringing' | 'wait' | 'bring' | 'low';
const FLAG_LABEL: Record<Flag, string> = { bringing: '입고 대기', wait: '주문 중', bring: '입고 필요', low: '부족' };
const flagOf = (it: InvItem, orders: InvOrder[]): Flag | null => {
  const pend = orders.filter(o => o.item_id === it.id);
  if (pend.some(o => o.prepaid)) return 'bringing';
  if (pend.length) return 'wait';
  if (!lowOf(it)) return null;
  return it.prepaid && it.hospital_stock + (it.vendor_stock || 0) > it.min_stock ? 'bring' : 'low';
};
const FlagTag = ({ flag }: { flag: Flag | null }) => (flag ? <span className={`iv-tag is-${flag}`}>{FLAG_LABEL[flag]}</span> : null);
const withUnit = (v: number | null | undefined, unit: string) => (v == null ? '—' : `${fmtQty(v)} ${unit}`);

/* ───────────── 재고체크 ───────────── */
export function StockCheck() {
  const { state, error, reload } = useInventory();
  const [toast, setToast] = useToast();
  const [tab, setTab] = useState<'daily' | 'all'>('daily');
  if (error) return <Problem error={error} />;
  if (!state) return <LoadingBox />;
  const prepaid = state.items.filter(it => it.prepaid);
  const low = state.items.filter(it => flagOf(it, state.orders) === 'low');
  const bring = state.items.filter(it => flagOf(it, state.orders) === 'bring');
  return <Shell toast={toast}>
    {!state.imported && <OldDataImport onDone={() => { announceInventory(); void reload(); }} />}
    <div className="iv-cards">
      {prepaid.map(it => <div key={it.id} className="iv-card"><span>업체 보관 잔량</span><b>{it.name}</b><strong>{withUnit(it.vendor_stock, it.stock_unit)}</strong><small>병원재고 {withUnit(it.hospital_stock, it.stock_unit)}{it.unit_cost != null ? ` · 개당원가 ${it.unit_cost.toLocaleString('ko-KR')}원` : ''}{it.paid_unit_cost != null ? ` · 유상단가 ${it.paid_unit_cost.toLocaleString('ko-KR')}원` : ''}</small></div>)}
      <div className={`iv-card${low.length ? ' is-warn' : ''}`}><span>위험 기준 이하</span><b>부족 품목</b><strong>{low.length}개</strong><small>{low.slice(0, 3).map(i => i.name).join(', ') || '없음'}{bring.length > 0 && ` · 입고 필요 ${bring.length}개`}</small></div>
    </div>
    <div className="sf-bar"><Seg label="보기" value={tab} onChange={setTab} options={[['daily', '일일 재고'], ['all', '전체 재고']]} /></div>
    {tab === 'daily' ? <DailyClose key={state.imported || 'none'} items={state.items} today={state.today} notify={setToast} onSaved={reload} /> : <AllStock state={state} notify={setToast} />}
  </Shell>;
}

function AllStock({ state, notify }: { state: InvState; notify: (m: string) => void }) {
  const [cat, setCat] = useState('전체');
  const [adj, setAdj] = useState<InvItem | null>(null);
  const cats = ['전체', ...Array.from(new Set(state.items.map(i => i.category || '기타')))];
  const rows = state.items.filter(i => cat === '전체' || (i.category || '기타') === cat);
  return <>
    <div className="sf-pills">{cats.map(c => <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}</div>
    <table className="sf-table">
      <thead><tr><th>품목</th><th>거래처</th><th className="num">병원재고</th><th className="num">업체 보관 잔량</th><th className="num">위험 기준</th><th /></tr></thead>
      <tbody>{rows.map(it => { const fl = flagOf(it, state.orders); return <tr key={it.id} className={fl === 'low' ? 'is-low' : ''}>
        <td><b>{it.name}</b>{unitHint(it) && <small> · {unitHint(it)}</small>} <FlagTag flag={fl} /></td><td><small>{it.vendor_name || '—'}</small></td>
        <td className={`num${it.hospital_stock < 0 ? ' is-warn' : ''}`}>{withUnit(it.hospital_stock, it.stock_unit)}</td>
        <td className="num">{it.prepaid ? withUnit(it.vendor_stock, it.stock_unit) : <small>—</small>}</td>
        <td className="num"><small>{it.min_stock ? withUnit(it.min_stock, it.stock_unit) : '—'}</small></td>
        <td className="num"><button type="button" className="sf-btn" onClick={() => setAdj(it)}>맞추기</button></td></tr>; })}</tbody>
    </table>
    {adj && <AdjustDialog item={adj} today={state.today} onClose={() => setAdj(null)} onDone={m => { notify(m); setAdj(null); announceInventory(); }} />}
  </>;
}

function AdjustDialog({ item, today, onClose, onDone }: { item: InvItem; today: string; onClose: () => void; onDone: (m: string) => void }) {
  const [h, setH] = useState(String(item.hospital_stock)), [v, setV] = useState(String(item.vendor_stock)), [memo, setMemo] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <Modal title={`${item.name} 재고 맞추기`} onClose={onClose}>
    <label className="sf-input"><span>병원재고 ({item.stock_unit}) · 지금 {fmtQty(item.hospital_stock)}</span><input type="number" min={0} inputMode="decimal" value={h} onChange={e => setH(e.target.value)} /></label>
    {item.prepaid ? <label className="sf-input"><span>업체 보관 잔량 ({item.stock_unit}) · 지금 {fmtQty(item.vendor_stock)}</span><input type="number" min={0} inputMode="decimal" value={v} onChange={e => setV(e.target.value)} /></label> : null}
    <label className="sf-input"><span>메모</span><input value={memo} onChange={e => setMemo(e.target.value)} placeholder="예: 11월 실사" /></label>
    {error && <p className="sf-hint is-warn">{error}</p>}
    <div className="sf-modal-foot"><button type="button" className="sf-btn" onClick={onClose}>닫기</button>
      <button type="button" className="sf-btn is-primary" disabled={busy} onClick={async () => { setBusy(true); try { await invSend('POST', '/adjust', { item_id: item.id, hospital_stock: h === '' ? null : Number(h), vendor_stock: item.prepaid && v !== '' ? Number(v) : null, memo, date: today }); onDone('재고를 맞췄어요.'); } catch (e) { setError(errText(e)); setBusy(false); } }}>{busy && <SavingMark />}맞추기</button></div>
  </Modal>;
}

type DailyItem = { id: number; name: string; stock_unit: string; hospital_stock: number; stock_at: number; daily_mode: 'usage' | 'count'; vendor_name?: string | null; used: number | null; open_fix?: number | null; used15: number };
// 일일재고(2026-11-08 사용자 지정): 언제든 기록·수정. 팀장이 출근한 날은 품목 방식대로(당일 사용량 또는 마감재고),
// 팀장이 출근하지 않은 날(미입력·휴무·연차·상담·휴일)은 당일 사용량·모델링 사용 인원은 닫고 모든 품목 마감재고만 적는다.
// 총 피부관리 인원·메모는 늘 열림. 못 센 날 생긴 차이는 따로 표시하지 않는다.
// 2026-11-09 사용자: 휴무·연차·상담 날은 건너뛰고, 다음 근무일에 센 마감재고를 적으면 병원재고가 그 수량이 된다(장부보다 많아도).
// 비운 칸은 그 품목을 건드리지 않는다. 팩 종류(사용량 품목)도 기본은 마감 전 재고 + 마감재고, '사용량'을 누르면 사용량으로.
type DailyRecord = { state: 'done' | 'missing' | 'skip' | null; first_at: number | null; first_by: string | null; last_at: number | null; last_by: string | null;
  log: { at: number; by: string | null; patients: number | null; memo: string | null; items?: Record<string, { used: number; before: number; left?: number; unit: string }> }[] };
const RECORD_LABEL = { done: '작성완료', missing: '미작성', skip: '작성제외' } as const;
const fmtStamp = (ms: number) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function DailyClose({ today, notify, onSaved }: { items: InvItem[]; today: string; notify: (m: string) => void; onSaved: () => void }) {
  const [date, setDate] = useState(today);
  const [data, setData] = useState<{ record?: DailyRecord; check?: { ok: boolean; label: string | null }; patients_auto?: number | null; day: { patients: number | null; status: string | null; extra: Record<string, unknown> } | null; items: DailyItem[] } | null>(null);
  const [patients, setPatients] = useState(''), [status, setStatus] = useState(''), [vals, setVals] = useState<Record<number, string>>({}), [people, setPeople] = useState('');
  const [busy, setBusy] = useState(false), [hist, setHist] = useState(false), [uses, setUses] = useState<Record<number, string>>({});
  const load = useCallback(async () => {
    const d = await invGet('/daily', { date });
    setData(d); setPatients(d.day?.patients == null ? '' : String(d.day.patients)); setStatus(d.day?.status || ''); setPeople(d.day?.extra?.modeling_people == null ? '' : String(d.day.extra.modeling_people));
    // 이미 적은 날: 마감재고 칸에 그날 마감 수량(stock_at). 당일 사용량 칸은 마감 전 재고를 고친 날만 채우고(고친 값 − 마감재고),
    // 그 밖의 날은 비워 흐린 계산값으로만 보여 준다 → 마감재고만 고쳐도 사용량이 다시 계산됨(2026-11-10)
    // 이미 적은 날은 적었던 숫자 그대로(마감재고 = 그날 마감 수량, 당일 사용량 = 그날 사용 기록)
    setVals(Object.fromEntries(d.items.map((it: DailyItem) => [it.id, it.used == null ? '' : String(it.stock_at)])));
    setUses(Object.fromEntries(d.items.map((it: DailyItem) => [it.id, it.used == null ? '' : String(Math.round(((it.used || 0) + (it.open_fix || 0)) * 1000) / 1000)])));
  }, [date]);
  useEffect(() => { setData(null); load().catch(e => notify(errText(e))); }, [load, notify]);
  // 성과에 관리 인원을 적으면 총 피부관리 인원이 바뀌므로 다시 불러온다
  useEffect(() => { const on = () => { load().catch(() => undefined); }; window.addEventListener('staff-data-changed', on); return () => window.removeEventListener('staff-data-changed', on); }, [load]);
  if (!data) return <LoadingBox />;
  // 팀장 근태를 아직 안 적은 날은 막지 않는다(먼저 재고를 세는 날도 있어서) — 휴무·연차·상담·휴일로 적힌 날만 마감재고만
  const off = data.check ? !data.check.ok && data.check.label !== '팀장 근태 미입력' : false;
  // 일일재고 카드 = 적는 칸 두 개(2026-11-10 사용자 '작성칸은 마감재고·당일 사용량'): 마감재고 | 당일 사용량.
  //  하나만 적으면 다른 하나는 장부(마감 전 재고)로 계산해 흐리게 보여 주고, 둘 다 적으면 마감 전 재고 = 마감재고 + 사용량으로 고쳐 저장(월말 사용량 정확).
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const usageCard = (it: DailyItem) => it.daily_mode === 'usage' && !off;
  const num = (v: string | undefined) => (v === '' || v == null ? null : Number(v));
  const ledgerOf = (it: DailyItem) => r3(it.stock_at + (it.used || 0)); // 남은 수량(그날 마감 전 장부)
  const diffOf = (it: DailyItem) => { const left = num(vals[it.id]), use = usageCard(it) ? num(uses[it.id]) : null; return left != null && use != null ? r3(left - (ledgerOf(it) - use)) : 0; };
  const filled = data.items.filter(it => num(vals[it.id]) != null || (usageCard(it) && num(uses[it.id]) != null)).length;
  const diffs = data.items.filter(it => diffOf(it) !== 0).length;
  // 예전 앱 방식(2026-11-10 사용자 지정): 남은 수량(글자) · 당일 사용량 · 마감재고. 둘 다 적으면 적은 그대로 — 사용량은 사용 기록, 마감재고가 병원재고,
  // 남은 수량 − 사용량과 다르면 그 차이만 '재고 차이'(마감재고 옆 빨간 (−1)). 마감재고 품목(모델링팩·해면)은 마감재고만.
  const save = async () => {
    const used: Record<number, number | null> = {}, closing: Record<number, number> = {}, opening: Record<number, number> = {};
    for (const it of data.items) {
      const left = num(vals[it.id]), use = usageCard(it) ? num(uses[it.id]) : null, ledger = ledgerOf(it);
      if (left == null && use == null) continue; // 둘 다 비움 = 이번에 안 셈 → 그대로 둠
      if ((left != null && (!Number.isFinite(left) || left < 0)) || (use != null && (!Number.isFinite(use) || use < 0))) { notify(`${it.name}: 0 이상으로 적어 주세요.`); return; }
      if (left != null) {
        closing[it.id] = left;
        if (use != null && r3(left + use) !== ledger) opening[it.id] = r3(left + use);
      } else if (use != null) {
        if (use > ledger) { notify(`${it.name}: 당일 사용량이 남은 수량(${withUnit(ledger, it.stock_unit)})보다 많아요.`); return; }
        used[it.id] = use;
      }
    }
    setBusy(true);
    try { await invSend('POST', '/daily', { date, patients: patients === '' ? null : Number(patients), status: status || null, extra: { modeling_people: off ? (data.day?.extra?.modeling_people ?? null) : people === '' ? null : Number(people) }, used, closing, opening }); notify('마감을 저장했어요.'); announceInventory(); onSaved(); await load(); }
    catch (e) { notify(errText(e)); } finally { setBusy(false); }
  };
  return <div className={`iv-daily${off ? ' is-off' : ''}`}>
    <div className="iv-row iv-daybar">
      <label className="sf-input"><span>마감일</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="sf-input"><span>총 피부관리 인원</span>{data.patients_auto != null
        ? <input type="number" value={data.patients_auto} readOnly disabled aria-label="총 피부관리 인원(성과 관리 인원 합계)" />
        : <input type="number" min={0} inputMode="numeric" value={patients} onChange={e => setPatients(e.target.value)} placeholder="명" />}</label>
      <label className="sf-input"><span>메모(휴무 등)</span><input type="text" value={status} onChange={e => setStatus(e.target.value)} placeholder="선택" /></label>
      <div className="iv-row-acts"><span className="iv-dcount">입력 {filled}/{data.items.length}{diffs ? ` · 재고 차이 ${diffs}개` : ''}</span>{data.record?.state && <span className={`iv-dstate is-${data.record.state}`}>{RECORD_LABEL[data.record.state]}</span>}
        {off && <span className="iv-tag iv-off-tag">{data.check?.label}</span>}
        {!!data.record?.log.length && <button type="button" className="sf-btn" onClick={() => setHist(true)}>이력 {data.record.log.length}</button>}
        <button type="button" className="sf-btn is-primary" disabled={busy} onClick={() => void save()}>{busy && <SavingMark />}저장</button></div>
    </div>
    {hist && data.record && <Modal title={`${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일 일일재고 이력`} onClose={() => setHist(false)}>
      <ul className="sf-list sf-log">{data.record.log.slice().reverse().map((l, i) => <li key={i}><b>{fmtStamp(l.at)}{l.by ? ` · ${l.by}` : ''}</b>
        <span>{[l.patients != null ? `총 피부관리 인원 ${l.patients}명` : '', ...Object.entries(l.items || {}).map(([n, v]) => `${n} ${v.left != null ? `마감재고 ${fmtQty(v.left)} · ` : ''}사용 ${fmtQty(v.used)}${v.before ? ` (전 ${fmtQty(v.before)})` : ''} ${v.unit}`)].filter(Boolean).join(' · ') || '—'}</span></li>)}</ul>
    </Modal>}
    <div className="iv-grid">{data.items.map(it => {
      const d = diffOf(it), u = it.stock_unit;
      const field = (label: React.ReactNode, value: string, set: (v: string) => void, aria: string, unit = u, mode: 'decimal' | 'numeric' = 'decimal') =>
        <label className="iv-drow"><span>{label}</span><input type="number" min={0} inputMode={mode} value={value} onChange={e => set(e.target.value)} aria-label={aria} /><em>{unit}</em></label>;
      return <div key={it.id} className="iv-dcard">
        <div className="iv-dcard-head"><b>{it.name}</b>{it.vendor_name ? <small>{it.vendor_name}</small> : null}</div>
        {usageCard(it) && <div className="iv-drow is-text"><span>남은 수량</span><b>{fmtQty(ledgerOf(it))}</b><em>{u}</em></div>}
        {it.name.includes('모델링') && !off && field('사용 인원', people, setPeople, '모델링팩 사용 인원', '명', 'numeric')}
        {usageCard(it) && field('당일 사용량', uses[it.id] ?? '', v => setUses(x => ({ ...x, [it.id]: v })), `${it.name} 당일 사용량`)}
        {field(<>마감재고{d ? <i className="iv-ddiff"> ({d > 0 ? '+' : ''}{fmtQty(d)})</i> : null}</>, vals[it.id] ?? '', v => setVals(x => ({ ...x, [it.id]: v })), `${it.name} 마감재고`)}
        <p className="iv-d15">15일 사용 {withUnit(it.used15, u)}</p>
      </div>;
    })}</div>
  </div>;
}

// 예전 앱 자료(사진에서 옮긴 직원 근태·성과·재고 기록) 파일을 처음 한 번 넣는다.
export function OldDataImport({ onDone, merge = false }: { onDone: () => void; merge?: boolean }) {
  const [file, setFile] = useState<{ name: string; tables: Record<string, Record<string, unknown>[]> } | null>(null);
  const [state, setState] = useState({ running: false, text: '', error: '' });
  const pick = async (f: File | undefined) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data?.format !== 'dachaeum-old-app' || typeof data.tables !== 'object') throw new Error('예전 자료 파일이 아니에요.');
      setFile({ name: f.name, tables: data.tables }); setState({ running: false, text: '', error: '' });
    } catch (e) { setFile(null); setState({ running: false, text: '', error: errText(e) }); }
  };
  const [code, setCode] = useState('');
  // 코드로 넣기: 사이트에 암호화해 둔 예전 자료(/old-data.enc)를 받은 코드로 브라우저에서 풀어 넣는다(저장소 공개라 원본은 올리지 않음)
  const fromCode = async () => {
    setState({ running: true, text: '자료를 여는 중…', error: '' });
    try {
      const enc = await (await fetch('/old-data.enc', { cache: 'no-store' })).json();
      const b = (x: string) => Uint8Array.from(atob(x), c => c.charCodeAt(0));
      const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code.trim().toUpperCase()), 'PBKDF2', false, ['deriveKey']);
      const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b(enc.salt), iterations: enc.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      let plain: ArrayBuffer;
      try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b(enc.iv) }, key, b(enc.data)); } catch { throw new Error('코드가 맞지 않아요.'); }
      const data = JSON.parse(new TextDecoder().decode(plain));
      await run({ name: '예전 앱 자료(코드)', tables: data.tables });
    } catch (e) { setState({ running: false, text: '', error: errText(e) }); }
  };
  const run = async (src = file) => {
    if (!src) return;
    const file = src;
    const entries = Object.entries(file.tables);
    const total = entries.reduce((n, [, rows]) => n + rows.length, 0);
    let sent = 0;
    setState({ running: true, text: '준비 중…', error: '' });
    if (merge) {
      const rows = file.tables.staff_attendance || [];
      let added = 0, filled = 0;
      try {
        for (let i = 0; i < rows.length; i += 15) {
          const r = await invSend('POST', '/import-merge', { rows: rows.slice(i, i + 15) });
          added += r.added; filled += r.filled; setState(s => ({ ...s, text: `확인 중 ${Math.min(i + 15, rows.length)} / ${rows.length}` }));
        }
        setState({ running: false, text: `근태 ${added}일을 더하고, 비어 있던 성과 숫자 ${filled}칸을 채웠어요. 이미 입력한 값은 그대로예요.`, error: '' });
        window.dispatchEvent(new Event('staff-data-changed')); onDone();
      } catch (e) { setState({ running: false, text: '', error: `${errText(e)} — 다시 눌러도 같은 값은 두 번 들어가지 않아요.` }); }
      return;
    }
    try {
      await invSend('POST', '/import', { step: 'start' });
      for (const [table, rows] of entries) for (let i = 0; i < rows.length; i += 40) {
        await invSend('POST', '/import', { step: 'rows', table, rows: rows.slice(i, i + 40) });
        sent += Math.min(40, rows.length - i); setState(s => ({ ...s, text: `넣는 중 ${sent} / ${total}` }));
      }
      await invSend('POST', '/import', { step: 'finish', label: file.name });
      setState({ running: false, text: `예전 자료 ${total}건을 넣었어요.`, error: '' }); window.dispatchEvent(new Event('staff-data-changed')); onDone();
    } catch (e) { setState({ running: false, text: '', error: `${errText(e)} — 다시 누르면 처음부터 다시 넣어요.` }); }
  };
  return <section className={`iv-import${merge ? ' is-merge' : ''}`}>
    <div><b>{merge ? '예전 근태·성과 더 넣기' : '예전 앱 자료 넣기'}</b></div>
    <div className="iv-inline">
      <label className="sf-btn"><input type="file" accept="application/json,.json" hidden onChange={e => void pick(e.target.files?.[0])} />{file ? file.name : '파일 고르기'}</label>
      <button type="button" className="sf-btn is-primary" disabled={!file || state.running} onClick={() => void run()}>{state.running && <SavingMark />}{merge ? '더 넣기' : '넣기'}</button>
    </div>
    {!merge && <div className="iv-inline iv-code"><span className="sf-hint">또는 받은 코드로</span>
      <input type="text" value={code} onChange={e => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" autoComplete="off" spellCheck={false} aria-label="예전 자료 코드" />
      <button type="button" className="sf-btn is-primary" disabled={code.trim().length < 16 || state.running} onClick={() => void fromCode()}>{state.running && <SavingMark />}코드로 넣기</button></div>}
    {state.text && <p className="sf-hint">{state.text}</p>}
    {state.error && <p className="sf-hint is-warn">{state.error}</p>}
  </section>;
}

// 아직 예전 자료를 안 넣었으면 직원 화면 위에도 넣기 칸을 보여 준다
export function OldDataBanner() {
  const [imported, setImported] = useState<string | null | undefined>(undefined);
  useEffect(() => { invGet('/import').then(d => setImported(d.imported), () => setImported('?')); }, []);
  if (imported !== null) return null;
  return <OldDataImport onDone={() => { setImported('done'); announceInventory(); }} />;
}

/* ───────────── 재고주문 ───────────── */
export function StockOrder() {
  const { state, error, reload } = useInventory();
  const [toast, setToast] = useToast();
  const [tab, setTab] = useState<'order' | 'items'>('order');
  const [q, setQ] = useState('');
  if (error) return <Problem error={error} />;
  if (!state) return <LoadingBox />;
  return <Shell toast={toast}>
    <div className="sf-bar iv-obar"><Seg label="보기" value={tab} onChange={setTab} options={[['order', '주문·받기'], ['items', '품목·구매조건']]} />
      {tab === 'order' && <input className="iv-search" type="search" placeholder="품목·거래처 검색" aria-label="품목·거래처 검색" value={q} onChange={e => setQ(e.target.value)} />}</div>
    {tab === 'order' ? <OrderBoard state={state} q={q} notify={setToast} /> : <ItemEditor state={state} notify={setToast} onChange={reload} />}
  </Shell>;
}

// 주문·받기 = 한 곳(2026-11-09 사용자 '제품마다 구분 잘해주고 한곳에 모아서'): 왼쪽 품목 목록을 선결제 품목 / 일반 품목으로 나누고,
// 오른쪽 고른 품목 하나에서 ① 주문 → ② 받기(사진 + 입고확정)까지 끝낸다. 재고입출고의 따로 있던 받기 탭은 없앴다.
function OrderBoard({ state, q, notify }: { state: InvState; q: string; notify: (m: string) => void }) {
  const [pickId, setPickId] = useState<number | null>(null);
  const [pick, setPick] = useState<{ item: InvItem; opt: InvOption } | null>(null);
  const [onlyWait, setOnlyWait] = useState(false);
  const waiting = (id: number) => state.orders.filter(o => o.item_id === id);
  const list = state.items.filter(it => (!q || it.name.includes(q) || (it.vendor_name || '').includes(q)) && (!onlyWait || waiting(it.id).length > 0));
  const RANK: Record<Flag, number> = { bringing: 5, wait: 4, low: 3, bring: 2 };
  const rank = (it: InvItem) => { const f = flagOf(it, state.orders); return f ? RANK[f] : 0; };
  const groups: [string, InvItem[]][] = [['선결제 품목', list.filter(i => i.prepaid)], ['일반 품목', list.filter(i => !i.prepaid)]];
  for (const g of groups) g[1].sort((x, y) => rank(y) - rank(x));
  const flat = groups.flatMap(g => g[1]);
  const item = flat.find(it => it.id === pickId) ?? flat[0];
  return <>
    <div className="iv-split">
      <nav className="iv-split-list" aria-label="품목">
        <div className="iv-split-count">
          <span>품목 {flat.length}</span>
          {state.orders.length > 0 && <button type="button" className={`iv-wait-filter${onlyWait ? ' is-on' : ''}`} aria-pressed={onlyWait} onClick={() => setOnlyWait(v => !v)}>받을 것 {state.orders.length}</button>}
        </div>
        {flat.length ? groups.filter(g => g[1].length).map(([title, its]) => <div key={title} className="iv-split-group">
          <p className="iv-split-gtitle">{title}</p>
          <ul>{its.map(it => <li key={it.id}>
            <button type="button" aria-current={item?.id === it.id ? 'true' : undefined} onClick={() => setPickId(it.id)}>
              <span className="iv-split-name">{it.name}</span>
              <FlagTag flag={flagOf(it, state.orders)} />
            </button></li>)}</ul></div>)
          : <p className="iv-split-empty">찾는 품목이 없어요</p>}
      </nav>
      <section className="iv-split-detail" aria-label="품목 상세">
        {item ? <>
          <header className="iv-d-head">
            <div><h3>{item.name}<span className={`iv-kind${item.prepaid ? ' is-pp' : ''}`}>{item.prepaid ? '선결제' : '일반'}</span><FlagTag flag={flagOf(item, state.orders)} /></h3><p>{item.vendor_name || '거래처 없음'}{item.category ? ` · ${item.category}` : ''}</p></div>
          </header>
          <dl className="iv-d-stats">
            <div><dt>병원재고</dt><dd className={flagOf(item, state.orders) === 'low' ? 'is-low' : ''}>{withUnit(item.hospital_stock, item.stock_unit)}</dd></div>
            {item.prepaid ? <div><dt>업체 보관 잔량</dt><dd>{withUnit(item.vendor_stock, item.stock_unit)}</dd></div> : null}
            <div><dt>최소재고</dt><dd>{item.min_stock > 0 ? withUnit(item.min_stock, item.stock_unit) : '—'}</dd></div>
            <div><dt>{item.prepaid ? '개당원가' : '구매단가'}</dt><dd>{item.prepaid ? (item.unit_cost != null ? `${item.unit_cost.toLocaleString('ko-KR')}원` : '—') : fmtWon(item.price)}</dd></div>
            {item.paid_unit_cost != null ? <div><dt>유상단가</dt><dd>{item.paid_unit_cost.toLocaleString('ko-KR')}원</dd></div> : null}
          </dl>
          {item.prepaid ? <PrepaidOrder key={item.id} item={item} orders={state.orders} today={state.today} notify={notify} /> : <div className="iv-d-sec"><h4><i className="iv-step">1</i>주문</h4>
            {!item.options.some(o => !o.prepaid) && <p className="iv-recv-none">구매조건 없음</p>}
            <ul className="iv-d-opts">{item.options.filter(o => !o.prepaid).map(o => <li key={o.id}>
              <div className="iv-d-opt-main"><b>{o.label || `${fmtQty(o.qty)} ${item.stock_unit}`}</b>
                <span>{fmtQty(o.qty)} {item.stock_unit}{o.bonus_qty ? ` + 증정 ${fmtQty(o.bonus_qty)}` : ''}</span></div>
              <div className="iv-d-opt-price"><b>{fmtWon(o.amount)}</b>{o.amount != null && o.amount >= 10000 && <small>{readWon(o.amount)}</small>}</div>
              <button type="button" className="sf-btn is-primary" onClick={() => setPick({ item, opt: o })}>주문</button>
            </li>)}</ul>
          </div>}
          <ReceiveHere key={`r${item.id}`} item={item} orders={waiting(item.id)} today={state.today} notify={notify} />
        </> : <p className="iv-split-empty">왼쪽에서 품목을 고르세요</p>}
      </section>
    </div>
    {pick && <OrderDialog item={pick.item} opt={pick.opt} today={state.today} onClose={() => setPick(null)} onDone={msg => { notify(msg); setPick(null); announceInventory(); }} />}
  </>;
}

// ② 받기: 고른 품목의 받기 전 주문만. 실제 도착 수량 + 명세서 사진 + 입고확정(사진은 그 입고 기록에 바로 올라가 '명세서 받음').
// 선결제 품목은 잔량에서(잔량 −, 병원재고 +), 일반 품목은 나눠 받으면 날짜마다 따로. 아래에 일반 품목은 '증정·행사로 받기', 선결제 품목은 '잔량 고치기'.
function ReceiveHere({ item, orders, today, notify }: { item: InvItem; orders: InvOrder[]; today: string; notify: (m: string) => void }) {
  const [date, setDate] = useState(today);
  const [actual, setActual] = useState<Record<number, string>>({});
  const [photo, setPhoto] = useState<Record<string, File | undefined>>({});
  const [busy, setBusy] = useState('');
  const [extra, setExtra] = useState<'gift' | 'fix' | null>(null);
  const [gift, setGift] = useState({ qty: '', bonus: '', amount: '', memo: '' });
  const [fixV, setFixV] = useState(String(item.vendor_stock));
  const u = item.stock_unit;
  const run = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(key);
    try {
      const r = await fn() as { tx_id?: number } | undefined;
      const f = photo[key];
      if (f && r?.tx_id) {
        try { await invUploadInvoice(f, [r.tx_id]); msg += ' 명세서 사진도 올렸어요.'; }
        catch (e) { msg += ` 사진은 못 올렸어요(${errText(e)}). 입출고 내역에서 다시 올려 주세요.`; }
      }
      setPhoto(v => ({ ...v, [key]: undefined }));
      notify(msg); announceInventory(); return true;
    } catch (e) { notify(errText(e)); return false; } finally { setBusy(''); }
  };
  const left = (o: InvOrder) => Math.round((o.qty + o.bonus_qty - (o.received_qty || 0)) * 1000) / 1000;
  const cancel = async (id: number) => { try { await invSend('POST', `/orders/${id}/cancel`); notify('주문을 정리했어요.'); announceInventory(); } catch (e) { notify(errText(e)); } };
  const gBuy = Number(gift.qty) || 0, gBonus = Number(gift.bonus) || 0, gTotal = Math.round((gBuy + gBonus) * 1000) / 1000;
  const gNormal = item.price != null ? Math.round(item.price * (gBuy / (item.pack_qty || 1))) : null;
  const gPay = gift.amount === '' ? gNormal : Number(gift.amount);
  return <div className="iv-d-sec iv-recv">
    <div className="iv-recv-head"><h4><i className="iv-step">2</i>받기</h4>
      <label className="sf-input iv-recv-date"><span>입고일</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label></div>
    {orders.length ? <ul className="iv-recv-list">{orders.map(o => <li key={o.id}>
      <div className="iv-recv-what"><b>{o.ordered_at.slice(5).replace('-', '/')} 주문 · {o.prepaid ? '병원 입고 ' : ''}{fmtQty(o.qty)}{o.bonus_qty ? ` + 증정 ${fmtQty(o.bonus_qty)}` : ''} {u}</b>
        <small>{o.prepaid ? (o.contract_qty ? `선결제 계약 ${fmtQty(o.contract_qty)} ${u} · ${fmtWon(o.contract_amount ?? null)}` : '업체 보관 잔량에서') : `${o.option_label || ''} · ${fmtWon(o.amount)}`}{(o.received_qty || 0) > 0 ? ` · 받음 ${fmtQty(o.received_qty || 0)} · 남음 ${fmtQty(left(o))}` : ''}</small></div>
      <label className="sf-input"><span>실제 입고 수량 ({u})</span><input type="number" min={0} inputMode="decimal" value={actual[o.id] ?? String(left(o))} onChange={e => setActual(a => ({ ...a, [o.id]: e.target.value }))} /></label>
      <PhotoPick file={photo[`o${o.id}`]} onPick={f => setPhoto(v => ({ ...v, [`o${o.id}`]: f }))} />
      <div className="iv-recv-acts">
        <button type="button" className="sf-btn" onClick={() => void cancel(o.id)}>{(o.received_qty || 0) > 0 ? '마감' : '취소'}</button>
        <button type="button" className="sf-btn is-primary" disabled={busy === `o${o.id}` || !(Number(actual[o.id] ?? left(o)) > 0)} onClick={() => void run(`o${o.id}`, () => invSend('POST', '/receive', { order_id: o.id, actual_qty: Number(actual[o.id] ?? left(o)), date }), '입고확정했어요.')}>{busy === `o${o.id}` && <SavingMark />}입고확정</button>
      </div>
    
      {o.prepaid ? (() => { const a = Number(actual[o.id] ?? left(o)) || 0; return <div className="iv-recv-calc">
        <span>이번 입고 <b>{fmtQty(a)} {u}</b></span>
        <span>병원재고 {fmtQty(item.hospital_stock)} → <b>{fmtQty(Math.round((item.hospital_stock + a) * 1000) / 1000)} {u}</b></span>
        <span>업체 보관 잔량 {fmtQty(item.vendor_stock)} → <b className={a > item.vendor_stock ? 'is-warn' : ''}>{fmtQty(Math.round((item.vendor_stock - a) * 1000) / 1000)} {u}</b></span></div>; })() : null}
    </li>)}</ul> : <p className="iv-recv-none">받을 주문 없음</p>}
    {!!item.prepaid && orders.length > 0 && <p className="iv-recv-note">입고확정 시 실제 입고 수량만큼 병원재고가 증가하고, 업체 보관 잔량은 같은 수량만큼 감소합니다.<br />업체 보관 잔량을 별도로 수정할 필요는 없습니다.</p>}
    <div className="iv-recv-more">
      {item.prepaid
        ? <button type="button" className={`sf-btn${extra === 'fix' ? ' is-on' : ''}`} onClick={() => { setExtra(extra === 'fix' ? null : 'fix'); setFixV(String(item.vendor_stock)); }}>잔량 고치기</button>
        : <button type="button" className={`sf-btn${extra === 'gift' ? ' is-on' : ''}`} onClick={() => setExtra(extra === 'gift' ? null : 'gift')}>증정·행사로 받기</button>}
    </div>
    {extra === 'fix' && item.prepaid ? <div className="iv-recv-extra">
      <label className="sf-input"><span>업체 보관 잔량 ({u})</span><input type="number" min={0} inputMode="decimal" value={fixV} onChange={e => setFixV(e.target.value)} /></label>
      <div className="iv-recv-acts"><button type="button" className="sf-btn is-primary" disabled={fixV === '' || Number(fixV) < 0 || busy === 'fix'} onClick={async () => { if (await run('fix', () => invSend('POST', '/adjust', { item_id: item.id, vendor_stock: Number(fixV), date, memo: '업체 보관 잔량 고치기' }), '업체 보관 잔량을 고쳤어요.')) setExtra(null); }}>{busy === 'fix' && <SavingMark />}저장</button></div>
    </div> : null}
    {extra === 'gift' && !item.prepaid ? <div className="iv-recv-extra">
      <QtyInput item={item} label="산 수량" value={gift.qty} onChange={v => setGift(x => ({ ...x, qty: v }))} />
      <label className="sf-input"><span>증정 수량 ({u})</span><input type="number" min={0} inputMode="decimal" value={gift.bonus} onChange={e => setGift(x => ({ ...x, bonus: e.target.value }))} placeholder="0" /></label>
      <label className="sf-input"><span>결제금액(원)</span><input type="number" min={0} inputMode="numeric" value={gift.amount} onChange={e => setGift(x => ({ ...x, amount: e.target.value }))} placeholder={gNormal != null ? `정상가 ${gNormal.toLocaleString('ko-KR')}` : '단가 미확인'} /></label>
      <label className="sf-input"><span>메모</span><input value={gift.memo} onChange={e => setGift(x => ({ ...x, memo: e.target.value }))} placeholder="예: 10+10, 5+2, 행사가" /></label>
      <PhotoPick file={photo.gift} onPick={f => setPhoto(v => ({ ...v, gift: f }))} />
      <div className="iv-recv-acts"><button type="button" className="sf-btn is-primary" disabled={!(gTotal > 0) || busy === 'gift'} onClick={async () => { if (await run('gift', () => invSend('POST', '/receive', { item_id: item.id, actual_qty: gTotal, bonus_qty: gBonus, amount: gift.amount === '' ? null : Number(gift.amount), memo: gift.memo, date }), '입고했어요.')) { setGift({ qty: '', bonus: '', amount: '', memo: '' }); setExtra(null); } }}>{busy === 'gift' && <SavingMark />}입고</button></div>
      {gTotal > 0 && <div className="iv-calc">
        <span>받는 수량 <b>{fmtQty(gTotal)} {u}</b>{gBonus > 0 ? ` (산 ${fmtQty(gBuy)} + 증정 ${fmtQty(gBonus)})` : ''}</span>
        <span>결제 <b>{fmtWon(gPay)}</b>{gNormal != null && gPay != null && gPay < gNormal ? ` · 정상가보다 ${(gNormal - gPay).toLocaleString('ko-KR')}원 저렴` : ''}</span>
        <span>병원재고 {withUnit(item.hospital_stock, u)} → <b>{withUnit(Math.round((item.hospital_stock + gTotal) * 1000) / 1000, u)}</b></span>
      </div>}
    </div> : null}
  </div>;
}

// 선결제 품목 주문(2026-11-09 사용자 지정, 사용자 문서의 '업체 보관 잔량' = 화면의 '업체 보관 잔량'): 주문수량 → 업체 보관 잔량을 먼저 모두 쓰고, 모자랄 때만 신규 선결제 옵션 하나(한 번에 결제).
// 주문 후 업체 보관 잔량은 예상값. 실제 업체 보관 잔량 차감은 같은 화면 ② 받기의 입고확정 때만.
function PrepaidOrder({ item, orders, today, notify }: { item: InvItem; orders: InvOrder[]; today: string; notify: (m: string) => void }) {
  const [qty, setQty] = useState(''), [optId, setOptId] = useState<number | null>(null), [date, setDate] = useState(today), [busy, setBusy] = useState(false);
  const opts = item.options.filter(o => o.prepaid);
  const reserved = orders.filter(o => o.item_id === item.id && o.prepaid).reduce((a, o) => a + o.qty, 0);
  const keep = Math.round(((item.vendor_stock || 0) - reserved) * 1000) / 1000;
  const n = Number(qty) || 0;
  const short = Math.max(0, Math.round((n - Math.max(0, keep)) * 1000) / 1000);
  const opt = short > 0 ? opts.find(o => o.id === optId) || null : null;
  const newQty = opt ? opt.qty + (opt.bonus_qty || 0) : 0;
  const after = Math.round((keep + newQty - n) * 1000) / 1000;
  const tooSmall = !!opt && newQty < short;
  const ready = n > 0 && (short === 0 || (!!opt && !tooSmall)) && !busy;
  const u = item.stock_unit;
  const submit = async () => {
    setBusy(true);
    try { await invSend('POST', '/prepaid-order', { item_id: item.id, qty: n, option_id: short > 0 ? opt?.id : undefined, date }); notify('주문했어요.'); setQty(''); setOptId(null); announceInventory(); }
    catch (e) { notify(errText(e)); } finally { setBusy(false); }
  };
  return <div className="iv-d-sec iv-pp">
    <h4><i className="iv-step">1</i>주문</h4>
    <div className="iv-pp-inputs">
      <label className="sf-input"><span>병원 입고 수량 ({u})</span><input type="number" min={0} inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} /></label>
      <label className="sf-input"><span>주문일</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
    </div>
    {short > 0 && <div className="iv-pp-optwrap"><span className="iv-pp-optlabel">주문 구성</span>
      <div className="iv-pp-opts" role="radiogroup" aria-label="주문 구성">{opts.map(o => <button key={o.id} type="button" role="radio" aria-checked={optId === o.id} className={optId === o.id ? 'is-on' : ''} onClick={() => setOptId(o.id)}>
      <b>{fmtQty(o.qty + (o.bonus_qty || 0))} {u}</b><span>{fmtWon(o.amount)}</span></button>)}</div></div>}
    <dl className="iv-pp-sum">
      <div><dt>병원 입고 수량</dt><dd>{fmtQty(n)} {u}</dd></div>
      <div><dt>주문 구성</dt><dd>{opt ? `${fmtQty(newQty)} ${u}` : '-'}</dd></div>
      <div><dt>현재 업체 보관 잔량</dt><dd>{fmtQty(keep)} {u}</dd></div>
      <div><dt>이번 선결제 금액</dt><dd>{fmtWon(opt?.amount ?? 0)}</dd></div>
      <div className="is-total"><dt>결제 예정 금액</dt><dd>{fmtWon(opt?.amount ?? 0)}{(opt?.amount ?? 0) >= 10000 && <small>{readWon(opt!.amount!)}</small>}</dd></div>
      <div><dt>주문 후 업체 보관 잔량</dt><dd className={short > 0 && !opt ? 'is-dim' : ''}>{short > 0 && !opt ? '—' : `${fmtQty(after)} ${u}`}</dd></div>
    </dl>
    {tooSmall && <p className="sf-hint is-warn">이 주문 구성으로는 {fmtQty(newQty - short)} {u} 모자라요.</p>}
    <div className="iv-pp-foot"><button type="button" className="sf-btn is-primary" disabled={!ready} onClick={() => void submit()}>{busy && <SavingMark />}주문</button></div>
  </div>;
}

function OrderDialog({ item, opt, today, onClose, onDone }: { item: InvItem; opt: InvOption; today: string; onClose: () => void; onDone: (m: string) => void }) {
  const [count, setCount] = useState('1'), [date, setDate] = useState(today), [memo, setMemo] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [ship, setShip] = useState('');
  const n = Number(count) || 0;
  const totalQty = (opt.qty + (opt.bonus_qty || 0)) * n, shipQty = Number(ship) || 0;
  const submit = async () => {
    setBusy(true); setError('');
    try { await invSend('POST', '/orders', { item_id: item.id, option_id: opt.id, count: n, date, memo, ship_qty: opt.prepaid ? shipQty : undefined }); onDone(opt.prepaid ? (shipQty > 0 ? `선결제를 기록했어요. 입고 예정 ${fmtQty(shipQty)} ${item.stock_unit}` : '선결제를 기록했어요.') : '주문했어요.'); }
    catch (e) { setError(errText(e)); setBusy(false); }
  };
  const total = opt.amount == null ? null : opt.amount * n;
  return <Modal title={`${item.name} 주문`} onClose={onClose}>
    <dl className="sf-dl"><dt>구매조건</dt><dd>{opt.label || '-'}</dd><dt>1회 수량</dt><dd>{fmtQty(opt.qty)} {item.stock_unit}{opt.bonus_qty ? ` + 증정 ${fmtQty(opt.bonus_qty)}` : ''}</dd><dt>1회 결제금액</dt><dd>{fmtWon(opt.amount)}</dd></dl>
    <label className="sf-input"><span>주문 개수</span><input type="number" min={1} step={1} inputMode="numeric" value={count} onChange={e => setCount(e.target.value)} /></label>
    {!!opt.prepaid && <label className="sf-input"><span>병원 입고 수량 (전체 {fmtQty(totalQty)} {item.stock_unit} 중)</span><input type="number" min={0} max={totalQty} inputMode="decimal" value={ship} onChange={e => setShip(e.target.value)} placeholder="0" /></label>}
    {!!opt.prepaid && shipQty > 0 && <div className="iv-calc"><span>병원 입고 예정 <b>{withUnit(shipQty, item.stock_unit)}</b></span><span>업체 보관 <b className={shipQty > totalQty ? 'is-warn' : ''}>{withUnit(Math.round((totalQty - shipQty) * 1000) / 1000, item.stock_unit)}</b></span></div>}
    <label className="sf-input"><span>{opt.prepaid ? '결제일' : '주문일'}</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
    <label className="sf-input"><span>메모</span><input type="text" value={memo} onChange={e => setMemo(e.target.value)} placeholder="선택" /></label>
    <div className="iv-total"><span>{opt.prepaid ? '선결제 금액' : '결제금액'}</span><b>{fmtWon(total)}</b>{total != null && total >= 10000 && <small>{readWon(total)}</small>}</div>
    {error && <p className="sf-hint is-warn">{error}</p>}
    <div className="sf-modal-foot"><button type="button" className="sf-btn" onClick={onClose}>닫기</button><button type="button" className="sf-btn is-primary" disabled={busy || n < 1 || shipQty < 0 || shipQty > totalQty} onClick={() => void submit()}>{busy && <SavingMark />}{opt.prepaid ? '선결제 기록' : '주문'}</button></div>
  </Modal>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="sf-modal" role="dialog" aria-modal="true" aria-label={title}>
    <div className="sf-modal-back" onClick={onClose} />
    <div className="sf-modal-panel"><div className="sf-modal-head"><strong>{title}</strong><button type="button" className="iv-icon-btn" aria-label="닫기" onClick={onClose}><X size={18} strokeWidth={1.8} /></button></div>{children}</div>
  </div>;
}

function ItemEditor({ state, notify, onChange }: { state: InvState; notify: (m: string) => void; onChange: () => void }) {
  const [sel, setSel] = useState<number | 'new' | null>(null);
  const item = typeof sel === 'number' ? state.items.find(i => i.id === sel) || null : null;
  return <div className="iv-split">
    <div className="iv-side">
      <button type="button" className="sf-btn" onClick={() => setSel('new')}>+ 새 품목</button>
      <ul className="iv-ilist">{state.items.map(it => <li key={it.id}><button type="button" aria-pressed={sel === it.id} onClick={() => setSel(it.id)}><b>{it.name}</b><small>{it.vendor_name || '—'} · 조건 {it.options.length}개{it.price == null ? ' · 단가 미확인' : ''}</small></button></li>)}</ul>
    </div>
    <div className="iv-main">{sel == null ? <p className="sf-hint">왼쪽에서 품목을 고르세요.</p>
      : <ItemForm key={String(sel)} item={item} state={state} notify={notify} onSaved={() => { onChange(); announceInventory(); }} onDeleted={() => { setSel(null); onChange(); announceInventory(); }} />}</div>
  </div>;
}

function ItemForm({ item, state, notify, onSaved, onDeleted }: { item: InvItem | null; state: InvState; notify: (m: string) => void; onSaved: () => void; onDeleted: () => void }) {
  const [f, setF] = useState(() => ({
    name: item?.name || '', vendor_id: item?.vendor_id ? String(item.vendor_id) : '', category: item?.category || '', stock_unit: item?.stock_unit || 'ea', order_unit: item?.order_unit || '',
    pack_qty: item?.pack_qty == null ? '' : String(item.pack_qty), price: item?.price == null ? '' : String(item.price), min_stock: item ? String(item.min_stock || 0) : '0',
    daily_mode: item?.daily_mode || '', prepaid: !!item?.prepaid, memo: item?.memo || '',
  }));
  const [busy, setBusy] = useState(false), [askDel, setAskDel] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  const save = async () => {
    setBusy(true);
    try { await invSend('POST', '/items', { ...f, id: item?.id, is_pack: item?.is_pack, vendor_id: f.vendor_id || null, price: f.price === '' ? null : Number(f.price), pack_qty: f.pack_qty === '' ? null : Number(f.pack_qty), daily_mode: f.daily_mode || null }); notify('품목을 저장했어요.'); onSaved(); }
    catch (e) { notify(errText(e)); } finally { setBusy(false); }
  };
  return <div className="iv-form">
    <div className="iv-fgrid">
      <label className="sf-input"><span>품목 이름</span><input value={f.name} onChange={set('name')} /></label>
      <label className="sf-input"><span>거래처</span><select value={f.vendor_id} onChange={set('vendor_id')}><option value="">—</option>{state.vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
      <label className="sf-input"><span>분류</span><input value={f.category} onChange={set('category')} /></label>
      <label className="sf-input"><span>재고단위</span><input value={f.stock_unit} onChange={set('stock_unit')} placeholder="ea·sheet·kg·box" /></label>
      <label className="sf-input"><span>주문단위</span><input value={f.order_unit} onChange={set('order_unit')} placeholder="box·set" /></label>
      <label className="sf-input"><span>구성수량(주문단위 1개 = 재고단위 몇 개)</span><input type="number" min={0} value={f.pack_qty} onChange={set('pack_qty')} /></label>
      <label className="sf-input"><span>주문단위 가격(원, 비우면 단가 미확인)</span><input type="number" min={0} value={f.price} onChange={set('price')} /></label>
      <label className="sf-input"><span>위험 기준(재고단위)</span><input type="number" min={0} value={f.min_stock} onChange={set('min_stock')} /></label>
      <label className="sf-input"><span>일일 마감</span><select value={f.daily_mode} onChange={set('daily_mode')}><option value="">안 함</option><option value="usage">사용량 입력</option><option value="count">마감재고 입력</option></select></label>
      <label className="iv-check"><input type="checkbox" checked={f.prepaid} onChange={set('prepaid')} /> 선결제 품목</label>
      <label className="sf-input iv-wide"><span>메모</span><input value={f.memo} onChange={set('memo')} /></label>
    </div>
    <div className="sf-modal-foot">{item && (askDel ? <span className="iv-inline">이 품목을 목록에서 뺄까요? 기록은 남아요.
      <button type="button" className="sf-btn" onClick={() => setAskDel(false)}>취소</button><button type="button" className="sf-btn is-danger" onClick={async () => { try { await invSend('DELETE', `/items/${item.id}`); notify('품목을 뺐어요.'); onDeleted(); } catch (e) { notify(errText(e)); } }}>빼기</button></span>
      : <button type="button" className="sf-btn" onClick={() => setAskDel(true)}>품목 빼기</button>)}
      <button type="button" className="sf-btn is-primary" disabled={busy} onClick={() => void save()}>{busy && <SavingMark />}저장</button></div>
    {item && <Options item={item} notify={notify} onSaved={onSaved} />}
  </div>;
}

function Options({ item, notify, onSaved }: { item: InvItem; notify: (m: string) => void; onSaved: () => void }) {
  const blank = { id: 0, label: '', count: '', unit: item.order_unit && item.pack_qty && item.order_unit !== item.stock_unit ? 'order' : 'stock', amount: '', bonus: '', prepaid: false };
  const [f, setF] = useState(blank);
  const factor = f.unit === 'order' ? item.pack_qty || 1 : 1;
  const save = async () => {
    try {
      await invSend('POST', '/options', { id: f.id || undefined, item_id: item.id, label: f.label, qty: Number(f.count) * factor, bonus_qty: f.bonus === '' ? 0 : Number(f.bonus) * factor, amount: f.amount === '' ? null : Number(f.amount), prepaid: f.prepaid, unit_label: f.unit === 'order' ? item.order_unit : item.stock_unit });
      notify('구매조건을 저장했어요.'); setF(blank); onSaved();
    } catch (e) { notify(errText(e)); }
  };
  return <section className="iv-sec"><h3>구매조건</h3>
    <table className="sf-table"><thead><tr><th>이름</th><th className="num">구매수량</th><th className="num">총 결제금액</th><th className="num">증정수량</th><th /></tr></thead>
      <tbody>{item.options.map(o => <tr key={o.id}><td><b>{o.label || '—'}</b>{o.prepaid ? <small> · 선결제</small> : null}</td><td className="num">{fmtQty(o.qty)} {item.stock_unit}</td><td className="num">{fmtWon(o.amount)}</td><td className="num">{o.bonus_qty ? `${fmtQty(o.bonus_qty)} ${item.stock_unit}` : '없음'}</td>
        <td className="num iv-acts"><button type="button" className="sf-btn" onClick={() => setF({ id: o.id, label: o.label || '', count: String(o.qty), unit: 'stock', amount: o.amount == null ? '' : String(o.amount), bonus: o.bonus_qty ? String(o.bonus_qty) : '', prepaid: !!o.prepaid })}>수정</button>
          <button type="button" className="sf-btn" onClick={async () => { try { await invSend('DELETE', `/options/${o.id}`); notify('구매조건을 지웠어요.'); onSaved(); } catch (e) { notify(errText(e)); } }}>삭제</button></td></tr>)}
        {!item.options.length && <tr><td colSpan={5}><small>등록된 구매조건이 없어요.</small></td></tr>}</tbody></table>
    <div className="iv-fgrid iv-optform">
      <label className="sf-input"><span>이름</span><input value={f.label} onChange={e => setF(x => ({ ...x, label: e.target.value }))} placeholder="예: 1박스, 10+1 행사" /></label>
      <label className="sf-input"><span>구매수량</span><span className="iv-pair"><input type="number" min={0} value={f.count} onChange={e => setF(x => ({ ...x, count: e.target.value }))} />
        <select value={f.unit} onChange={e => setF(x => ({ ...x, unit: e.target.value }))}><option value="stock">{item.stock_unit}</option>{item.order_unit && item.order_unit !== item.stock_unit && item.pack_qty && <option value="order">{item.order_unit}({fmtQty(item.pack_qty)}{item.stock_unit})</option>}</select></span></label>
      <label className="sf-input"><span>총 결제금액(원)</span><input type="number" min={0} value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value }))} placeholder="비우면 미확인" /></label>
      <label className="sf-input"><span>증정수량(같은 단위)</span><input type="number" min={0} value={f.bonus} onChange={e => setF(x => ({ ...x, bonus: e.target.value }))} placeholder="없으면 비움" /></label>
      <label className="iv-check"><input type="checkbox" checked={f.prepaid} onChange={e => setF(x => ({ ...x, prepaid: e.target.checked }))} /> 선결제(결제 시 잔량 생성)</label>
      <div className="iv-inline">{f.id ? <button type="button" className="sf-btn" onClick={() => setF(blank)}>새로 입력</button> : null}<button type="button" className="sf-btn is-primary" disabled={!(Number(f.count) > 0)} onClick={() => void save()}>{f.id ? '조건 수정' : '조건 추가'}</button></div>
    </div>
  </section>;
}

/* ───────────── 재고입출고 ───────────── */
export function StockMove() {
  const { state, error } = useInventory();
  const [toast, setToast] = useToast();
  // 받기(입고)는 재고주문 '주문·받기'로 옮김(2026-11-09 사용자 '한곳에 모아서')
  const [tab, setTab] = useState<'out' | 'log'>('log');
  if (error) return <Problem error={error} />;
  if (!state) return <LoadingBox />;
  return <Shell toast={toast}>
    <div className="sf-bar"><Seg label="보기" value={tab} onChange={setTab} options={[['log', '입출고 내역'], ['out', '출고']]} /></div>
    {tab === 'out' ? <OutForm state={state} notify={setToast} /> : <TxLog notify={setToast} />}
  </Shell>;
}

function ItemSelect({ items, value, onChange }: { items: InvItem[]; value: string; onChange: (v: string) => void }) {
  return <select value={value} onChange={e => onChange(e.target.value)}><option value="">품목 선택</option>{items.map(it => <option key={it.id} value={it.id}>{it.name} ({fmtQty(it.hospital_stock)} {it.stock_unit})</option>)}</select>;
}
function QtyInput({ item, value, onChange, label }: { item: InvItem | undefined; value: string; onChange: (v: string) => void; label: string }) {
  const [unit, setUnit] = useState<'stock' | 'order'>('stock');
  const factor = unit === 'order' && item?.pack_qty ? item.pack_qty : 1;
  const [raw, setRaw] = useState('');
  useEffect(() => { if (value === '') setRaw(''); }, [value]);
  return <label className="sf-input"><span>{label}</span><span className="iv-pair">
    <input type="number" min={0} inputMode="decimal" value={raw} onChange={e => { setRaw(e.target.value); onChange(e.target.value === '' ? '' : String(Number(e.target.value) * factor)); }} />
    <select value={unit} onChange={e => { const u = e.target.value as 'stock' | 'order'; setUnit(u); const f = u === 'order' && item?.pack_qty ? item.pack_qty : 1; onChange(raw === '' ? '' : String(Number(raw) * f)); }}>
      <option value="stock">{item?.stock_unit || '개'}</option>{item?.order_unit && item.pack_qty && item.order_unit !== item.stock_unit && <option value="order">{item.order_unit}({fmtQty(item.pack_qty)}{item.stock_unit})</option>}</select></span>
    {unit === 'order' && value !== '' && <small>= {fmtQty(Number(value))} {item?.stock_unit}</small>}</label>;
}

// 명세서 사진 고르기(카메라·앨범·파일). 고른 사진은 입고확정 때 그 기록에 올라가고, 그래야 '명세서 받음'이 된다.
function PhotoPick({ file, onPick }: { file?: File; onPick: (f?: File) => void }) {
  return <label className={`iv-photo-pick${file ? ' is-on' : ''}`}>
    {file ? `명세서 사진 ✓` : '명세서 사진'}
    <input type="file" accept="image/*,application/pdf" onChange={e => { onPick(e.target.files?.[0]); e.currentTarget.value = ''; }} />
  </label>;
}

function OutForm({ state, notify }: { state: InvState; notify: (m: string) => void }) {
  const [f, setF] = useState({ item: '', qty: '', memo: '', date: state.today });
  const [busy, setBusy] = useState(false);
  const item = state.items.find(i => String(i.id) === f.item);
  const qty = Number(f.qty) || 0;
  return <section className="iv-sec"><h3>출고 등록</h3>
    <div className="iv-row">
      <label className="sf-input"><span>날짜</span><input type="date" value={f.date} onChange={e => setF(x => ({ ...x, date: e.target.value }))} /></label>
      <label className="sf-input"><span>품목</span><ItemSelect items={state.items} value={f.item} onChange={v => setF(x => ({ ...x, item: v }))} /></label>
      <QtyInput item={item} label="사용 수량" value={f.qty} onChange={v => setF(x => ({ ...x, qty: v }))} />
      <label className="sf-input"><span>메모</span><input value={f.memo} onChange={e => setF(x => ({ ...x, memo: e.target.value }))} placeholder="예: 피부팀 사용" /></label>
      <button type="button" className="sf-btn is-primary" disabled={!item || !(qty > 0) || busy} onClick={async () => {
        setBusy(true);
        try { await invSend('POST', '/out', { item_id: item!.id, qty, memo: f.memo, date: f.date }); notify('출고했어요.'); announceInventory(); setF(x => ({ ...x, item: '', qty: '', memo: '' })); }
        catch (e) { notify(errText(e)); } finally { setBusy(false); }
      }}>{busy && <SavingMark />}출고</button>
    </div>
    {item && <div className="iv-calc"><span>병원재고 {withUnit(item.hospital_stock, item.stock_unit)} → <b className={item.hospital_stock - qty < 0 ? 'is-warn' : ''}>{withUnit(Math.round((item.hospital_stock - qty) * 1000) / 1000, item.stock_unit)}</b></span></div>}
  </section>;
}

// 거래명세서(2026-11-09): 입고·선결제·반입 줄마다. 사진 → '사진 N'(= 명세서 받음, 사진을 올려야만), 예전 앱에서 받음으로 옮겨진 기록만 '받음', 돈이 나간 기록인데 없음 → '미등록', 0원 기록 → '올리기'(선택)
const INVOICE_KINDS = ['in', 'prepaid_buy', 'prepaid_in'];
const photosOf = (t: InvTx) => (t.invoice_ids ? String(t.invoice_ids).split(',').filter(Boolean) : []);
type InvState2 = 'photo' | 'paper' | 'missing' | 'optional';
const invoiceState = (t: InvTx): InvState2 => (photosOf(t).length ? 'photo' : t.invoice ? 'paper' : (t.amount || 0) > 0 ? 'missing' : 'optional');
const INVOICE_LABEL: Record<InvState2, (t: InvTx) => string> = { photo: t => `사진 ${photosOf(t).length}`, paper: () => '받음', missing: () => '미등록', optional: () => '올리기' };

function InvThumb({ id }: { id: string }) {
  const [pdf, setPdf] = useState(false); // 사진이 아니면(PDF) 글자로
  return pdf ? <span className="iv-inv-pdf">PDF</span> : <img src={invoiceSrc(id)} alt="거래명세서" onError={() => setPdf(true)} />;
}

function InvoiceDialog({ tx, rows, notify, onClose, onChange }: { tx: InvTx; rows: InvTx[]; notify: (m: string) => void; onClose: () => void; onChange: () => void }) {
  // 같은 날 다른 입고 기록도 같은 종이면 한 번에 걸 수 있게
  const sameDay = rows.filter(r => r.date === tx.date && INVOICE_KINDS.includes(r.kind));
  const [pick, setPick] = useState<number[]>([tx.id]);
  const [busy, setBusy] = useState(false), [big, setBig] = useState<string | null>(null), [drop, setDrop] = useState<string | null>(null);
  const photos = photosOf(tx);
  const upload = async (file: File | undefined) => {
    if (!file) return; setBusy(true);
    try { await invUploadInvoice(file, pick); notify(pick.length > 1 ? `명세서를 ${pick.length}건에 올렸어요.` : '명세서를 올렸어요.'); onChange(); announceInventory(); }
    catch (e) { notify(errText(e)); } finally { setBusy(false); }
  };
  const remove = async (id: string) => { try { await invSend('DELETE', `/invoices/${id}`); setDrop(null); notify('사진을 지웠어요.'); onChange(); announceInventory(); } catch (e) { notify(errText(e)); } };
  return <Modal title={`${Number(tx.date.slice(5, 7))}/${Number(tx.date.slice(8))} ${tx.item_name} 명세서`} onClose={onClose}>
    {photos.length > 0 && <ul className="iv-inv-photos">{photos.map(id => <li key={id}>
      <button type="button" className="iv-inv-thumb" onClick={() => setBig(id)} aria-label="크게 보기"><InvThumb id={id} /></button>
      {drop === id ? <span className="iv-inv-ask">지울까요? <button type="button" className="sf-btn is-danger" onClick={() => void remove(id)}>삭제</button><button type="button" className="sf-btn" onClick={() => setDrop(null)}>아니요</button></span>
        : <button type="button" className="sf-btn" onClick={() => setDrop(id)}>삭제</button>}</li>)}</ul>}
    {sameDay.length > 1 && <fieldset className="iv-inv-rows"><legend>같은 명세서에 함께 걸 기록</legend>
      {sameDay.map(r => <label key={r.id} className="iv-check"><input type="checkbox" checked={pick.includes(r.id)} disabled={r.id === tx.id} onChange={e => setPick(p => e.target.checked ? [...p, r.id] : p.filter(x => x !== r.id))} />
        {r.item_name} · {KIND_LABEL[r.kind]} {fmtQty(r.qty)} {r.stock_unit}{(r.amount || 0) > 0 ? ` · ${fmtWon(r.amount)}` : ''}</label>)}</fieldset>}
    <div className="sf-modal-foot">
      <label className={`sf-btn is-primary iv-inv-up${busy ? ' is-busy' : ''}`}>{busy && <SavingMark />}사진 올리기
        <input type="file" accept="image/*,application/pdf" disabled={busy} onChange={e => { void upload(e.target.files?.[0]); e.currentTarget.value = ''; }} /></label>
    </div>
    {big && <div className="iv-inv-big" role="dialog" aria-label="명세서 크게 보기" onClick={() => setBig(null)}><InvThumb id={big} /><a href={invoiceSrc(big)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>원본 열기</a></div>}
  </Modal>;
}

// 메모 앞부분이 팀(피부팀·간호팀·고객·직원구매 등)이면 떼어 '업체, 팀' 줄로, 나머지는 '사유' 줄로(2026-11-09 사용자)
const splitMemo = (memo?: string | null) => {
  const parts = (memo || '').split(' · ').map(x => x.trim()).filter(Boolean);
  const team = parts.length && /(팀|구매)$/.test(parts[0]) ? parts.shift()! : '';
  return { team, reason: parts.join(' · ').replace('선결제 잔량', '업체 보관 잔량') };
};
const KIND_TONE: Record<string, string> = { in: 'in', out: 'out', prepaid_buy: 'pp', prepaid_in: 'pp', adjust: 'adj' };
function TxLog({ notify }: { notify: (m: string) => void }) {
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [kind, setKind] = useState<'all' | 'in' | 'out'>('all');
  const [rows, setRows] = useState<InvTx[] | null>(null);
  const [ask, setAsk] = useState<InvTx | null>(null);
  const [inv, setInv] = useState<number | null>(null);
  const [edit, setEdit] = useState<{ tx: InvTx; v: string; d: string } | null>(null);
  const editable = (t: InvTx) => (t.kind === 'in' || t.kind === 'out' || t.kind === 'prepaid_in') && !t.daily_date;
  const load = useCallback(async () => {
    const k = kind === 'in' ? 'in,prepaid_buy,prepaid_in' : kind === 'out' ? 'out' : undefined;
    try { setRows((await invGet('/tx', { from: `${month}-01`, to: `${month}-31`, kind: k })).rows); } catch (e) { notify(errText(e)); setRows([]); }
  }, [month, kind, notify]);
  useEffect(() => { setRows(null); void load(); }, [load]);
  // 다른 화면(일일재고·주문·받기)에서 저장하면 내역도 새로 받음
  useEffect(() => subscribeInventory(() => { void load(); }), [load]);
  const effect = (t: InvTx) => [t.hospital_delta ? `병원재고 ${t.hospital_delta > 0 ? '−' : '+'}${fmtQty(Math.abs(t.hospital_delta))}` : '', t.vendor_delta ? `업체 보관 잔량 ${t.vendor_delta > 0 ? '−' : '+'}${fmtQty(Math.abs(t.vendor_delta))}` : ''].filter(Boolean).join(' · ');
  return <>
    <div className="sf-bar"><div className="sf-month"><button type="button" aria-label="이전 달" onClick={() => setMonth(m => shiftMonth(m, -1))}><ChevronLeft size={18} strokeWidth={2} /></button><strong>{month.slice(0, 4)}년 {Number(month.slice(5))}월</strong><button type="button" aria-label="다음 달" onClick={() => setMonth(m => shiftMonth(m, 1))}><ChevronRight size={18} strokeWidth={2} /></button></div>
      <Seg label="종류" value={kind} onChange={setKind} options={[['all', '전체'], ['in', <><i className="iv-dot is-in" aria-hidden="true" />입고</>], ['out', <><i className="iv-dot is-out" aria-hidden="true" />출고</>]]} /></div>
    {rows == null ? <LoadingBox /> : !rows.length ? <p className="sf-hint">이 달 기록이 없어요.</p> : <div className="iv-txwrap"><div className="iv-txgrid" role="table" aria-label="입출고 내역">
      <div className="iv-txrow is-head" role="row"><span role="columnheader">날짜</span><span role="columnheader">품목</span><span role="columnheader" className="mid">구분</span><span role="columnheader" className="num">수량</span><span role="columnheader" className="num">금액</span><span role="columnheader" className="num">병원재고</span><span role="columnheader" className="mid">명세서</span><span role="columnheader" aria-label="수정·삭제" /></div>
      {rows.map(t => { const m = splitMemo(t.memo); const sub = [m.team, m.reason].filter(Boolean).join(' · ');
        return <div key={t.id} className="iv-txrow" role="row">
        <span role="cell" className="c-date">{Number(t.date.slice(5, 7))}.{Number(t.date.slice(8))}</span>
        <span role="cell" className="iv-tx-item"><span className="iv-tx-l1"><b>{t.item_name}</b>{t.vendor_name && <em>{t.vendor_name}</em>}</span><small>{sub || ' '}</small></span>
        <span role="cell" className="mid"><i className={`iv-kdot is-${KIND_TONE[t.kind] || 'adj'}`} role="img" aria-label={KIND_LABEL[t.kind]} title={KIND_LABEL[t.kind]} /></span>
        <span role="cell" className="num">{fmtQty(t.qty)}{t.bonus_qty ? <small> +{fmtQty(t.bonus_qty)}</small> : null}<small className="iv-unit-t"> {t.stock_unit}</small></span>
        <span role="cell" className="num">{t.kind === 'out' || t.kind === 'prepaid_in' || t.kind === 'adjust' ? <span className="iv-muted">—</span> : fmtWon(t.amount)}</span>
        <span role="cell" className="num">{fmtQty(t.hospital_after)}</span>
        <span role="cell" className="mid">{INVOICE_KINDS.includes(t.kind) ? <button type="button" className={`iv-inv-mini is-${invoiceState(t)}`} onClick={() => setInv(t.id)} aria-label={`명세서 ${INVOICE_LABEL[invoiceState(t)](t)}`}>
          {invoiceState(t) === 'photo' ? <><Camera size={13} strokeWidth={2} />{photosOf(t).length}</> : INVOICE_LABEL[invoiceState(t)](t)}</button> : null}</span>
        <span role="cell" className="iv-row-btns">
          {editable(t) ? <button type="button" className="iv-icon-btn" aria-label="수정" title="수정" onClick={() => setEdit({ tx: t, v: String(Math.abs(t.hospital_delta)), d: t.date })}><Pencil size={16} strokeWidth={1.8} /></button> : <span className="iv-icon-btn is-empty" aria-hidden="true" />}
          <button type="button" className="iv-icon-btn is-danger" aria-label="삭제" title="삭제" onClick={() => setAsk(t)}><Trash2 size={16} strokeWidth={1.8} /></button></span>
      </div>; })}</div></div>}
    {edit && <Modal title="기록 수정" onClose={() => setEdit(null)}>
      <p>{Number(edit.tx.date.slice(5, 7))}월 {Number(edit.tx.date.slice(8))}일 {edit.tx.item_name} {KIND_LABEL[edit.tx.kind]}</p>
      <label className="sf-input"><span>{edit.tx.kind === 'out' ? '출고일' : '입고일'}</span><input type="date" max={todayLocal()} value={edit.d} onChange={e => setEdit({ ...edit, d: e.target.value })} /></label>
      <label className="sf-input"><span>{edit.tx.kind === 'out' ? '출고 수량' : '받은 수량'}{edit.tx.bonus_qty ? ' (증정 포함)' : ''} ({edit.tx.stock_unit})</span><input type="number" min={0} inputMode="decimal" value={edit.v} onChange={e => setEdit({ ...edit, v: e.target.value })} /></label>
      {(() => { const d = Math.round(((Number(edit.v) || 0) - Math.abs(edit.tx.hospital_delta)) * 1000) / 1000; const h = edit.tx.kind === 'out' ? -d : d;
        return d ? <div className="iv-calc"><span>병원재고 <b>{h > 0 ? '+' : '−'}{fmtQty(Math.abs(h))}</b></span>{edit.tx.kind === 'prepaid_in' && <span>업체 보관 잔량 <b>{d > 0 ? '−' : '+'}{fmtQty(Math.abs(d))}</b></span>}</div> : null; })()}
      <div className="sf-modal-foot"><button type="button" className="sf-btn" onClick={() => setEdit(null)}>취소</button>
        <button type="button" className="sf-btn is-primary" disabled={!(Number(edit.v) > 0) || !edit.d} onClick={async () => { try { await invSend('PATCH', `/tx/${edit.tx.id}`, { actual_qty: Number(edit.v), ...(edit.d !== edit.tx.date ? { date: edit.d } : {}) }); notify('고쳤어요.'); setEdit(null); announceInventory(); void load(); } catch (e) { notify(errText(e)); } }}>저장</button></div>
    </Modal>}
    {inv != null && rows && rows.find(r => r.id === inv) && <InvoiceDialog tx={rows.find(r => r.id === inv)!} rows={rows} notify={notify} onClose={() => setInv(null)} onChange={() => void load()} />}
    {ask && <Modal title="기록 삭제" onClose={() => setAsk(null)}>
      <p>{Number(ask.date.slice(5, 7))}월 {Number(ask.date.slice(8))}일 {ask.item_name} {KIND_LABEL[ask.kind]} {fmtQty(ask.qty)} {ask.stock_unit}</p>
      <p className="sf-ask">지우면 이 기록이 바꾼 재고를 되돌려요: {effect(ask) || '재고 변화 없음'}</p>
      <div className="sf-modal-foot"><button type="button" className="sf-btn" onClick={() => setAsk(null)}>취소</button>
        <button type="button" className="sf-btn is-danger" onClick={async () => { try { await invSend('DELETE', `/tx/${ask.id}`); notify('기록을 지우고 재고를 되돌렸어요.'); setAsk(null); announceInventory(); void load(); } catch (e) { notify(errText(e)); } }}>삭제</button></div>
    </Modal>}
  </>;
}

/* ───────────── 월말/연말보고서 ───────────── */
type MonthRep = { month: string; spend_total: number; spend_general: number; spend_prepaid: number; in_count: number; no_invoice: number; no_amount: number; patients: number; open_days: number;
  usage: { id: number; name: string; stock_unit: string; used: number; per_day: number | null }[];
  inbound?: { date: string; kind: string; qty: number; bonus_qty: number; amount: number | null; invoice: number; memo: string | null; item_name: string; stock_unit: string; vendor_name: string | null; payment_method: string | null }[];
  prepaid?: { id: number; name: string; stock_unit: string; vendor_stock: number; hospital_stock: number }[];
  stock?: { id: number; name: string; stock_unit: string; hospital_stock: number; min_stock: number }[] };

export function StockReport() {
  const [tab, setTab] = useState<'month' | 'year'>('month');
  const [month, setMonth] = useState(() => shiftMonth(todayLocal().slice(0, 7), -1));
  const [cmp, setCmp] = useState(() => shiftMonth(todayLocal().slice(0, 7), -2));
  const [year, setYear] = useState(() => todayLocal().slice(0, 4));
  const [rep, setRep] = useState<{ a: MonthRep; b: MonthRep } | null>(null);
  const [yr, setYr] = useState<MonthRep[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (tab !== 'month') return; setRep(null);
    Promise.all([invGet('/report', { month }), invGet('/report', { month: cmp })]).then(([a, b]) => setRep({ a, b }), e => setError(errText(e)));
  }, [tab, month, cmp]);
  useEffect(() => { if (tab !== 'year') return; setYr(null); invGet('/report-year', { year }).then(d => setYr(d.months), e => setError(errText(e))); }, [tab, year]);
  return <div className="sf-wrap iv-wrap iv-report">
    <div className="sf-bar iv-noprint"><Seg label="보고서" value={tab} onChange={setTab} options={[['month', '월말 보고'], ['year', '연말 보고']]} />
      <div className="iv-inline">{tab === 'month' ? <>
        <label className="sf-input"><span>보고 월</span><input type="month" value={month} onChange={e => { const v = e.target.value; if (!v) return; setMonth(v); setCmp(shiftMonth(v, -1)); }} /></label>
        <label className="sf-input"><span>비교 월</span><input type="month" value={cmp} onChange={e => e.target.value && setCmp(e.target.value)} /></label></>
        : <label className="sf-input"><span>연도</span><input type="number" value={year} onChange={e => setYear(e.target.value)} /></label>}
        <button type="button" className="sf-btn is-primary" onClick={() => window.print()}>PDF로 저장·인쇄</button></div></div>
    {error && <p className="sf-hint is-warn">{error}</p>}
    {tab === 'month' ? (rep ? <MonthReport a={rep.a} b={rep.b} /> : <LoadingBox />) : (yr ? <YearReport year={year} months={yr} /> : <LoadingBox />)}
  </div>;
}

const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`;
const diff = (a: number, b: number, f: (v: number) => string) => { const d = a - b; return d === 0 ? '0' : `${d > 0 ? '+' : '−'}${f(Math.abs(d))}`; };
// 월말·연말 보고: 번호 붙은 흰 카드 섹션(2026-11-08 사용자 지정 '10월 피부팀 월 정리' 형식)
function Block({ n, title, sub, children }: { n: number; title: string; sub?: string; children: React.ReactNode }) {
  return <section className="iv-block"><h3 className="iv-num"><i>{n}</i>{title}{sub && <small>{sub}</small>}</h3>{children}</section>;
}
function MonthReport({ a, b }: { a: MonthRep; b: MonthRep }) {
  const ml = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;
  const mm = (m: string) => `${Number(m.slice(5))}월`;
  const names = Array.from(new Set([...a.usage, ...b.usage].map(u => u.name)));
  const tiles: [string, string, string, string, boolean][] = [
    ['지출 합계', won(a.spend_total), won(b.spend_total), diff(a.spend_total, b.spend_total, won), true],
    ['일반 구매', won(a.spend_general), won(b.spend_general), diff(a.spend_general, b.spend_general, won), false],
    ['선결제 신규 구매', won(a.spend_prepaid), won(b.spend_prepaid), diff(a.spend_prepaid, b.spend_prepaid, won), false],
    ['총 피부관리 인원', `${a.patients}명`, `${b.patients}명`, diff(a.patients, b.patients, v => `${v}명`), false],
    ['입고 건수', `${a.in_count}건`, `${b.in_count}건`, diff(a.in_count, b.in_count, v => `${v}건`), false],
    ['거래명세서 미등록', `${a.no_invoice}건`, `${b.no_invoice}건`, diff(a.no_invoice, b.no_invoice, v => `${v}건`), false],
  ];
  let n = 0;
  return <article className="iv-paper">
    <h2>{ml(a.month)} 피부팀 월말 보고 <small>비교: {ml(b.month)}</small></h2>
    <Block n={++n} title={`${mm(a.month)} 확인 내용`}>
      <dl className="iv-tiles">{tiles.map(([label, now, prev, d, main]) => <div key={label} className={main ? 'is-main' : ''}>
        <dt>{label}</dt><dd><b>{now}</b>{main && a.spend_total >= 10000 && <small className="iv-read">{readWon(a.spend_total)}</small>}</dd>
        <dd className="iv-tile-cmp"><i>{mm(b.month)} {prev}</i> <span>{d}</span></dd></div>)}</dl>
      {a.no_amount ? <p className="sf-hint">금액 미입력 입고 {a.no_amount}건</p> : null}
    </Block>
    <Block n={++n} title="재고 확인" sub={`품목별 하루 평균 사용량 · 영업일 ${mm(b.month)} ${b.open_days}일 / ${mm(a.month)} ${a.open_days}일`}>
      {!names.length ? <p className="sf-hint">기록 없음</p> : <table className="sf-table"><thead><tr><th>품목</th><th className="num">{mm(b.month)}</th><th className="num">{mm(a.month)}</th><th className="num">차이</th></tr></thead>
        <tbody>{names.map(nm => { const x = a.usage.find(u => u.name === nm), y = b.usage.find(u => u.name === nm); const unit = (x || y)!.stock_unit; return <tr key={nm}><td>{nm} <small>{unit}/일</small></td>
          <td className="num">{y?.per_day ?? <small>기록 없음</small>}</td><td className="num">{x?.per_day != null ? <b>{x.per_day}</b> : <small>기록 없음</small>}</td><td className="num">{x?.per_day != null && y?.per_day != null ? diff(x.per_day, y.per_day, v => String(Math.round(v * 10) / 10)) : '—'}</td></tr>; })}</tbody></table>}
    </Block>
    {a.prepaid && a.prepaid.length > 0 && <Block n={++n} title="업체 보관 잔량" sub="현재">
      <table className="sf-table"><thead><tr><th>품목</th><th className="num">업체 보관 잔량</th><th className="num">병원재고</th></tr></thead>
        <tbody>{a.prepaid.map(p => <tr key={p.id}><td>{p.name}</td><td className="num"><b>{withUnit(p.vendor_stock, p.stock_unit)}</b></td><td className="num">{withUnit(p.hospital_stock, p.stock_unit)}</td></tr>)}</tbody></table></Block>}
    {a.inbound && <Block n={++n} title="입고·구매 내역">{!a.inbound.length ? <p className="sf-hint">기록 없음</p> : <table className="sf-table"><thead><tr><th>날짜</th><th>품목</th><th>구분</th><th className="num">수량</th><th className="num">금액</th><th>명세서</th></tr></thead>
      <tbody>{a.inbound.map((r, i) => <tr key={i}><td>{Number(r.date.slice(5, 7))}.{Number(r.date.slice(8))}</td><td>{r.item_name} <small>{r.vendor_name}{r.payment_method ? ` · ${r.payment_method}` : ''}</small></td><td><small>{KIND_LABEL[r.kind]}</small></td>
        <td className="num">{fmtQty(r.qty)}{r.bonus_qty ? ` (+${fmtQty(r.bonus_qty)})` : ''} {r.stock_unit}</td><td className="num">{r.kind === 'prepaid_in' ? '—' : fmtWon(r.amount)}</td><td>{r.invoice ? '등록' : <span className="is-warn">미등록</span>}</td></tr>)}</tbody></table>}</Block>}
    <p className="iv-foot">출력 {new Date().toLocaleString('ko-KR')}</p>
  </article>;
}

function YearReport({ year, months }: { year: string; months: MonthRep[] }) {
  const sum = (k: 'spend_total' | 'spend_general' | 'spend_prepaid' | 'patients' | 'in_count') => months.reduce((s, m) => s + (m[k] || 0), 0);
  const names = Array.from(new Set(months.flatMap(m => m.usage.map(u => `${u.name}|${u.stock_unit}`))));
  return <article className="iv-paper">
    <h2>{year}년 피부팀 연말 보고</h2>
    <Block n={1} title="월별 합계" sub={sum('spend_total') > 0 ? `연간 지출 ${readWon(sum('spend_total'))}` : undefined}><div className="iv-scroll"><table className="sf-table iv-year"><thead><tr><th>월</th><th className="num">지출 합계</th><th className="num">일반 구매</th><th className="num">선결제</th><th className="num">총 피부관리 인원</th><th className="num">입고</th>{names.map(n => <th key={n} className="num">{n.split('|')[0]}<br /><small>{n.split('|')[1]}</small></th>)}</tr></thead>
      <tbody>{months.map(m => <tr key={m.month}><td>{Number(m.month.slice(5))}월</td><td className="num">{m.spend_total ? won(m.spend_total) : '—'}</td><td className="num">{m.spend_general ? won(m.spend_general) : '—'}</td><td className="num">{m.spend_prepaid ? won(m.spend_prepaid) : '—'}</td>
        <td className="num">{m.patients || '—'}</td><td className="num">{m.in_count || '—'}</td>{names.map(n => { const u = m.usage.find(x => `${x.name}|${x.stock_unit}` === n); return <td key={n} className="num">{u ? fmtQty(u.used) : '—'}</td>; })}</tr>)}
        <tr className="iv-total-row"><td>합계</td><td className="num">{won(sum('spend_total'))}</td><td className="num">{won(sum('spend_general'))}</td><td className="num">{won(sum('spend_prepaid'))}</td><td className="num">{sum('patients')}</td><td className="num">{sum('in_count')}</td>
          {names.map(n => <td key={n} className="num">{fmtQty(months.reduce((s, m) => s + (m.usage.find(x => `${x.name}|${x.stock_unit}` === n)?.used || 0), 0))}</td>)}</tr></tbody></table></div></Block>
    <p className="iv-foot">출력 {new Date().toLocaleString('ko-KR')}</p>
  </article>;
}


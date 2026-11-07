import { useCallback, useEffect, useMemo, useState } from 'react';
import { LoadingBox, SavingMark } from './Feedback';
import { readWon } from '../koreanAmount';
import {
  type InvItem, type InvOption, type InvState, type InvTx, InvError, KIND_LABEL, announceInventory, fmtQty, fmtWon, invGet, invSend, shiftMonth, todayLocal, unitHint, useInventory,
} from '../inventoryApi';

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
function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return <div className="sf-seg" role="tablist" aria-label={label}>{options.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}>{l}</button>)}</div>;
}
const lowOf = (it: InvItem) => it.min_stock > 0 && it.hospital_stock <= it.min_stock;
const withUnit = (v: number | null | undefined, unit: string) => (v == null ? '—' : `${fmtQty(v)} ${unit}`);

/* ───────────── 재고체크 ───────────── */
export function StockCheck() {
  const { state, error, reload } = useInventory();
  const [toast, setToast] = useToast();
  const [tab, setTab] = useState<'daily' | 'all'>('daily');
  if (error) return <Problem error={error} />;
  if (!state) return <LoadingBox />;
  const prepaid = state.items.filter(it => it.prepaid);
  const low = state.items.filter(lowOf);
  return <Shell toast={toast}>
    {!state.imported && <OldDataImport onDone={() => { announceInventory(); void reload(); }} />}
    <div className="iv-cards">
      {prepaid.map(it => <div key={it.id} className="iv-card"><span>선결제 잔량</span><b>{it.name}</b><strong>{withUnit(it.vendor_stock, it.stock_unit)}</strong><small>병원재고 {withUnit(it.hospital_stock, it.stock_unit)}</small></div>)}
      <div className={`iv-card${low.length ? ' is-warn' : ''}`}><span>위험 기준 이하</span><b>부족 품목</b><strong>{low.length}개</strong><small>{low.slice(0, 3).map(i => i.name).join(', ') || '없음'}</small></div>
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
      <thead><tr><th>품목</th><th>거래처</th><th className="num">병원재고</th><th className="num">선결제 잔량</th><th className="num">위험 기준</th><th /></tr></thead>
      <tbody>{rows.map(it => <tr key={it.id} className={lowOf(it) ? 'is-low' : ''}>
        <td><b>{it.name}</b>{unitHint(it) && <small> · {unitHint(it)}</small>}</td><td><small>{it.vendor_name || '—'}</small></td>
        <td className={`num${it.hospital_stock < 0 ? ' is-warn' : ''}`}>{withUnit(it.hospital_stock, it.stock_unit)}</td>
        <td className="num">{it.prepaid ? withUnit(it.vendor_stock, it.stock_unit) : <small>—</small>}</td>
        <td className="num"><small>{it.min_stock ? withUnit(it.min_stock, it.stock_unit) : '—'}</small></td>
        <td className="num"><button type="button" className="sf-btn" onClick={() => setAdj(it)}>맞추기</button></td></tr>)}</tbody>
    </table>
    {adj && <AdjustDialog item={adj} today={state.today} onClose={() => setAdj(null)} onDone={m => { notify(m); setAdj(null); announceInventory(); }} />}
  </>;
}

function AdjustDialog({ item, today, onClose, onDone }: { item: InvItem; today: string; onClose: () => void; onDone: (m: string) => void }) {
  const [h, setH] = useState(String(item.hospital_stock)), [v, setV] = useState(String(item.vendor_stock)), [memo, setMemo] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <Modal title={`${item.name} 재고 맞추기`} onClose={onClose}>
    <p className="sf-hint">실제로 센 수량을 넣으면 차이만큼 기록해요. 이 기록을 지우면 원래대로 돌아가요.</p>
    <label className="sf-input"><span>병원재고 ({item.stock_unit}) · 지금 {fmtQty(item.hospital_stock)}</span><input type="number" min={0} inputMode="decimal" value={h} onChange={e => setH(e.target.value)} /></label>
    {item.prepaid ? <label className="sf-input"><span>선결제 잔량 ({item.stock_unit}) · 지금 {fmtQty(item.vendor_stock)}</span><input type="number" min={0} inputMode="decimal" value={v} onChange={e => setV(e.target.value)} /></label> : null}
    <label className="sf-input"><span>메모</span><input value={memo} onChange={e => setMemo(e.target.value)} placeholder="예: 11월 실사" /></label>
    {error && <p className="sf-hint is-warn">{error}</p>}
    <div className="sf-modal-foot"><button type="button" className="sf-btn" onClick={onClose}>닫기</button>
      <button type="button" className="sf-btn is-primary" disabled={busy} onClick={async () => { setBusy(true); try { await invSend('POST', '/adjust', { item_id: item.id, hospital_stock: h === '' ? null : Number(h), vendor_stock: item.prepaid && v !== '' ? Number(v) : null, memo, date: today }); onDone('재고를 맞췄어요.'); } catch (e) { setError(errText(e)); setBusy(false); } }}>{busy && <SavingMark />}맞추기</button></div>
  </Modal>;
}

type DailyItem = { id: number; name: string; stock_unit: string; hospital_stock: number; daily_mode: 'usage' | 'count'; used: number | null; used15: number };
function DailyClose({ today, notify, onSaved }: { items: InvItem[]; today: string; notify: (m: string) => void; onSaved: () => void }) {
  const [date, setDate] = useState(today);
  const [data, setData] = useState<{ day: { patients: number | null; status: string | null; extra: Record<string, unknown> } | null; items: DailyItem[] } | null>(null);
  const [patients, setPatients] = useState(''), [status, setStatus] = useState(''), [vals, setVals] = useState<Record<number, string>>({}), [people, setPeople] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const d = await invGet('/daily', { date });
    setData(d); setPatients(d.day?.patients == null ? '' : String(d.day.patients)); setStatus(d.day?.status || ''); setPeople(d.day?.extra?.modeling_people == null ? '' : String(d.day.extra.modeling_people));
    // 사용량 방식은 입력한 사용량, 개수 방식은 남은 개수(현재 재고 + 이미 기록한 사용량)를 보여 준다
    setVals(Object.fromEntries(d.items.map((it: DailyItem) => [it.id, it.used == null ? '' : it.daily_mode === 'usage' ? String(it.used) : String(it.hospital_stock)])));
  }, [date]);
  useEffect(() => { setData(null); load().catch(e => notify(errText(e))); }, [load, notify]);
  if (!data) return <LoadingBox />;
  const usedOf = (it: DailyItem) => {
    const v = vals[it.id];
    if (v === '' || v == null) return null;
    if (it.daily_mode === 'usage') return Number(v);
    const before = it.hospital_stock + (it.used || 0); // 이 날 기록 전 재고
    return Math.round((before - Number(v)) * 1000) / 1000;
  };
  const save = async () => {
    const used: Record<number, number | null> = {};
    for (const it of data.items) {
      const u = usedOf(it);
      if (u != null && (!Number.isFinite(u) || u < 0)) { notify(`${it.name}: 남은 수량이 마감 전 재고보다 많아요.`); return; }
      used[it.id] = u ?? 0;
    }
    setBusy(true);
    try { await invSend('POST', '/daily', { date, patients: patients === '' ? null : Number(patients), status: status || null, extra: { modeling_people: people === '' ? null : Number(people) }, used }); notify('마감을 저장했어요.'); announceInventory(); onSaved(); await load(); }
    catch (e) { notify(errText(e)); } finally { setBusy(false); }
  };
  return <div className="iv-daily">
    <div className="iv-row">
      <label className="sf-input"><span>마감일</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="sf-input"><span>총 피부관리 인원</span><input type="number" min={0} inputMode="numeric" value={patients} onChange={e => setPatients(e.target.value)} placeholder="명" /></label>
      <label className="sf-input"><span>메모(휴무 등)</span><input type="text" value={status} onChange={e => setStatus(e.target.value)} placeholder="선택" /></label>
      <button type="button" className="sf-btn is-primary" disabled={busy} onClick={() => void save()}>{busy && <SavingMark />}저장</button>
    </div>
    <div className="iv-grid">{data.items.map(it => {
      const u = usedOf(it), before = it.hospital_stock + (it.used || 0);
      return <div key={it.id} className="iv-dcard">
        <b>{it.name}</b>
        <dl><dt>마감 전 재고</dt><dd>{withUnit(before, it.stock_unit)}</dd></dl>
        <label className="sf-input"><span>{it.daily_mode === 'usage' ? '당일 사용량' : '남은 수량(미개봉)'}</span>
          <input type="number" min={0} inputMode="decimal" value={vals[it.id] ?? ''} onChange={e => setVals(v => ({ ...v, [it.id]: e.target.value }))} placeholder={it.stock_unit} /></label>
        {it.name.includes('모델링') && <label className="sf-input"><span>사용 인원</span><input type="number" min={0} inputMode="numeric" value={people} onChange={e => setPeople(e.target.value)} placeholder="명" /></label>}
        <dl><dt>마감재고</dt><dd>{u == null ? '—' : withUnit(before - u, it.stock_unit)}</dd><dt>최근 15일 사용</dt><dd>{withUnit(it.used15, it.stock_unit)}</dd></dl>
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
  const run = async () => {
    if (!file) return;
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
    <div><b>{merge ? '예전 근태·성과 더 넣기' : '예전 앱 자료 넣기'}</b><p className="sf-hint">{merge ? '새로 받은 예전 자료 파일에서 근태·성과 숫자만 더해요. 비어 있는 칸만 채우고 이미 입력한 값은 바꾸지 않아요.' : '직원 근태·성과와 재고 기록(사진에서 옮긴 숫자) 파일을 한 번 넣으면 직원·재고 화면에 바로 보여요.'}</p></div>
    <div className="iv-inline">
      <label className="sf-btn"><input type="file" accept="application/json,.json" hidden onChange={e => void pick(e.target.files?.[0])} />{file ? file.name : '파일 고르기'}</label>
      <button type="button" className="sf-btn is-primary" disabled={!file || state.running} onClick={() => void run()}>{state.running && <SavingMark />}{merge ? '더 넣기' : '넣기'}</button>
    </div>
    {state.text && <p className="sf-hint">{state.text}</p>}
    {state.error && <p className="sf-hint is-warn">{state.error}</p>}
  </section>;
}

/* ───────────── 재고주문 ───────────── */
export function StockOrder() {
  const { state, error, reload } = useInventory();
  const [toast, setToast] = useToast();
  const [tab, setTab] = useState<'order' | 'items'>('order');
  if (error) return <Problem error={error} />;
  if (!state) return <LoadingBox />;
  return <Shell toast={toast}>
    <div className="sf-bar"><Seg label="보기" value={tab} onChange={setTab} options={[['order', '주문하기'], ['items', '품목·구매조건']]} /></div>
    {tab === 'order' ? <OrderBoard state={state} notify={setToast} /> : <ItemEditor state={state} notify={setToast} onChange={reload} />}
  </Shell>;
}

function OrderBoard({ state, notify }: { state: InvState; notify: (m: string) => void }) {
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<{ item: InvItem; opt: InvOption } | null>(null);
  const list = state.items.filter(it => it.options.length && (!q || it.name.includes(q) || (it.vendor_name || '').includes(q)));
  const sorted = [...list].sort((a, b) => Number(lowOf(b)) - Number(lowOf(a)));
  const cancel = async (id: number) => { try { await invSend('POST', `/orders/${id}/cancel`); notify('주문을 취소했어요.'); announceInventory(); } catch (e) { notify(errText(e)); } };
  return <>
    {state.orders.length > 0 && <section className="iv-sec"><h3>받기 전 주문 {state.orders.length}건</h3>
      <table className="sf-table"><thead><tr><th>주문일</th><th>품목</th><th className="num">수량(증정)</th><th className="num">결제금액</th><th /></tr></thead>
        <tbody>{state.orders.map(o => <tr key={o.id}><td>{o.ordered_at.slice(5).replace('-', '/')}</td><td><b>{o.item_name}</b> <small>{o.option_label}</small></td>
          <td className="num">{fmtQty(o.qty)}{o.bonus_qty ? ` (+${fmtQty(o.bonus_qty)})` : ''} {o.stock_unit}</td><td className="num">{fmtWon(o.amount)}</td>
          <td className="num"><button type="button" className="sf-btn" onClick={() => void cancel(o.id)}>취소</button></td></tr>)}</tbody></table></section>}
    <section className="iv-sec"><div className="iv-head"><h3>품목</h3><input className="iv-search" type="search" placeholder="품목·거래처 검색" value={q} onChange={e => setQ(e.target.value)} /></div>
      <div className="iv-olist">{sorted.map(it => <div key={it.id} className={`iv-oitem${lowOf(it) ? ' is-low' : ''}`}>
        <div className="iv-oname"><b>{it.name}</b><small>{it.vendor_name || '—'} · 병원재고 {withUnit(it.hospital_stock, it.stock_unit)}{it.prepaid ? ` · 선결제 잔량 ${withUnit(it.vendor_stock, it.stock_unit)}` : ''}{lowOf(it) ? ' · 부족' : ''}</small></div>
        <div className="sf-pills">{it.options.map(o => <button key={o.id} type="button" onClick={() => setPick({ item: it, opt: o })}>{o.label || `${fmtQty(o.qty)} ${it.stock_unit}`} · {fmtWon(o.amount)}{o.bonus_qty ? ` · 증정 ${fmtQty(o.bonus_qty)}` : ''}{o.prepaid ? ' · 선결제' : ''}</button>)}</div>
      </div>)}</div>
      <p className="sf-hint">구매조건이 없는 품목(단가 미확인 등)은 '품목·구매조건'에서 조건을 먼저 등록하면 주문할 수 있어요.</p>
    </section>
    {pick && <OrderDialog item={pick.item} opt={pick.opt} today={state.today} onClose={() => setPick(null)} onDone={msg => { notify(msg); setPick(null); announceInventory(); }} />}
  </>;
}

function OrderDialog({ item, opt, today, onClose, onDone }: { item: InvItem; opt: InvOption; today: string; onClose: () => void; onDone: (m: string) => void }) {
  const [count, setCount] = useState('1'), [date, setDate] = useState(today), [memo, setMemo] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const n = Number(count) || 0;
  const submit = async () => {
    setBusy(true); setError('');
    try { await invSend('POST', '/orders', { item_id: item.id, option_id: opt.id, count: n, date, memo }); onDone(opt.prepaid ? '선결제를 기록했어요. 선결제 잔량이 늘었어요.' : '주문했어요. 도착하면 재고입출고 → 받기에서 입고확정해 주세요.'); }
    catch (e) { setError(errText(e)); setBusy(false); }
  };
  const total = opt.amount == null ? null : opt.amount * n;
  return <Modal title={`${item.name} 주문`} onClose={onClose}>
    <dl className="sf-dl"><dt>구매조건</dt><dd>{opt.label || '-'}</dd><dt>1회 수량</dt><dd>{fmtQty(opt.qty)} {item.stock_unit}{opt.bonus_qty ? ` + 증정 ${fmtQty(opt.bonus_qty)}` : ''}</dd><dt>1회 결제금액</dt><dd>{fmtWon(opt.amount)}</dd></dl>
    <label className="sf-input"><span>주문 개수</span><input type="number" min={1} step={1} inputMode="numeric" value={count} onChange={e => setCount(e.target.value)} /></label>
    <label className="sf-input"><span>{opt.prepaid ? '결제일' : '주문일'}</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
    <label className="sf-input"><span>메모</span><input type="text" value={memo} onChange={e => setMemo(e.target.value)} placeholder="선택" /></label>
    <div className="iv-total"><span>{opt.prepaid ? '선결제 금액' : '결제금액'}</span><b>{fmtWon(total)}</b>{total != null && total >= 10000 && <small>{readWon(total)}</small>}</div>
    <p className="sf-hint">{opt.prepaid ? `결제하면 선결제 잔량이 ${fmtQty((opt.qty + opt.bonus_qty) * n)} ${item.stock_unit} 늘고, 병원재고는 실제로 들어올 때(입고확정) 늘어요.` : `받을 수량 ${fmtQty((opt.qty + opt.bonus_qty) * n)} ${item.stock_unit}${opt.bonus_qty ? '(증정 포함 · 증정은 결제금액 제외)' : ''}`}</p>
    {error && <p className="sf-hint is-warn">{error}</p>}
    <div className="sf-modal-foot"><button type="button" className="sf-btn" onClick={onClose}>닫기</button><button type="button" className="sf-btn is-primary" disabled={busy || n < 1} onClick={() => void submit()}>{busy && <SavingMark />}{opt.prepaid ? '선결제 기록' : '주문'}</button></div>
  </Modal>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="sf-modal" role="dialog" aria-modal="true" aria-label={title}>
    <div className="sf-modal-back" onClick={onClose} />
    <div className="sf-modal-panel"><div className="sf-modal-head"><strong>{title}</strong><button type="button" aria-label="닫기" onClick={onClose}>×</button></div>{children}</div>
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
      <label className="sf-input"><span>일일 마감</span><select value={f.daily_mode} onChange={set('daily_mode')}><option value="">안 함</option><option value="usage">사용량 입력</option><option value="count">남은 수량 입력</option></select></label>
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
  const [tab, setTab] = useState<'in' | 'out' | 'log'>('in');
  if (error) return <Problem error={error} />;
  if (!state) return <LoadingBox />;
  return <Shell toast={toast}>
    <div className="sf-bar"><Seg label="보기" value={tab} onChange={setTab} options={[['in', '받기(입고)'], ['out', '출고'], ['log', '입출고 내역']]} /></div>
    {tab === 'in' ? <Receive state={state} notify={setToast} /> : tab === 'out' ? <OutForm state={state} notify={setToast} /> : <TxLog notify={setToast} />}
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

function Receive({ state, notify }: { state: InvState; notify: (m: string) => void }) {
  const [actual, setActual] = useState<Record<number, string>>({});
  const [date, setDate] = useState(state.today);
  const [invoice, setInvoice] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState('');
  const prepaidItems = state.items.filter(i => i.prepaid);
  const [pp, setPp] = useState({ item: '', qty: '' });
  const [free, setFree] = useState({ item: '', qty: '', amount: '', memo: '' });
  const ppItem = prepaidItems.find(i => String(i.id) === pp.item);
  const freeItem = state.items.find(i => String(i.id) === free.item);
  const run = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(key);
    try { await fn(); notify(msg); announceInventory(); return true; } catch (e) { notify(errText(e)); return false; } finally { setBusy(''); }
  };
  const ppQty = Number(pp.qty) || 0;
  return <>
    <div className="iv-row"><label className="sf-input"><span>입고일</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label></div>
    <section className="iv-sec"><h3>주문한 것 받기</h3>
      {!state.orders.length ? <p className="sf-hint">받기 전 주문이 없어요.</p> : <table className="sf-table">
        <thead><tr><th>주문</th><th className="num">주문 수량</th><th className="num">실제 도착</th><th>명세서</th><th /></tr></thead>
        <tbody>{state.orders.map(o => <tr key={o.id}><td><b>{o.item_name}</b> <small>{o.ordered_at.slice(5).replace('-', '/')} · {o.option_label} · {fmtWon(o.amount)}</small></td>
          <td className="num">{fmtQty(o.qty)}{o.bonus_qty ? ` + 증정 ${fmtQty(o.bonus_qty)}` : ''} {o.stock_unit}</td>
          <td className="num"><input className="sf-num" type="number" min={0} inputMode="decimal" value={actual[o.id] ?? String(o.qty + o.bonus_qty)} onChange={e => setActual(a => ({ ...a, [o.id]: e.target.value }))} aria-label={`${o.item_name} 실제 도착 수량`} /> {o.stock_unit}</td>
          <td><label className="iv-check"><input type="checkbox" checked={!!invoice[`o${o.id}`]} onChange={e => setInvoice(v => ({ ...v, [`o${o.id}`]: e.target.checked }))} /> 받음</label></td>
          <td className="num"><button type="button" className="sf-btn is-primary" disabled={busy === `o${o.id}`} onClick={() => void run(`o${o.id}`, () => invSend('POST', '/receive', { order_id: o.id, actual_qty: Number(actual[o.id] ?? o.qty + o.bonus_qty), date, invoice: invoice[`o${o.id}`] }), '입고확정했어요. 병원재고에 반영됐어요.')}>{busy === `o${o.id}` && <SavingMark />}입고확정</button></td></tr>)}</tbody></table>}
      <p className="sf-hint">실제로 들어온 수량만 병원재고에 더해요(증정 포함). 결제금액은 주문한 구매조건 그대로예요.</p>
    </section>
    {prepaidItems.length > 0 && <section className="iv-sec"><h3>선결제 반입</h3>
      <div className="iv-row">
        <label className="sf-input"><span>품목</span><select value={pp.item} onChange={e => setPp({ item: e.target.value, qty: '' })}><option value="">선택</option>{prepaidItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
        <label className="sf-input"><span>실제 도착 수량</span><input type="number" min={0} inputMode="decimal" value={pp.qty} onChange={e => setPp(x => ({ ...x, qty: e.target.value }))} placeholder={ppItem?.stock_unit} /></label>
        <label className="iv-check"><input type="checkbox" checked={!!invoice.pp} onChange={e => setInvoice(v => ({ ...v, pp: e.target.checked }))} /> 명세서 받음</label>
        <button type="button" className="sf-btn is-primary" disabled={!ppItem || !(ppQty > 0) || busy === 'pp'} onClick={async () => { if (await run('pp', () => invSend('POST', '/receive', { from_prepaid: true, item_id: ppItem!.id, actual_qty: ppQty, date, invoice: invoice.pp }), '입고확정했어요. 선결제 잔량을 차감했어요.')) setPp({ item: pp.item, qty: '' }); }}>{busy === 'pp' && <SavingMark />}입고확정</button>
      </div>
      {ppItem && <div className="iv-calc"><span>선결제 잔량 <b>{withUnit(ppItem.vendor_stock, ppItem.stock_unit)}</b></span><span>→ 남는 잔량 <b className={ppQty > ppItem.vendor_stock ? 'is-warn' : ''}>{withUnit(Math.round((ppItem.vendor_stock - ppQty) * 1000) / 1000, ppItem.stock_unit)}</b></span><span>병원재고 {withUnit(ppItem.hospital_stock, ppItem.stock_unit)} → <b>{withUnit(ppItem.hospital_stock + ppQty, ppItem.stock_unit)}</b></span></div>}
      <p className="sf-hint">입고확정 때 선결제 잔량에서 빼고 병원재고에 더해요(추가 결제 없음).</p>
    </section>}
    <section className="iv-sec"><h3>주문 없이 받은 것</h3>
      <div className="iv-row">
        <label className="sf-input"><span>품목</span><ItemSelect items={state.items} value={free.item} onChange={v => setFree(x => ({ ...x, item: v }))} /></label>
        <QtyInput item={freeItem} label="실제 도착 수량" value={free.qty} onChange={v => setFree(x => ({ ...x, qty: v }))} />
        <label className="sf-input"><span>결제금액(원)</span><input type="number" min={0} value={free.amount} onChange={e => setFree(x => ({ ...x, amount: e.target.value }))} placeholder="증정·무상은 0" /></label>
        <label className="sf-input"><span>메모</span><input value={free.memo} onChange={e => setFree(x => ({ ...x, memo: e.target.value }))} /></label>
        <button type="button" className="sf-btn is-primary" disabled={!freeItem || !(Number(free.qty) > 0) || busy === 'free'} onClick={async () => { if (await run('free', () => invSend('POST', '/receive', { item_id: freeItem!.id, actual_qty: Number(free.qty), amount: free.amount === '' ? null : Number(free.amount), memo: free.memo, date }), '입고했어요.')) setFree({ item: '', qty: '', amount: '', memo: '' }); }}>{busy === 'free' && <SavingMark />}입고</button>
      </div>
    </section>
  </>;
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
    <p className="sf-hint">병원재고만 재고단위로 빼요. 구매금액·선결제 잔량은 바뀌지 않아요. 팩류 일일 사용은 재고체크 → 일일 재고에서 마감하면 자동으로 출고돼요.</p>
  </section>;
}

function TxLog({ notify }: { notify: (m: string) => void }) {
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [kind, setKind] = useState<'all' | 'in' | 'out'>('all');
  const [rows, setRows] = useState<InvTx[] | null>(null);
  const [ask, setAsk] = useState<InvTx | null>(null);
  const load = useCallback(async () => {
    const k = kind === 'in' ? 'in,prepaid_buy,prepaid_in' : kind === 'out' ? 'out' : undefined;
    try { setRows((await invGet('/tx', { from: `${month}-01`, to: `${month}-31`, kind: k })).rows); } catch (e) { notify(errText(e)); setRows([]); }
  }, [month, kind, notify]);
  useEffect(() => { setRows(null); void load(); }, [load]);
  const effect = (t: InvTx) => [t.hospital_delta ? `병원재고 ${t.hospital_delta > 0 ? '−' : '+'}${fmtQty(Math.abs(t.hospital_delta))}` : '', t.vendor_delta ? `선결제 잔량 ${t.vendor_delta > 0 ? '−' : '+'}${fmtQty(Math.abs(t.vendor_delta))}` : ''].filter(Boolean).join(' · ');
  return <>
    <div className="sf-bar"><div className="sf-month"><button type="button" aria-label="이전 달" onClick={() => setMonth(m => shiftMonth(m, -1))}>‹</button><strong>{month.slice(0, 4)}년 {Number(month.slice(5))}월</strong><button type="button" aria-label="다음 달" onClick={() => setMonth(m => shiftMonth(m, 1))}>›</button></div>
      <Seg label="종류" value={kind} onChange={setKind} options={[['all', '전체'], ['in', '입고'], ['out', '출고']]} /></div>
    {rows == null ? <LoadingBox /> : !rows.length ? <p className="sf-hint">이 달 기록이 없어요.</p> : <table className="sf-table">
      <thead><tr><th>날짜</th><th>품목</th><th>구분</th><th className="num">수량</th><th className="num">금액</th><th className="num">기록 후 병원재고</th><th /></tr></thead>
      <tbody>{rows.map(t => <tr key={t.id}><td>{Number(t.date.slice(5, 7))}.{Number(t.date.slice(8))}</td>
        <td><b>{t.item_name}</b> <small>{[t.vendor_name, t.memo].filter(Boolean).join(' · ')}</small></td><td><small>{KIND_LABEL[t.kind]}{t.daily_date ? ' · 일일 마감' : ''}</small></td>
        <td className="num">{fmtQty(t.qty)}{t.bonus_qty ? ` (+${fmtQty(t.bonus_qty)})` : ''} {t.stock_unit}</td><td className="num">{t.kind === 'out' || t.kind === 'prepaid_in' || t.kind === 'adjust' ? <small>—</small> : fmtWon(t.amount)}</td>
        <td className="num">{fmtQty(t.hospital_after)}</td><td className="num"><button type="button" className="sf-btn" onClick={() => setAsk(t)}>삭제</button></td></tr>)}</tbody></table>}
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
        <label className="sf-input"><span>보고 월</span><input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></label>
        <label className="sf-input"><span>비교 월</span><input type="month" value={cmp} onChange={e => e.target.value && setCmp(e.target.value)} /></label></>
        : <label className="sf-input"><span>연도</span><input type="number" value={year} onChange={e => setYear(e.target.value)} /></label>}
        <button type="button" className="sf-btn is-primary" onClick={() => window.print()}>PDF로 저장·인쇄</button></div></div>
    {error && <p className="sf-hint is-warn">{error}</p>}
    {tab === 'month' ? (rep ? <MonthReport a={rep.a} b={rep.b} /> : <LoadingBox />) : (yr ? <YearReport year={year} months={yr} /> : <LoadingBox />)}
  </div>;
}

const won = (v: number) => `₩${Math.round(v).toLocaleString('ko-KR')}`;
const diff = (a: number, b: number, f: (v: number) => string) => { const d = a - b; return d === 0 ? '0' : `${d > 0 ? '+' : '−'}${f(Math.abs(d))}`; };
function MonthReport({ a, b }: { a: MonthRep; b: MonthRep }) {
  const ml = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;
  const names = Array.from(new Set([...a.usage, ...b.usage].map(u => u.name)));
  const rows: [string, string, string, string][] = [
    ['지출 합계', won(b.spend_total), won(a.spend_total), diff(a.spend_total, b.spend_total, won)],
    ['· 일반 구매', won(b.spend_general), won(a.spend_general), diff(a.spend_general, b.spend_general, won)],
    ['· 선결제 신규 구매', won(b.spend_prepaid), won(a.spend_prepaid), diff(a.spend_prepaid, b.spend_prepaid, won)],
    ['관리 인원(일일 재고 합계)', `${b.patients}명`, `${a.patients}명`, diff(a.patients, b.patients, v => `${v}명`)],
    ['입고 건수', `${b.in_count}건`, `${a.in_count}건`, diff(a.in_count, b.in_count, v => `${v}건`)],
    ['거래명세서 미등록', `${b.no_invoice}건`, `${a.no_invoice}건`, diff(a.no_invoice, b.no_invoice, v => `${v}건`)],
  ];
  return <article className="iv-paper">
    <h2>{ml(a.month)} 피부팀 월말 보고 <small>비교: {ml(b.month)}</small></h2>
    <table className="sf-table"><thead><tr><th>항목</th><th className="num">{ml(b.month)}</th><th className="num">{ml(a.month)}</th><th className="num">차이</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r[0]}><td>{r[0]}</td><td className="num">{r[1]}</td><td className="num"><b>{r[2]}</b></td><td className="num">{r[3]}</td></tr>)}
        <tr className="iv-subhead"><td colSpan={4}>품목별 하루 평균 사용량 (영업일 {b.open_days}일 / {a.open_days}일)</td></tr>
        {names.map(n => { const x = a.usage.find(u => u.name === n), y = b.usage.find(u => u.name === n); const unit = (x || y)!.stock_unit; return <tr key={n}><td>{n} <small>{unit}/일</small></td>
          <td className="num">{y?.per_day ?? <small>기록 없음</small>}</td><td className="num"><b>{x?.per_day ?? '기록 없음'}</b></td><td className="num">{x?.per_day != null && y?.per_day != null ? diff(x.per_day, y.per_day, v => String(Math.round(v * 10) / 10)) : '-'}</td></tr>; })}</tbody></table>
    {a.spend_total > 0 && <p className="sf-hint">지출 합계 {readWon(a.spend_total)}{a.no_amount ? ` · 금액 미입력 입고 ${a.no_amount}건` : ''}</p>}
    {a.prepaid && a.prepaid.length > 0 && <><h3>선결제 잔량 (현재)</h3><table className="sf-table"><thead><tr><th>품목</th><th className="num">선결제 잔량</th><th className="num">병원재고</th></tr></thead>
      <tbody>{a.prepaid.map(p => <tr key={p.id}><td>{p.name}</td><td className="num"><b>{withUnit(p.vendor_stock, p.stock_unit)}</b></td><td className="num">{withUnit(p.hospital_stock, p.stock_unit)}</td></tr>)}</tbody></table></>}
    {a.inbound && <><h3>입고·구매 내역</h3>{!a.inbound.length ? <p className="sf-hint">기록 없음</p> : <table className="sf-table"><thead><tr><th>날짜</th><th>품목</th><th>구분</th><th className="num">수량</th><th className="num">금액</th><th>명세서</th></tr></thead>
      <tbody>{a.inbound.map((r, i) => <tr key={i}><td>{Number(r.date.slice(5, 7))}.{Number(r.date.slice(8))}</td><td>{r.item_name} <small>{r.vendor_name}{r.payment_method ? ` · ${r.payment_method}` : ''}</small></td><td><small>{KIND_LABEL[r.kind]}</small></td>
        <td className="num">{fmtQty(r.qty)}{r.bonus_qty ? ` (+${fmtQty(r.bonus_qty)})` : ''} {r.stock_unit}</td><td className="num">{r.kind === 'prepaid_in' ? '—' : fmtWon(r.amount)}</td><td>{r.invoice ? '등록' : <span className="is-warn">미등록</span>}</td></tr>)}</tbody></table>}</>}
    <p className="iv-foot">출력 {new Date().toLocaleString('ko-KR')}</p>
  </article>;
}

function YearReport({ year, months }: { year: string; months: MonthRep[] }) {
  const sum = (k: 'spend_total' | 'spend_general' | 'spend_prepaid' | 'patients' | 'in_count') => months.reduce((s, m) => s + (m[k] || 0), 0);
  const names = Array.from(new Set(months.flatMap(m => m.usage.map(u => `${u.name}|${u.stock_unit}`))));
  return <article className="iv-paper">
    <h2>{year}년 피부팀 연말 보고</h2>
    <div className="iv-scroll"><table className="sf-table iv-year"><thead><tr><th>월</th><th className="num">지출 합계</th><th className="num">일반 구매</th><th className="num">선결제</th><th className="num">관리 인원</th><th className="num">입고</th>{names.map(n => <th key={n} className="num">{n.split('|')[0]}<br /><small>{n.split('|')[1]}</small></th>)}</tr></thead>
      <tbody>{months.map(m => <tr key={m.month}><td>{Number(m.month.slice(5))}월</td><td className="num">{m.spend_total ? won(m.spend_total) : '—'}</td><td className="num">{m.spend_general ? won(m.spend_general) : '—'}</td><td className="num">{m.spend_prepaid ? won(m.spend_prepaid) : '—'}</td>
        <td className="num">{m.patients || '—'}</td><td className="num">{m.in_count || '—'}</td>{names.map(n => { const u = m.usage.find(x => `${x.name}|${x.stock_unit}` === n); return <td key={n} className="num">{u ? fmtQty(u.used) : '—'}</td>; })}</tr>)}
        <tr className="iv-total-row"><td>합계</td><td className="num">{won(sum('spend_total'))}</td><td className="num">{won(sum('spend_general'))}</td><td className="num">{won(sum('spend_prepaid'))}</td><td className="num">{sum('patients')}</td><td className="num">{sum('in_count')}</td>
          {names.map(n => <td key={n} className="num">{fmtQty(months.reduce((s, m) => s + (m.usage.find(x => `${x.name}|${x.stock_unit}` === n)?.used || 0), 0))}</td>)}</tr></tbody></table></div>
    {sum('spend_total') > 0 && <p className="sf-hint">연간 지출 {readWon(sum('spend_total'))}</p>}
    <p className="iv-foot">출력 {new Date().toLocaleString('ko-KR')}</p>
  </article>;
}

export const _test = { lowOf, useMemo };

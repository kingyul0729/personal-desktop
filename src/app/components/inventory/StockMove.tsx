import { Fragment, useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { LoadingBox, SavingMark } from '../Feedback';
import { askConfirm } from '../AlertDialog';
import { type InvState, type InvTx, type KeepSource, KIND_LABEL, md, announceInventory, fmtQty, fmtWon, invGet, invSend, invUploadInvoice, invoiceSrc, shiftMonth, todayLocal, useInventory, subscribeInventory } from '../../inventoryApi';
import { InvThumb, ItemSelect, Modal, Problem, QtyInput, Seg, Shell, errText, useToast, withUnit } from './shared';

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

export function OutForm({ state, notify }: { state: InvState; notify: (m: string) => void }) {
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
export const INVOICE_KINDS = ['in', 'prepaid_buy', 'prepaid_in'];
export const photosOf = (t: InvTx) => (t.invoice_ids ? String(t.invoice_ids).split(',').filter(Boolean) : []);
export type InvState2 = 'photo' | 'paper' | 'missing' | 'optional';
export const invoiceState = (t: InvTx): InvState2 => (photosOf(t).length ? 'photo' : t.invoice ? 'paper' : (t.amount || 0) > 0 ? 'missing' : 'optional');
export const INVOICE_LABEL: Record<InvState2, (t: InvTx) => string> = { photo: () => '거래명세서', paper: () => '받음', missing: () => '미등록', optional: () => '올리기' };
// 업체 보관에서 가져온 줄(2026-11-12 사용자): 명세서 칸에 처음 결제한 날짜 — 선결제분 / 결제분, 먼저 결제한 것부터라 걸치면 두 날짜
export const srcKind = (t: InvTx) => (t.sources?.some(x => x.kind === 'prepaid') || (!t.sources?.length && t.item_prepaid) ? 'pp' : 'paid');
export const srcLabel = (t: InvTx) => { const ds = [...new Set((t.sources || []).map(x => x.date).filter(Boolean) as string[])]; const kind = srcKind(t) === 'pp' ? '선결제분' : '결제분';
  return ds.length ? `${ds.map(md).join(' · ')} ${kind}` : '이전 잔량'; };
export function SourceDialog({ tx, onClose }: { tx: InvTx; onClose: () => void }) {
  const [big, setBig] = useState<string | null>(null);
  const list: KeepSource[] = tx.sources || [];
  return <Modal title={`${tx.item_name} · ${srcLabel(tx)}`} onClose={onClose}>
    {!list.length ? <p className="sf-hint">기록 없음</p> : list.map((x, i) => { const ids = x.invoice_ids ? String(x.invoice_ids).split(',') : [];
      return <div key={i} className="iv-src-row"><p><b>{x.date ? md(x.date) : '이전 잔량'}</b> {x.kind === 'prepaid' ? '선결제분' : x.kind === 'paid' ? '결제분' : x.kind === 'fix' ? '잔량 고침' : ''} · {fmtQty(x.qty)} {tx.stock_unit}</p>
        {ids.length ? <ul className="iv-inv-photos">{ids.map(id => <li key={id}><button type="button" className="iv-inv-thumb" onClick={() => setBig(id)} aria-label="크게 보기"><InvThumb id={id} /></button></li>)}</ul> : x.tx ? <p className="sf-hint">명세서 미등록</p> : null}</div>; })}
    {big && <div className="iv-inv-big" role="dialog" aria-label="명세서 크게 보기" onClick={() => setBig(null)}><InvThumb id={big} /><a href={invoiceSrc(big)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>원본 열기</a></div>}
  </Modal>;
}

export function InvoiceDialog({ tx, rows, notify, onClose, onChange }: { tx: InvTx; rows: InvTx[]; notify: (m: string) => void; onClose: () => void; onChange: () => void }) {
  // 명세서 한 장 = 같은 날·같은 업체 입고(2026-11-10 사용자 지정). 품목·수량은 기록마다 따로, 사진은 한 번만.
  const group = rows.filter(r => r.date === tx.date && (r.vendor_id ?? 0) === (tx.vendor_id ?? 0) && INVOICE_KINDS.includes(r.kind));
  const [pick, setPick] = useState<number[]>(() => group.filter(r => r.id === tx.id || !photosOf(r).length).map(r => r.id));
  const [busy, setBusy] = useState(false), [big, setBig] = useState<string | null>(null);
  const photos = photosOf(tx);
  const others = [...new Set(group.filter(r => r.id !== tx.id).flatMap(photosOf))].filter(id => !photos.includes(id)); // 같은 묶음에 이미 올린 사진
  const done = (m: string) => { notify(m); onChange(); announceInventory(); };
  const upload = async (file: File | undefined) => {
    if (!file) return; setBusy(true);
    try { await invUploadInvoice(file, pick); done(pick.length > 1 ? `명세서를 ${pick.length}건에 올렸어요.` : '명세서를 올렸어요.'); }
    catch (e) { notify(errText(e)); } finally { setBusy(false); }
  };
  const join = async (id: string) => {
    setBusy(true);
    try { await invSend('POST', `/invoices/${id}/links`, { tx_ids: pick }); done(pick.length > 1 ? `같은 명세서에 ${pick.length}건을 걸었어요.` : '같은 명세서에 걸었어요.'); }
    catch (e) { notify(errText(e)); } finally { setBusy(false); }
  };
  const remove = async (id: string) => { try { await invSend('DELETE', `/invoices/${id}`); done('사진을 지웠어요.'); } catch (e) { notify(errText(e)); } };
  return <Modal title={`${Number(tx.date.slice(5, 7))}/${Number(tx.date.slice(8))} ${tx.vendor_name || tx.item_name} 명세서`} onClose={onClose}>
    {photos.length > 0 && <ul className="iv-inv-photos">{photos.map(id => <li key={id}>
      <button type="button" className="iv-inv-thumb" onClick={() => setBig(id)} aria-label="크게 보기"><InvThumb id={id} /></button>
      <button type="button" className="sf-btn" onClick={async () => { if (await askConfirm({ title: '이 사진을 지울까요?', message: '이 명세서에 걸린 기록에서 모두 빠져요.', ok: '삭제', kind: 'delete' })) void remove(id); }}>삭제</button></li>)}</ul>}
    {group.length > 1 && <fieldset className="iv-inv-rows"><legend>같은 명세서 · {group.length}건</legend>
      {group.map(r => <label key={r.id} className="iv-check"><input type="checkbox" checked={pick.includes(r.id)} disabled={r.id === tx.id} onChange={e => setPick(p => e.target.checked ? [...p, r.id] : p.filter(x => x !== r.id))} />
        {r.item_name} · {KIND_LABEL[r.kind]} {fmtQty(r.qty)} {r.stock_unit}{(r.amount || 0) > 0 ? ` · ${fmtWon(r.amount)}` : ''}{photosOf(r).length ? ' · 사진 있음' : ''}</label>)}</fieldset>}
    {others.length > 0 && <ul className="iv-inv-photos">{others.map(id => <li key={id}>
      <button type="button" className="iv-inv-thumb" onClick={() => setBig(id)} aria-label="크게 보기"><InvThumb id={id} /></button>
      <button type="button" className="sf-btn is-primary" disabled={busy} onClick={() => void join(id)}>이 명세서에 걸기</button></li>)}</ul>}
    <div className="sf-modal-foot">
      <label className={`sf-btn is-primary iv-inv-up${busy ? ' is-busy' : ''}`}>{busy && <SavingMark />}사진 올리기
        <input type="file" accept="image/*,application/pdf" disabled={busy} onChange={e => { void upload(e.target.files?.[0]); e.currentTarget.value = ''; }} /></label>
    </div>
    {big && <div className="iv-inv-big" role="dialog" aria-label="명세서 크게 보기" onClick={() => setBig(null)}><InvThumb id={big} /><a href={invoiceSrc(big)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>원본 열기</a></div>}
  </Modal>;
}

// 메모 앞부분이 팀(피부팀·간호팀·고객·직원구매 등)이면 떼어 '업체, 팀' 줄로, 나머지는 '사유' 줄로(2026-11-09 사용자)
export const splitMemo = (memo?: string | null) => {
  const parts = (memo || '').split(' · ').map(x => x.trim()).filter(Boolean);
  const team = parts.length && /(팀|구매)$/.test(parts[0]) ? parts.shift()! : '';
  return { team, reason: parts.join(' · ').replace('선결제 잔량', '업체 보관 잔량') };
};
export const KIND_TONE: Record<string, string> = { in: 'in', out: 'out', prepaid_buy: 'pp', prepaid_in: 'pp', adjust: 'adj' };
export function TxLog({ notify }: { notify: (m: string) => void }) {
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [kind, setKind] = useState<'all' | 'in' | 'out'>('all');
  const [rows, setRows] = useState<InvTx[] | null>(null);
  const del = async (t: InvTx) => {
    if (!await askConfirm({ title: '이 기록을 지울까요?', message: `${Number(t.date.slice(5, 7))}월 ${Number(t.date.slice(8))}일 ${t.item_name} ${KIND_LABEL[t.kind]} ${fmtQty(t.qty)} ${t.stock_unit} · 되돌림: ${effect(t) || '재고 변화 없음'}`, ok: '삭제', kind: 'delete' })) return;
    try { await invSend('DELETE', `/tx/${t.id}`); notify('기록을 지우고 재고를 되돌렸어요.'); announceInventory(); void load(); } catch (e) { notify(errText(e)); }
  };
  const [inv, setInv] = useState<number | null>(null);
  const [src, setSrc] = useState<InvTx | null>(null);
  const [edit, setEdit] = useState<{ tx: InvTx; v: string; d: string; why?: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set()); // 펼친 입고 묶음(같은 날·같은 업체) — 화면 표시만, 재고와 상관없음
  const editable = (t: InvTx) => (t.kind === 'in' || t.kind === 'out' || t.kind === 'prepaid_in') && !t.daily_date && !t.cancelled_at;
  const stamp = (at: number, by?: string | null) => { const d = new Date(at); return `${d.getMonth() + 1}/${d.getDate()}${by ? ` ${String(by).split('@')[0]}` : ''}`; };
  const load = useCallback(async () => {
    const k = kind === 'in' ? 'in,prepaid_buy,prepaid_in' : kind === 'out' ? 'out' : undefined;
    try { setRows((await invGet('/tx', { from: `${month}-01`, to: `${month}-31`, kind: k })).rows); } catch (e) { notify(errText(e)); setRows([]); }
  }, [month, kind, notify]);
  useEffect(() => { setRows(null); void load(); }, [load]);
  // 다른 화면(일일재고·주문·받기)에서 저장하면 내역도 새로 받음
  useEffect(() => subscribeInventory(() => { void load(); }), [load]);
  const effect = (t: InvTx) => [t.hospital_delta ? `병원재고 ${t.hospital_delta > 0 ? '−' : '+'}${fmtQty(Math.abs(t.hospital_delta))}` : '', t.vendor_delta ? `업체 보관 잔량 ${t.vendor_delta > 0 ? '−' : '+'}${fmtQty(Math.abs(t.vendor_delta))}` : ''].filter(Boolean).join(' · ');
  const keepIn = (t: InvTx) => t.kind === 'prepaid_in' && !t.daily_date && t.vendor_delta < 0;
  const rowOf = (t: InvTx, child = false) => { const m = splitMemo(t.memo); const sub = [t.cancelled_at ? `입고 취소 · ${t.cancel_reason || ''}` : keepIn(t) ? `업체 보관에서 가져옴${t.item_prepaid ? ' · 선결제' : ''}` : (t.kind === 'in' && t.vendor_delta > 0) ? '' : (t.kind === 'in' || t.kind === 'prepaid_in') && !t.daily_date ? '입고확정' : '', m.team, t.cancelled_at ? '' : m.reason, t.updated_at ? `수정 ${stamp(t.updated_at, t.updated_by)}` : ''].filter(Boolean).join(' · ');
        const sign = t.cancelled_at ? '' : t.kind === 'out' ? '−' : t.kind === 'in' || t.kind === 'prepaid_in' ? '+' : '';
        const vBefore = Math.round(((t.vendor_asof ?? 0) - t.vendor_delta) * 1000) / 1000;
        const subNode = sub.split(/(업체 보관 [\d.]+)/).map((x, i) => (i % 2 ? <b key={i} className="iv-kv">{x}</b> : x));
        return <div key={t.id} className={`iv-txrow${t.cancelled_at ? ' is-cancelled' : ''}${child ? ' is-child' : ''}${keepIn(t) ? ` is-src-${srcKind(t)}` : ''}`} role="row">
        <span role="cell" className="c-date">{Number(t.date.slice(5, 7))}.{Number(t.date.slice(8))}</span>
        <span role="cell" className="iv-tx-item"><span className="iv-tx-l1"><b>{t.item_name}</b>{t.vendor_name && <em>{t.vendor_name}</em>}</span><small>{sub ? subNode : ' '}</small></span>
        <span role="cell" className="mid"><i className={`iv-kdot is-${KIND_TONE[t.kind] || 'adj'}`} role="img" aria-label={KIND_LABEL[t.kind]} title={KIND_LABEL[t.kind]} /></span>
        <span role="cell" className="num">{t.cancelled_at ? <small className="iv-cancel-tag">취소 </small> : null}{t.cancelled_at ? <s>{fmtQty(t.qty)}</s> : <b className="iv-qty">{sign}{fmtQty(t.qty)}</b>}{t.bonus_qty ? <small> +{fmtQty(t.bonus_qty)}</small> : null}<small className="iv-unit-t"> {t.stock_unit}</small></span>
        <span role="cell" className="num">{fmtQty(t.stock_asof ?? t.hospital_after)}</span>
        <span role="cell" className="num">{t.vendor_delta ? <b className="iv-kv">{fmtQty(vBefore)} → {fmtQty(t.vendor_asof ?? 0)}</b> : (t.vendor_asof || t.item_prepaid) ? fmtQty(t.vendor_asof ?? 0) : <span className="iv-muted">—</span>}</span>
        <span role="cell" className="mid">{keepIn(t) ? <button type="button" className="iv-inv-mini is-src" onClick={() => setSrc(t)} aria-label={`명세서 ${srcLabel(t)}`}>{srcLabel(t)}</button>
          : INVOICE_KINDS.includes(t.kind) ? <button type="button" className={`iv-inv-mini is-${invoiceState(t)}`} onClick={() => setInv(t.id)} aria-label={`명세서 ${INVOICE_LABEL[invoiceState(t)](t)}`}>{INVOICE_LABEL[invoiceState(t)](t)}</button>
          : <span className="iv-inv-mini is-none" aria-hidden="true">—</span>}</span>
        <span role="cell" className="iv-row-btns">
          {editable(t) ? <button type="button" className="iv-icon-btn" aria-label="수정" title="수정" onClick={() => setEdit({ tx: t, v: String(Math.abs(t.hospital_delta)), d: t.date })}><Pencil size={16} strokeWidth={1.8} /></button> : <span className="iv-icon-btn is-empty" aria-hidden="true" />}
          <button type="button" className="iv-icon-btn is-danger" aria-label="삭제" title="삭제" onClick={() => void del(t)}><Trash2 size={16} strokeWidth={1.8} /></button></span>
      </div>; };
  // 입고 묶음(2026-11-11 사용자): 같은 날·같은 업체의 입고만 한 줄로 묶고(2건 이상), 누르면 실제 입고 건마다 펼침. 다른 업체는 같은 날이어도 따로.
  // 묶음 줄의 'N건'은 입고 건수, 품목 줄의 숫자는 입고 수량(단위 붙임). 수정·취소·명세서는 펼친 개별 건에서.
  type View = { kind: 'row'; t: InvTx } | { kind: 'group'; key: string; list: InvTx[] };
  const view: View[] = [];
  if (rows) {
    const isRecv = (t: InvTx) => (t.kind === 'in' || t.kind === 'prepaid_in') && !t.daily_date;
    const groups = new Map<string, InvTx[]>();
    for (const t of rows) if (isRecv(t)) { const k = `${t.date}|${t.vendor_id ?? 0}`; groups.set(k, [...(groups.get(k) || []), t]); }
    const placed = new Set<string>();
    for (const t of rows) {
      const k = `${t.date}|${t.vendor_id ?? 0}`;
      if (!isRecv(t) || (groups.get(k)?.length || 0) < 2) { view.push({ kind: 'row', t }); continue; }
      if (!placed.has(k)) { placed.add(k); view.push({ kind: 'group', key: k, list: groups.get(k)! }); }
    }
  }
  return <>
    <div className="sf-bar"><div className="sf-month"><button type="button" aria-label="이전 달" onClick={() => setMonth(m => shiftMonth(m, -1))}><ChevronLeft size={18} strokeWidth={2} /></button><strong>{month.slice(0, 4)}년 {Number(month.slice(5))}월</strong><button type="button" aria-label="다음 달" onClick={() => setMonth(m => shiftMonth(m, 1))}><ChevronRight size={18} strokeWidth={2} /></button></div>
      <Seg label="종류" value={kind} onChange={setKind} options={[['all', '전체'], ['in', <><i className="iv-dot is-in" aria-hidden="true" />입고</>], ['out', <><i className="iv-dot is-out" aria-hidden="true" />출고</>]]} /></div>
    {rows == null ? <LoadingBox /> : !rows.length ? <p className="sf-hint">이 달 기록이 없어요.</p> : <div className="iv-txwrap"><div className="iv-txgrid" role="table" aria-label="입출고 내역">
      <div className="iv-legend" aria-hidden="true"><span><i className="iv-kdot is-in" />입고</span><span><i className="iv-kdot is-out" />출고</span><span><i className="iv-kdot is-pp" />업체 보관에서 입고</span></div>
      <div className="iv-txrow is-head" role="row"><span role="columnheader">날짜</span><span role="columnheader">품목</span><span role="columnheader" className="mid">구분</span><span role="columnheader" className="num">수량</span><span role="columnheader" className="num">병원재고</span><span role="columnheader" className="num">업체 보관</span><span role="columnheader" className="mid">명세서</span><span role="columnheader" aria-label="수정·삭제" /></div>
      {view.map(v => v.kind === 'row' ? rowOf(v.t) : <Fragment key={v.key}>
        {(() => { const g = v.list, isOpen = open.has(v.key);
          const photos = new Set(g.flatMap(photosOf)).size, missing = g.filter(t => invoiceState(t) === 'missing').length;
          const toggle = () => setOpen(o => { const n = new Set(o); if (n.has(v.key)) n.delete(v.key); else n.add(v.key); return n; });
          return <div className={`iv-txrow is-group${isOpen ? ' is-open' : ''}`} role="row" onClick={toggle} aria-expanded={isOpen}>
            <span role="cell" className="c-date">{Number(g[0].date.slice(5, 7))}.{Number(g[0].date.slice(8))}</span>
            <span role="cell" className="iv-tx-item"><span className="iv-tx-l1"><b>{g[0].vendor_name || '업체 미지정'}</b><em>입고 {g.length}건</em></span><small>{g.map(t => `${t.item_name} ${fmtQty(t.qty)}${t.stock_unit}`).join(' · ')}</small></span>
            <span role="cell" className="mid"><i className="iv-kdot is-in" role="img" aria-label="입고" title="입고" /></span>
            <span role="cell" className="num"><b className="iv-count">{g.length}건</b></span>
            <span role="cell" className="num"><span className="iv-muted">—</span></span>
            <span role="cell" className="num"><span className="iv-muted">—</span></span>
            <span role="cell" className="mid"><button type="button" className={`iv-inv-mini is-${photos ? 'photo' : missing ? 'missing' : 'optional'}`} onClick={e => { e.stopPropagation(); setInv(g[0].id); }} aria-label="명세서">{photos ? '거래명세서' : missing ? '미등록' : '올리기'}</button></span>
            <span role="cell" className="iv-row-btns"><button type="button" className="iv-icon-btn" aria-label={isOpen ? '접기' : '펼치기'} onClick={e => { e.stopPropagation(); toggle(); }}><ChevronDown size={18} strokeWidth={1.8} className={isOpen ? 'is-up' : ''} /></button></span>
          </div>; })()}
        {open.has(v.key) && v.list.map(t => rowOf(t, true))}
      </Fragment>)}
</div></div>}
    {edit && <Modal title="기록 수정" onClose={() => setEdit(null)}>
      <p>{Number(edit.tx.date.slice(5, 7))}월 {Number(edit.tx.date.slice(8))}일 {edit.tx.item_name} {KIND_LABEL[edit.tx.kind]}</p>
      <label className="sf-input"><span>{edit.tx.kind === 'out' ? '출고일' : '입고일'}</span><input type="date" max={todayLocal()} value={edit.d} onChange={e => setEdit({ ...edit, d: e.target.value })} /></label>
      <label className="sf-input"><span>{edit.tx.kind === 'out' ? '출고 수량' : '받은 수량'}{edit.tx.bonus_qty ? ' (증정 포함)' : ''} ({edit.tx.stock_unit})</span><input type="number" min={0} inputMode="decimal" value={edit.v} disabled={edit.tx.kind === 'in' && edit.tx.vendor_delta > 0} onChange={e => setEdit({ ...edit, v: e.target.value })} /></label>
      {(() => { const d = Math.round(((Number(edit.v) || 0) - Math.abs(edit.tx.hospital_delta)) * 1000) / 1000; const h = edit.tx.kind === 'out' ? -d : d;
        return d ? <div className="iv-calc"><span>병원재고 <b>{h > 0 ? '+' : '−'}{fmtQty(Math.abs(h))}</b></span>{edit.tx.kind === 'prepaid_in' && <span>업체 보관 잔량 <b>{d > 0 ? '−' : '+'}{fmtQty(Math.abs(d))}</b></span>}</div> : null; })()}
      {edit.tx.kind !== 'out' && (edit.why == null
        ? <button type="button" className="sf-btn is-danger iv-cancel-open" onClick={() => setEdit({ ...edit, why: '' })}>입고 취소</button>
        : <div className="iv-cancel-box">
          <label className="sf-input"><span>취소 사유</span><input value={edit.why} onChange={e => setEdit({ ...edit, why: e.target.value })} placeholder="예: 반품, 잘못 받음" /></label>
          <div className="iv-calc"><span>병원재고 <b>−{fmtQty(Math.abs(edit.tx.hospital_delta))}</b></span>{edit.tx.vendor_delta !== 0 && <span>업체 보관 잔량 <b>{edit.tx.vendor_delta < 0 ? '+' : '−'}{fmtQty(Math.abs(edit.tx.vendor_delta))}</b></span>}</div>
          <div className="sf-modal-foot"><button type="button" className="sf-btn" onClick={() => setEdit({ ...edit, why: undefined })}>아니요</button>
            <button type="button" className="sf-btn is-danger" disabled={!edit.why.trim()} onClick={async () => { try { const r = await invSend('POST', `/tx/${edit.tx.id}/cancel`, { reason: edit.why }) as { kept?: string | null; diff?: number }; notify(r?.kept ? `입고를 취소했어요. ${Number(r.kept.slice(5, 7))}/${Number(r.kept.slice(8))}에 센 마감재고는 그대로, 차이 ${fmtQty(r.diff || 0)} ${edit.tx.stock_unit}은 재고 차이로 남겼어요.` : '입고를 취소했어요.'); setEdit(null); announceInventory(); void load(); } catch (e) { notify(errText(e)); } }}>입고 취소</button></div>
        </div>)}
      {edit.why == null && <div className="sf-modal-foot"><button type="button" className="sf-btn" onClick={() => setEdit(null)}>닫기</button>
        <button type="button" className="sf-btn is-primary" disabled={!(Number(edit.v) > 0) || !edit.d} onClick={async () => { try { await invSend('PATCH', `/tx/${edit.tx.id}`, { actual_qty: Number(edit.v), ...(edit.d !== edit.tx.date ? { date: edit.d } : {}) }); notify('고쳤어요.'); setEdit(null); announceInventory(); void load(); } catch (e) { notify(errText(e)); } }}>저장</button></div>}
    </Modal>}
    {src && <SourceDialog tx={src} onClose={() => setSrc(null)} />}
    {inv != null && rows && rows.find(r => r.id === inv) && <InvoiceDialog tx={rows.find(r => r.id === inv)!} rows={rows} notify={notify} onClose={() => setInv(null)} onChange={() => void load()} />}
  </>;
}

/* ───────────── 월말/연말보고서 ───────────── */

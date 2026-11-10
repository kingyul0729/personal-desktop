import { useCallback, useEffect, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { LoadingBox, SavingMark } from '../Feedback';
import { type InvState, type InvTx, KIND_LABEL, announceInventory, fmtQty, fmtWon, invGet, invSend, invUploadInvoice, invoiceSrc, shiftMonth, todayLocal, useInventory, subscribeInventory } from '../../inventoryApi';
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
export const INVOICE_LABEL: Record<InvState2, (t: InvTx) => string> = { photo: t => `사진 ${photosOf(t).length}`, paper: () => '받음', missing: () => '미등록', optional: () => '올리기' };

export function InvoiceDialog({ tx, rows, notify, onClose, onChange }: { tx: InvTx; rows: InvTx[]; notify: (m: string) => void; onClose: () => void; onChange: () => void }) {
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
        <span role="cell" className="num">{fmtQty(t.stock_asof ?? t.hospital_after)}</span>
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

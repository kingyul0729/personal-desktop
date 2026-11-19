import { useCallback, useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { LoadingBox, SavingMark } from '../Feedback';
import { askConfirm } from '../AlertDialog';
import { readWon } from '../../koreanAmount';
import { type InvItem, type InvTx, announceInventory, fmtQty, invGet, invSend, md, subscribeInventory, useInventory } from '../../inventoryApi';
import { Modal, Problem, Shell, errText, useToast } from './shared';

// 업체 보관(2026-11-19 사용자 지정): 잔액(원) / 보관 재고(수량) 두 탭을 같은 모양으로 — 왼쪽 목록 → 오른쪽 숫자 카드 → 날짜별 내역.
// 잔액 = 중복 결제·반품 등으로 업체에 남은 돈(등록 → 차감 → 환급), 보관 재고 = 결제한 물건 중 업체에 맡긴 수량(지금 있는 업체 보관 잔량을 그대로 보여 주기만, 입고는 재고주문에서).
type BalRow = { id: number; vendor_id: number; date: string; kind: 'add' | 'use' | 'refund'; amount: number; reason: string | null; memo: string | null; order_id: number | null; left: number;
  ordered_at?: string | null; option_label?: string | null; item_name?: string | null; order_amount?: number | null };
type BalOrder = { id: number; ordered_at: string; option_label: string | null; amount: number; qty: number; bonus_qty: number; prepaid: number; item_name: string; stock_unit: string; vendor_id: number };
type BalState = { vendors: { id: number; name: string; active: number; balance: number; n: number }[]; rows: BalRow[]; orders: BalOrder[]; reasons: string[] };

// 날짜: 올해가 아니면 연도까지(2026-11-19 사용자 '작년 중복 결제인데 10/30이라 올해로 보임') — 예 2025.10.30
const thisYear = String(new Date().getFullYear());
const day = (d: string | null | undefined) => (!d ? '' : d.slice(0, 4) === thisYear ? md(d) : `${d.slice(0, 4)}.${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`);
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}`;
const Num = ({ v, u, read }: { v: string; u: string; read?: number }) => <><b className="vb-n">{v}<small>{u}</small></b>{read != null && <span className="vb-read">{read >= 10000 ? readWon(read) : '—'}</span>}</>;

// 2026-11-19 사용자: 메뉴 이름 '업체 잔액', 보관 재고(수량) 탭은 품목별 재고와 겹쳐서 뺌(KeepTab 코드는 남김 — 품목별 재고의 '업체 보관' 걸러 보기가 같은 기록).
export function VendorStore() {
  const [toast, setToast] = useToast();
  return <Shell toast={toast}>
    <BalanceTab notify={setToast} />
  </Shell>;
}

function BalanceTab({ notify }: { notify: (m: string) => void }) {
  const [st, setSt] = useState<BalState | null>(null);
  const [err, setErr] = useState('');
  const [pick, setPick] = useState<number | null>(null);
  const [form, setForm] = useState<null | { kind: 'add' | 'refund' | 'use'; row?: BalRow }>(null);
  const load = useCallback(async () => { try { setSt(await invGet('/vendor-bal')); setErr(''); } catch (e) { setErr(errText(e)); } }, []);
  useEffect(() => { void load(); return subscribeInventory(() => void load()); }, [load]);
  if (err && !st) return <p className="sf-hint is-warn">{err}</p>;
  if (!st) return <LoadingBox />;
  // 목록: 잔액이 있거나 기록이 있는 업체 먼저, 그다음 거래 중인 업체
  const list = [...st.vendors].filter(v => v.n > 0 || v.active).sort((a, b) => (b.balance > 0 ? 1 : 0) - (a.balance > 0 ? 1 : 0) || (b.n > 0 ? 1 : 0) - (a.n > 0 ? 1 : 0));
  const v = list.find(x => x.id === pick) ?? list[0];
  if (!v) return <p className="sf-hint">기록 없음</p>;
  const rows = st.rows.filter(r => r.vendor_id === v.id);
  const sum = (k: BalRow['kind']) => rows.filter(r => r.kind === k).reduce((a, r) => a + r.amount, 0);
  const del = async (r: BalRow) => {
    if (!await askConfirm({ kind: 'delete' })) return;
    try { setSt(await invSend('DELETE', `/vendor-bal/${r.id}`) as BalState); notify('지웠어요.'); announceInventory(); } catch (e) { notify(errText(e)); }
  };
  return <div className="vb-split">
    <nav className="vb-list" aria-label="업체">{list.map(x => <button key={x.id} type="button" aria-current={x.id === v.id ? 'true' : undefined} onClick={() => setPick(x.id)}>
      <b>{x.name}</b><small className={x.balance > 0 ? '' : 'is-zero'}>잔액 {won(x.balance)}원</small></button>)}</nav>
    <section className="vb-main">
      <div className="vb-card">
        <header className="vb-head"><h3>{v.name}<small>업체 잔액</small></h3>
          <div className="vb-btns"><button type="button" className="sf-btn" disabled={!(v.balance > 0)} onClick={() => setForm({ kind: 'refund' })}>환급 입금</button>
            <button type="button" className="sf-btn" disabled={!(v.balance > 0)} onClick={() => setForm({ kind: 'use' })}>잔액 차감</button>
            <button type="button" className="sf-btn is-primary" onClick={() => setForm({ kind: 'add' })}>잔액 등록</button></div></header>
        <dl className="vb-stats">
          <div className="is-main"><dt>남은 금액</dt><dd><Num v={won(v.balance)} u="원" read={v.balance} /></dd></div>
          <div><dt>잔액 등록</dt><dd><Num v={won(sum('add'))} u="원" read={sum('add')} /></dd></div>
          <div><dt>잔액 차감</dt><dd><Num v={won(sum('use'))} u="원" read={sum('use')} /></dd></div>
          <div><dt>환급 입금</dt><dd><Num v={won(sum('refund'))} u="원" read={sum('refund')} /></dd></div>
        </dl>
      </div>
      <div className="vb-hist"><h4>내역<span className="vb-leg"><span><i className="vb-dot is-add" />잔액 등록</span><span><i className="vb-dot is-use" />잔액 차감</span><span><i className="vb-dot is-refund" />환급 입금</span></span></h4>
        {!rows.length ? <p className="sf-hint">기록 없음</p> : <ul className="vb-rows">{rows.map(r => <li key={r.id}>
          <span className="vb-date">{day(r.date)}</span><i className={`vb-dot is-${r.kind}`} />
          <span className="vb-what"><b>{r.kind === 'add' ? `잔액 등록${r.reason ? ` · ${r.reason}` : ''}` : r.kind === 'use' ? '잔액 차감' : '환급 입금'}</b>
            <small>{r.kind === 'use' ? `${r.ordered_at ? day(r.ordered_at) : ''} ${r.item_name || ''} 주문${r.order_amount ? ` · 주문 금액 ${won(r.order_amount)}원` : ''}` : r.memo || ' '}</small></span>
          <span className={`vb-amt is-${r.kind}`}>{r.kind === 'add' ? '+' : '−'}{won(r.amount)}원</span>
          <span className="vb-left">남음 {won(r.left)}원</span>
          <span className="vb-ic">{r.kind !== 'use' && <button type="button" aria-label="수정" onClick={() => setForm({ kind: r.kind as 'add' | 'refund', row: r })}><Pencil size={15} strokeWidth={1.8} /></button>}
            <button type="button" aria-label="삭제" onClick={() => void del(r)}><Trash2 size={15} strokeWidth={1.8} /></button></span>
        </li>)}</ul>}
      </div>
    </section>
    {form && <BalForm st={st} vendor={v} kind={form.kind} row={form.row} onClose={() => setForm(null)} onDone={(next, msg) => { setSt(next); setForm(null); notify(msg); announceInventory(); }} />}
  </div>;
}

function BalForm({ st, vendor, kind, row, onClose, onDone }: { st: BalState; vendor: BalState['vendors'][number]; kind: 'add' | 'refund' | 'use'; row?: BalRow; onClose: () => void; onDone: (s: BalState, msg: string) => void }) {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const [f, setF] = useState({ amount: row ? String(row.amount) : '', date: row?.date || today, reason: row?.reason || '', memo: row?.memo || '', order: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const orders = st.orders.filter(o => o.vendor_id === vendor.id);
  const ord = orders.find(o => String(o.id) === f.order);
  const amount = Number(f.amount) || 0;
  const ready = kind === 'use' ? !!ord : amount > 0 && !!f.date && (kind !== 'add' || !!f.reason);
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const body = kind === 'use' ? { kind, order_id: ord!.id } : { kind, id: row?.id, vendor_id: vendor.id, amount, date: f.date, reason: f.reason || null, memo: f.memo || null };
      const r = await invSend('POST', '/vendor-bal', body) as BalState & { used?: number };
      onDone(r, kind === 'use' ? `잔액에서 ${won(r.used || 0)}원 차감했어요.` : row ? '고쳤어요.' : kind === 'add' ? '잔액을 등록했어요.' : '환급 입금을 적었어요.');
    } catch (e) { setError(errText(e)); setBusy(false); }
  };
  const title = `${kind === 'add' ? '잔액 등록' : kind === 'refund' ? '환급 입금' : '잔액 차감'} · ${vendor.name}`;
  const use = ord ? Math.min(vendor.balance, ord.amount) : 0;
  return <Modal title={title} onClose={onClose}>
    {kind === 'use' ? <>
      <label className="sf-input"><span>주문</span><select value={f.order} onChange={e => setF(x => ({ ...x, order: e.target.value }))}>
        <option value="">주문 선택</option>{orders.map(o => <option key={o.id} value={o.id}>{day(o.ordered_at)} {o.item_name} · {o.option_label || `${fmtQty(o.qty)} ${o.stock_unit}`} · {won(o.amount)}원</option>)}</select></label>
      {!orders.length && <p className="sf-hint">기록 없음</p>}
      {ord && <dl className="vb-calc"><div><dt>주문 금액</dt><dd>{won(ord.amount)}원</dd></div><div><dt>잔액 차감</dt><dd>−{won(use)}원</dd></div>
        <div className="is-total"><dt>실제 결제</dt><dd>{won(ord.amount - use)}원</dd></div><div><dt>차감 후 남은 금액</dt><dd>{won(vendor.balance - use)}원</dd></div></dl>}
    </> : <>
      {kind === 'add' && <div className="sf-input"><span>사유</span><div className="sf-pills">{st.reasons.map(r => <button key={r} type="button" aria-pressed={f.reason === r} onClick={() => setF(x => ({ ...x, reason: r }))}>{r}</button>)}</div></div>}
      <div className="vb-form2">
        <label className="sf-input"><span>금액(원)</span><input type="number" min={0} inputMode="numeric" value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value }))} />{amount >= 10000 && <small>{readWon(amount)}</small>}</label>
        <label className="sf-input"><span>{kind === 'refund' ? '입금일' : '날짜'}</span><input type="date" value={f.date} onChange={e => setF(x => ({ ...x, date: e.target.value }))} /></label>
      </div>
      <label className="sf-input"><span>메모</span><input value={f.memo} onChange={e => setF(x => ({ ...x, memo: e.target.value }))} placeholder="선택" /></label>
    </>}
    {error && <p className="sf-hint is-warn">{error}</p>}
    <div className="sf-modal-foot"><button type="button" className="sf-btn" onClick={onClose}>닫기</button>
      <button type="button" className="sf-btn is-primary" disabled={!ready || busy} onClick={() => void submit()}>{busy && <SavingMark />}{row ? '저장' : kind === 'add' ? '등록' : kind === 'refund' ? '입금 기록' : '차감'}</button></div>
  </Modal>;
}

// 보관 재고(수량): 확인만(입고·잔량 고치기는 재고주문에서). 지금 있는 업체 보관 잔량과 그 기록을 그대로 보여 준다.
function KeepTab() {
  const { state, error } = useInventory();
  const [pick, setPick] = useState<number | null>(null);
  const [rows, setRows] = useState<InvTx[] | null>(null);
  const items = (state?.items || []).filter(i => i.prepaid || i.vendor_stock > 0).sort((a, b) => (b.vendor_stock > 0 ? 1 : 0) - (a.vendor_stock > 0 ? 1 : 0) || b.prepaid - a.prepaid);
  const it: InvItem | undefined = items.find(i => i.id === pick) ?? items[0];
  const load = useCallback(async () => {
    if (!it) return;
    try { setRows(((await invGet('/tx', { item_id: it.id })).rows as InvTx[]).filter(r => r.vendor_delta !== 0 && !r.cancelled_at)); } catch { setRows([]); }
  }, [it?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setRows(null); void load(); return subscribeInventory(() => void load()); }, [load]);
  if (error) return <Problem error={error} />;
  if (!state) return <LoadingBox />;
  if (!it) return <p className="sf-hint">기록 없음</p>;
  const u = it.stock_unit;
  const list = rows || [];
  const bought = list.reduce((a, r) => a + (r.kind === 'prepaid_buy' ? r.vendor_delta : r.kind === 'in' && r.vendor_delta > 0 ? r.qty + r.bonus_qty + r.vendor_delta : 0), 0);
  const toHosp = list.reduce((a, r) => a + (r.kind === 'prepaid_in' ? -r.vendor_delta : r.kind === 'in' && r.vendor_delta > 0 ? r.qty + r.bonus_qty : 0), 0);
  const lastIn = list.find(r => r.kind === 'prepaid_in');
  const label = (r: InvTx) => r.kind === 'prepaid_buy' ? '구매 · 선결제' : r.kind === 'in' ? '구매 · 업체 보관' : r.kind === 'prepaid_in' ? '업체 보관에서 입고' : '잔량 고치기';
  const sub = (r: InvTx) => r.kind === 'in' ? `병원 ${fmtQty(r.qty + r.bonus_qty)} · 업체 보관 ${fmtQty(r.vendor_delta)}` : r.kind === 'prepaid_in' ? '결제 없음' : r.kind === 'prepaid_buy' && r.amount ? `${won(r.amount)}원` : ' ';
  return <div className="vb-split">
    <nav className="vb-list" aria-label="품목">{items.map(x => <button key={x.id} type="button" aria-current={x.id === it.id ? 'true' : undefined} onClick={() => setPick(x.id)}>
      <b>{x.name}</b><small className={x.vendor_stock > 0 ? '' : 'is-zero'}>남음 {fmtQty(x.vendor_stock)} {x.stock_unit}</small></button>)}</nav>
    <section className="vb-main">
      <div className="vb-card">
        <header className="vb-head"><h3>{it.name}<small>{it.vendor_name || '거래처 없음'} · {it.prepaid ? '선결제' : '일반'}</small></h3></header>
        <dl className="vb-stats">
          <div className="is-main"><dt>남은 수량</dt><dd><Num v={fmtQty(it.vendor_stock)} u={u} /></dd></div>
          <div><dt>총 구매 수량</dt><dd><Num v={rows ? fmtQty(Math.round(bought * 1000) / 1000) : '—'} u={u} /></dd></div>
          <div><dt>병원 입고</dt><dd><Num v={rows ? fmtQty(Math.round(toHosp * 1000) / 1000) : '—'} u={u} /></dd></div>
          <div><dt>마지막 입고</dt><dd><b className="vb-n is-date">{lastIn ? md(lastIn.date) : '—'}</b></dd></div>
        </dl>
      </div>
      <div className="vb-hist"><h4>내역<span className="vb-leg"><span><i className="vb-dot is-add" />구매</span><span><i className="vb-dot is-use" />업체 보관에서 입고</span></span></h4>
        {!rows ? <LoadingBox /> : !list.length ? <p className="sf-hint">기록 없음</p> : <ul className="vb-rows is-keep">{list.map(r => <li key={r.id}>
          <span className="vb-date">{md(r.date)}</span><i className={`vb-dot ${r.vendor_delta > 0 ? 'is-add' : r.kind === 'prepaid_in' ? 'is-use' : 'is-refund'}`} />
          <span className="vb-what"><b>{label(r)}</b><small>{sub(r)}</small></span>
          <span className={`vb-amt ${r.vendor_delta > 0 ? 'is-add' : ''}`}>{r.vendor_delta > 0 ? '+' : '−'}{fmtQty(Math.abs(r.vendor_delta))} {u}</span>
          <span className="vb-left">남음 {fmtQty(r.vendor_asof ?? null)}</span>
        </li>)}</ul>}
      </div>
    </section>
  </div>;
}

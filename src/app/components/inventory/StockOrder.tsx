import { useState } from 'react';
import { LoadingBox, SavingMark } from '../Feedback';
import { readWon } from '../../koreanAmount';
import { type InvItem, type InvOption, type InvOrder, type InvState, type InvVendor, announceInventory, fmtQty, fmtWon, invSend, invUploadInvoice, useInventory } from '../../inventoryApi';
import { type Flag, FlagTag, Modal, PhotoPick, Problem, QtyInput, Seg, Shell, errText, flagOf, useToast, withUnit } from './shared';

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
export function OrderBoard({ state, q, notify }: { state: InvState; q: string; notify: (m: string) => void }) {
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
          {item.prepaid ? <PrepaidOrder key={item.id} item={item} orders={state.orders} today={state.today} notify={notify} vendor={state.vendors.find(v => v.id === item.vendor_id) || null} /> : <div className="iv-d-sec"><h4><i className="iv-step">1</i>주문</h4>
            {!item.options.some(o => !o.prepaid) && <p className="iv-recv-none">구매조건 없음</p>}
            <ul className="iv-d-opts">{item.options.filter(o => !o.prepaid).map(o => <li key={o.id}>
              <div className="iv-d-opt-main"><b>{o.label || `${fmtQty(o.qty)} ${item.stock_unit}`}</b>
                <span>{fmtQty(o.qty)} {item.stock_unit}{o.bonus_qty ? ` + 증정 ${fmtQty(o.bonus_qty)}` : ''}</span></div>
              <div className="iv-d-opt-price"><b>{fmtWon(o.amount)}</b>{o.amount != null && o.amount >= 10000 && <small>{readWon(o.amount)}</small>}</div>
              <button type="button" className="sf-btn is-primary" onClick={() => setPick({ item, opt: o })}>주문</button>
            </li>)}</ul>
          </div>}
          <ReceiveHere key={`r${item.id}`} item={item} orders={waiting(item.id)} today={state.today} notify={notify} vendor={state.vendors.find(v => v.id === item.vendor_id) || null} />
        </> : <p className="iv-split-empty">왼쪽에서 품목을 고르세요</p>}
      </section>
    </div>
    {pick && <OrderDialog item={pick.item} opt={pick.opt} today={state.today} onClose={() => setPick(null)} onDone={msg => { notify(msg); setPick(null); announceInventory(); }} />}
  </>;
}

// ② 받기: 고른 품목의 받기 전 주문만. 실제 도착 수량 + 명세서 사진 + 입고확정(사진은 그 입고 기록에 바로 올라가 '명세서 받음').
// 선결제 품목은 잔량에서(잔량 −, 병원재고 +), 일반 품목은 나눠 받으면 날짜마다 따로. 아래에 일반 품목은 '증정·행사로 받기', 선결제 품목은 '잔량 고치기'.
// 결제정보(2026-11-11 사용자 문서): 계좌입금 업체는 입금에 필요한 업체명·예금주·은행·계좌번호·총 결제금액, 카드·홈페이지·방문결제는 결제 방법·금액만(명세서는 입출고 내역).
export function PayInfo({ vendor, amount }: { vendor: InvVendor | null; amount: number | null }) {
  if (!vendor) return null;
  const bank = /계좌|이체|입금/.test(vendor.payment_method || '');
  return <div className="iv-paybox">
    <span>{vendor.payment_method || '결제 방법 —'}</span>
    {bank && <><span>{vendor.company || vendor.name}</span><span>예금주 <b>{vendor.holder || '—'}</b></span><span>{vendor.bank || '은행 —'} <b>{vendor.account || '—'}</b></span></>}
    <span>총 결제금액 <b>{fmtWon(amount)}</b></span>
  </div>;
}
export function ReceiveHere({ item, orders, today, notify, vendor = null }: { item: InvItem; orders: InvOrder[]; today: string; notify: (m: string) => void; vendor?: InvVendor | null }) {
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
        try { const up = await invUploadInvoice(f, [r.tx_id], true) as { linked?: number }; msg += (up?.linked || 1) > 1 ? ` 명세서 사진을 같은 날 같은 업체 ${up.linked}건에 올렸어요.` : ' 명세서 사진도 올렸어요.'; }
        catch (e) { msg += ` 사진은 못 올렸어요(${errText(e)}). 입출고 내역에서 다시 올려 주세요.`; }
      } else if (r?.tx_id) { // 같은 날·같은 업체 명세서가 이미 있으면 거기에 함께
        try { const j = await invSend('POST', '/invoices/join', { tx_id: r.tx_id }) as { linked?: boolean }; if (j?.linked) msg += ' 같은 날 명세서에 함께 걸었어요.'; } catch { /* 사진은 입출고 내역에서 */ }
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
      {!o.prepaid && !(o.received_qty || 0) && <PayInfo vendor={vendor} amount={o.amount} />}
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
export function PrepaidOrder({ item, orders, today, notify, vendor = null }: { item: InvItem; orders: InvOrder[]; today: string; notify: (m: string) => void; vendor?: InvVendor | null }) {
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
    {opt && <PayInfo vendor={vendor} amount={opt.amount} />}
    <div className="iv-pp-foot"><button type="button" className="sf-btn is-primary" disabled={!ready} onClick={() => void submit()}>{busy && <SavingMark />}주문</button></div>
  </div>;
}

export function OrderDialog({ item, opt, today, onClose, onDone }: { item: InvItem; opt: InvOption; today: string; onClose: () => void; onDone: (m: string) => void }) {
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

export function ItemEditor({ state, notify, onChange }: { state: InvState; notify: (m: string) => void; onChange: () => void }) {
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

export function ItemForm({ item, state, notify, onSaved, onDeleted }: { item: InvItem | null; state: InvState; notify: (m: string) => void; onSaved: () => void; onDeleted: () => void }) {
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
    {item?.vendor_id && state.vendors.find(v => v.id === item.vendor_id) && <VendorPay key={item.vendor_id} vendor={state.vendors.find(v => v.id === item.vendor_id)!} notify={notify} onSaved={onSaved} />}
  </div>;
}

// 거래처 결제 정보(같은 거래처의 모든 품목에 함께 적용)
export function VendorPay({ vendor, notify, onSaved }: { vendor: InvVendor; notify: (m: string) => void; onSaved: () => void }) {
  const [f, setF] = useState({ company: vendor.company || '', payment_method: vendor.payment_method || '', bank: vendor.bank || '', account: vendor.account || '', holder: vendor.holder || '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF(x => ({ ...x, [k]: e.target.value }));
  return <section className="iv-sec"><h3>거래처 결제 정보 · {vendor.name}</h3>
    <div className="iv-fgrid">
      <label className="sf-input"><span>회사명</span><input value={f.company} onChange={set('company')} /></label>
      <label className="sf-input"><span>결제 방법</span><input value={f.payment_method} onChange={set('payment_method')} placeholder="카드결제·계좌입금·방문결제" /></label>
      <label className="sf-input"><span>은행</span><input value={f.bank} onChange={set('bank')} /></label>
      <label className="sf-input"><span>계좌번호</span><input value={f.account} onChange={set('account')} inputMode="numeric" /></label>
      <label className="sf-input"><span>예금주</span><input value={f.holder} onChange={set('holder')} /></label>
    </div>
    <div className="sf-modal-foot"><button type="button" className="sf-btn is-primary" disabled={busy} onClick={async () => { setBusy(true); try { await invSend('POST', '/vendors', { id: vendor.id, ...f }); notify('거래처 결제 정보를 저장했어요.'); onSaved(); } catch (e) { notify(errText(e)); } finally { setBusy(false); } }}>{busy && <SavingMark />}저장</button></div>
  </section>;
}

export function Options({ item, notify, onSaved }: { item: InvItem; notify: (m: string) => void; onSaved: () => void }) {
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

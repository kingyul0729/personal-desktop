import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { LoadingBox, SavingMark } from '../Feedback';
import { readWon } from '../../koreanAmount';
import { type InvItem, type InvOption, type InvOrder, type InvState, type InvVendor, PAY_METHODS, TIMING_LABEL, UNITS, announceInventory, fmtQty, fmtWon, invSend, invUploadInvoice, md, optOpen, optState, timingOf, useInventory } from '../../inventoryApi';
import { type Flag, FlagTag, Modal, PhotoPick, Problem, QtyInput, Seg, Shell, errText, flagOf, useToast, withUnit } from './shared';

export function StockOrder() {
  const { state, error, reload } = useInventory();
  const [toast, setToast] = useToast();
  const [tab, setTab] = useState<'order' | 'items'>('order');
  const q = ''; // 검색창은 2026-11-12 사용자 요청으로 뺌
  if (error) return <Problem error={error} />;
  if (!state) return <LoadingBox />;
  return <Shell toast={toast}>
    <div className="sf-bar iv-obar"><Seg label="보기" value={tab} onChange={setTab} options={[['order', '주문·받기'], ['items', '품목']]} />
</div>
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
  // 거래 중단한 업체의 품목은 새 주문 목록에서 빠짐(받을 주문이나 업체 보관 잔량이 남아 있으면 받기·가져오기를 위해 보이고, 주문 칸만 없음)
  const stopped = new Set(state.vendors.filter(v => v.active === 0).map(v => v.id));
  const isStopped = (it: InvItem) => !!it.vendor_id && stopped.has(it.vendor_id);
  const list = state.items.filter(it => (!q || it.name.includes(q) || (it.vendor_name || '').includes(q)) && (!onlyWait || waiting(it.id).length > 0) && (!isStopped(it) || waiting(it.id).length > 0 || it.vendor_stock > 0));
  // 행사 표시: 지금 기간 안인 행사 옵션이 있고 다른 표시가 없을 때만('부족'이면 '부족'만, 2026-11-12 사용자)
  const onEvent = (it: InvItem) => it.options.some(o => (o.start_date || o.end_date) && optOpen(o, state.today));
  const Tag = ({ it }: { it: InvItem }) => { const f = flagOf(it, state.orders); return f ? <FlagTag flag={f} /> : onEvent(it) ? <span className="iv-tag is-event">행사</span> : null; };
  const RANK: Record<Flag, number> = { bringing: 5, wait: 4, low: 3, bring: 2 };
  const rank = (it: InvItem) => { const f = flagOf(it, state.orders); return f ? RANK[f] : 0; };
  // 목록 묶음(2026-11-12 사용자): 선결제 품목은 맨 위, 나머지는 업체명 가나다순 묶음(업체 없는 품목은 맨 끝 '거래처 없음')
  const byVendor = new Map<string, InvItem[]>();
  for (const it of list.filter(i => !i.prepaid)) { const k = it.vendor_name || ''; byVendor.set(k, [...(byVendor.get(k) || []), it]); }
  const vendorKeys = [...byVendor.keys()].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b, 'ko'));
  const groups: [string, InvItem[]][] = [['선결제 품목', list.filter(i => i.prepaid)], ...vendorKeys.map(k => [k || '거래처 없음', byVendor.get(k)!] as [string, InvItem[]])];
  for (const g of groups) g[1].sort((x, y) => rank(y) - rank(x) || x.name.localeCompare(y.name, 'ko'));
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
              <Tag it={it} />
            </button></li>)}</ul></div>)
          : <p className="iv-split-empty">찾는 품목이 없어요</p>}
      </nav>
      <section className="iv-split-detail" aria-label="품목 상세">
        {item ? <>
          <header className="iv-d-head">
            <div><h3>{item.name}<span className={`iv-kind${item.prepaid ? ' is-pp' : ''}`}>{item.prepaid ? '선결제' : '일반'}</span><Tag it={item} /></h3><p>{item.vendor_name || '거래처 없음'}{item.category ? ` · ${item.category}` : ''}</p></div>
          </header>
          <dl className="iv-d-stats">
            <div><dt>병원재고</dt><dd className={flagOf(item, state.orders) === 'low' ? 'is-low' : ''}>{withUnit(item.hospital_stock, item.stock_unit)}</dd></div>
            {item.prepaid || item.vendor_stock > 0 ? <div><dt>업체 보관</dt><dd className={item.prepaid ? '' : 'is-keep'}>{withUnit(item.vendor_stock, item.stock_unit)}</dd></div> : null}
            <div><dt>최소재고</dt><dd>{item.min_stock > 0 ? withUnit(item.min_stock, item.stock_unit) : '—'}</dd></div>
            <div><dt>{item.prepaid ? '개당원가' : '구매단가'}</dt><dd>{item.prepaid ? (item.unit_cost != null ? `${item.unit_cost.toLocaleString('ko-KR')}원` : '—') : fmtWon(item.price)}</dd></div>
            {item.paid_unit_cost != null ? <div><dt>유상단가</dt><dd>{item.paid_unit_cost.toLocaleString('ko-KR')}원</dd></div> : null}
          </dl>
          {isStopped(item) ? <div className="iv-d-sec"><h4><i className="iv-step">1</i>주문</h4><p className="iv-recv-none">거래 중단</p></div> : item.prepaid ? <PrepaidOrder key={item.id} item={item} orders={state.orders} today={state.today} notify={notify} vendor={state.vendors.find(v => v.id === item.vendor_id) || null} /> : <div className="iv-d-sec"><h4><i className="iv-step">1</i>주문</h4>
            {!item.options.some(o => !o.prepaid && optOpen(o, state.today)) && <p className="iv-recv-none">구매조건 없음</p>}
            <ul className="iv-d-opts">{item.options.filter(o => !o.prepaid && optOpen(o, state.today)).map(o => <li key={o.id} className={o.end_date || o.start_date ? 'is-event' : ''}>
              <div className="iv-d-opt-main"><b>{o.label || `${fmtQty(o.qty)} ${item.stock_unit}`}{(o.start_date || o.end_date) && <span className="iv-tag is-event">행사</span>}</b>
                <span>{fmtQty(o.qty)} {item.stock_unit}{o.bonus_qty ? ` + 증정 ${fmtQty(o.bonus_qty)}` : ''}{o.end_date ? ` · ${md(o.end_date)}까지` : ''}</span></div>
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
  // 라벨 | 값 격자(2026-11-12 사용자 '라벨과 값을 구분하고 일정한 그리드로') — 보이는 정보는 그대로
  return <dl className="iv-paybox">
    <div><dt>결제 방법</dt><dd>{vendor.payment_method || '—'}</dd></div>
    {bank && <><div><dt>업체</dt><dd>{vendor.company || vendor.name}</dd></div>
      <div><dt>예금주</dt><dd>{vendor.holder || '—'}</dd></div>
      <div><dt>은행</dt><dd>{vendor.bank || '—'}</dd></div>
      <div><dt>계좌번호</dt><dd>{vendor.account || '—'}</dd></div></>}
    <div className="is-amt"><dt>총 결제금액</dt><dd>{fmtWon(amount)}</dd></div>
  </dl>;
}
export function ReceiveHere({ item, orders, today, notify, vendor = null }: { item: InvItem; orders: InvOrder[]; today: string; notify: (m: string) => void; vendor?: InvVendor | null }) {
  const [date, setDate] = useState(today);
  const [actual, setActual] = useState<Record<number, string>>({});
  const [keep, setKeep] = useState<Record<number, string>>({}); // 일반 품목: 돈은 냈고 일부를 업체에 맡김(2026-11-12 사용자 '킵')
  const [bring, setBring] = useState('');
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
      {(() => { const a = Number(actual[o.id] ?? left(o)) || 0, k = o.prepaid ? 0 : Number(keep[o.id]) || 0, over = Math.round((a + k) * 1000) / 1000 > left(o);
        return <>
      <div className={o.prepaid ? 'iv-recv-one' : 'iv-recv-two'}>
        <label className="sf-input"><span>실제 입고 수량 ({u})</span><input type="number" min={0} inputMode="decimal" value={actual[o.id] ?? String(left(o))} onChange={e => setActual(x => ({ ...x, [o.id]: e.target.value }))} /></label>
        {!o.prepaid && <label className="sf-input"><span>업체 보관 ({u})</span><input type="number" min={0} inputMode="decimal" value={keep[o.id] ?? ''} placeholder="0" onChange={e => { const v = e.target.value; setKeep(x => ({ ...x, [o.id]: v })); if (actual[o.id] == null) setActual(x => ({ ...x, [o.id]: String(Math.max(0, Math.round((left(o) - (Number(v) || 0)) * 1000) / 1000)) })); }} /></label>}
      </div>
      {!o.prepaid && (a > 0 || k > 0) && <div className="iv-recv-calc">
        <span>병원재고 {fmtQty(item.hospital_stock)} → <b>{fmtQty(Math.round((item.hospital_stock + a) * 1000) / 1000)}</b></span>
        {k > 0 && <span>업체 보관 {fmtQty(item.vendor_stock)} → <b>{fmtQty(Math.round((item.vendor_stock + k) * 1000) / 1000)}</b></span>}
        {!(o.received_qty || 0) && <span>결제 <b>{fmtWon(o.amount)}</b></span>}
        {over && <span className="is-warn">남은 수량 {fmtQty(left(o))} {u}보다 많아요</span>}</div>}
      <PhotoPick file={photo[`o${o.id}`]} onPick={f => setPhoto(v => ({ ...v, [`o${o.id}`]: f }))} />
      <div className="iv-recv-acts">
        <button type="button" className="sf-btn" onClick={() => void cancel(o.id)}>{(o.received_qty || 0) > 0 ? '마감' : '취소'}</button>
        <button type="button" className="sf-btn is-primary" disabled={busy === `o${o.id}` || !(a + k > 0) || over} onClick={() => void run(`o${o.id}`, () => invSend('POST', '/receive', { order_id: o.id, actual_qty: a, ...(k > 0 ? { keep_qty: k } : {}), date }), k > 0 ? `입고확정했어요. 업체 보관 ${fmtQty(k)} ${u}` : '입고확정했어요.').then(okd => { if (okd) { setKeep(x => ({ ...x, [o.id]: '' })); setActual(x => { const n = { ...x }; delete n[o.id]; return n; }); } })}>{busy === `o${o.id}` && <SavingMark />}입고확정</button>
      </div></>; })()}
    
      {o.prepaid ? (() => { const a = Number(actual[o.id] ?? left(o)) || 0; return <div className="iv-recv-calc">
        <span>이번 입고 <b>{fmtQty(a)} {u}</b></span>
        <span>병원재고 {fmtQty(item.hospital_stock)} → <b>{fmtQty(Math.round((item.hospital_stock + a) * 1000) / 1000)} {u}</b></span>
        <span>업체 보관 잔량 {fmtQty(item.vendor_stock)} → <b className={a > item.vendor_stock ? 'is-warn' : ''}>{fmtQty(Math.round((item.vendor_stock - a) * 1000) / 1000)} {u}</b></span></div>; })() : null}
    </li>)}</ul> : <p className="iv-recv-none">받을 주문 없음</p>}
    {!item.prepaid && item.vendor_stock > 0 && (() => { const b = Number(bring) || 0, over = b > item.vendor_stock; return <div className="iv-recv-keep">
      <div className="iv-recv-what"><b>업체 보관에서 가져오기</b><small>업체 보관 {withUnit(item.vendor_stock, u)}</small></div>
      <label className="sf-input"><span>가져온 수량 ({u})</span><input type="number" min={0} inputMode="decimal" value={bring} onChange={e => setBring(e.target.value)} /></label>
      {b > 0 && <div className="iv-recv-calc"><span>병원재고 {fmtQty(item.hospital_stock)} → <b>{fmtQty(Math.round((item.hospital_stock + b) * 1000) / 1000)}</b></span>
        <span>업체 보관 {fmtQty(item.vendor_stock)} → <b className={over ? 'is-warn' : ''}>{fmtQty(Math.round((item.vendor_stock - b) * 1000) / 1000)}</b></span><span className="is-ok">결제 없음</span></div>}
      <div className="iv-recv-acts"><button type="button" className="sf-btn is-primary" disabled={!(b > 0) || over || busy === 'bring'} onClick={async () => { if (await run('bring', () => invSend('POST', '/receive', { from_prepaid: true, item_id: item.id, actual_qty: b, date }), '업체 보관에서 가져왔어요.')) setBring(''); }}>{busy === 'bring' && <SavingMark />}입고확정</button></div>
    </div>; })()}
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
  const opts = item.options.filter(o => o.prepaid && optOpen(o, date));
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
      <b>{fmtQty(o.qty + (o.bonus_qty || 0))} {u}{(o.start_date || o.end_date) && <span className="iv-tag is-event">행사</span>}</b><span>{fmtWon(o.amount)}{o.end_date ? ` · ${md(o.end_date)}까지` : ''}</span></button>)}</div></div>}
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
  const stopped = (it: InvItem) => state.vendors.find(v => v.id === it.vendor_id)?.active === 0;
  return <div className="iv-split">
    <div className="iv-side">
      <button type="button" className="sf-btn" onClick={() => setSel('new')}>+ 새 품목</button>
      <ul className="iv-ilist">{state.items.map(it => <li key={it.id}><button type="button" aria-pressed={sel === it.id} onClick={() => setSel(it.id)}><b>{it.name}</b><small>{it.vendor_name || '—'}{stopped(it) ? ' · 거래 중단' : ''} · 옵션 {it.options.length}개{it.price == null && !it.prepaid ? ' · 단가 미확인' : ''}</small></button></li>)}</ul>
    </div>
    <div className="iv-main">{sel == null ? <p className="sf-hint">왼쪽에서 품목을 고르세요.</p>
      : <ItemForm key={`${sel}-${item ? 1 : 0}`} item={item} state={state} notify={notify} onSaved={id => { if (id && sel === 'new') setSel(id); onChange(); announceInventory(); }} onDeleted={() => { setSel(null); onChange(); announceInventory(); }} />}</div>
  </div>;
}

// 업체 칸(2026-11-12 사용자: 업체 탭 없이 품목 화면에서 — 거래처에서 '+ 새 업체'를 고르면 펼쳐지고 저장 한 번에 둘 다, 있는 업체는 '업체 정보')
type VendorF = { name: string; company: string; payment_method: string; pay_timing: string; bank: string; account: string; holder: string };
const vendorF = (v?: InvVendor | null): VendorF => ({ name: v?.name || '', company: v?.company || '', payment_method: v?.payment_method || '', pay_timing: v?.pay_timing || '', bank: v?.bank || '', account: v?.account || '', holder: v?.holder || '' });
const autoOrder = (m: string) => /카드|홈페이지/.test(m);
function VendorFields({ f, setF, title }: { f: VendorF; setF: (u: (x: VendorF) => VendorF) => void; title: string }) {
  const set = (k: keyof VendorF) => (e: React.ChangeEvent<HTMLInputElement>) => { const v = e.target.value; setF(x => ({ ...x, [k]: v })); };
  // 결제 방법은 여러 개 고를 수 있음(예: 알라딘 필링 카드결제·계좌입금)
  const picked = PAY_METHODS.filter(m => f.payment_method.split('·').map(x => x.trim()).includes(m));
  const toggle = (m: string) => setF(x => { const cur = PAY_METHODS.filter(k => x.payment_method.split('·').map(y => y.trim()).includes(k)); const next = cur.includes(m as typeof cur[number]) ? cur.filter(k => k !== m) : [...cur, m]; const pm = PAY_METHODS.filter(k => (next as string[]).includes(k)).join('·'); return { ...x, payment_method: pm, pay_timing: autoOrder(pm) ? 'order' : x.pay_timing }; });
  return <div className="iv-vbox"><h4>{title}</h4>
    <div className="iv-fgrid">
      <label className="sf-input"><span>업체명</span><input value={f.name} onChange={set('name')} placeholder="예: 상떼화장품" /></label>
      <label className="sf-input"><span>회사명</span><input value={f.company} onChange={set('company')} placeholder="예: (주)에스메디글로벌" /></label>
    </div>
    <div className="iv-pickrow"><span>결제 방법 <i className="iv-req">*</i></span><div className="sf-pills" role="group" aria-label="결제 방법">{PAY_METHODS.map(m => <button key={m} type="button" role="checkbox" aria-checked={picked.includes(m)} onClick={() => toggle(m)}>{m}</button>)}</div></div>
    <div className="iv-pickrow"><span>결제 시점 <i className="iv-req">*</i></span><div className="sf-pills" role="radiogroup" aria-label="결제 시점">{(['order', 'month'] as const).map(t => <button key={t} type="button" role="radio" disabled={autoOrder(f.payment_method) && t === 'month'} aria-checked={(autoOrder(f.payment_method) ? 'order' : f.pay_timing) === t} onClick={() => setF(x => ({ ...x, pay_timing: t }))}>{TIMING_LABEL[t]}</button>)}</div></div>
    {picked.includes('계좌입금') && <div className="iv-fgrid">
      <label className="sf-input"><span>은행</span><input value={f.bank} onChange={set('bank')} placeholder="은행 이름" /></label>
      <label className="sf-input"><span>계좌번호</span><input value={f.account} onChange={set('account')} inputMode="numeric" placeholder="000-00-000000" /></label>
      <label className="sf-input"><span>예금주</span><input value={f.holder} onChange={set('holder')} placeholder="예금주" /></label>
    </div>}
  </div>;
}
const vendorReady = (f: VendorF) => !!f.name.trim() && PAY_METHODS.some(m => f.payment_method.includes(m)) && (autoOrder(f.payment_method) || f.pay_timing === 'order' || f.pay_timing === 'month');
const vendorBody = (f: VendorF) => ({ ...f, pay_timing: autoOrder(f.payment_method) ? 'order' : f.pay_timing || null, ...(f.payment_method.includes('계좌') ? {} : { bank: '', account: '', holder: '' }) });

const unitOpts = (cur: string) => (cur && !UNITS.includes(cur) ? [cur, ...UNITS] : UNITS);
export function ItemForm({ item, state, notify, onSaved, onDeleted }: { item: InvItem | null; state: InvState; notify: (m: string) => void; onSaved: (id?: number) => void; onDeleted: () => void }) {
  const hasPack = !!(item?.order_unit && item.pack_qty && (item.order_unit !== item.stock_unit || item.pack_qty !== 1));
  const [f, setF] = useState(() => ({
    name: item?.name || '', vendor_id: item?.vendor_id ? String(item.vendor_id) : '', category: item?.category || '',
    order_unit: item?.order_unit || item?.stock_unit || 'ea', stock_unit: item?.stock_unit || 'ea', pack: hasPack, pack_qty: hasPack ? String(item!.pack_qty) : '',
    price: item?.price == null ? '' : String(item.price), min_stock: item ? String(item.min_stock || 0) : '0',
    daily_mode: item?.daily_mode || '', prepaid: !!item?.prepaid, memo: item?.memo || '',
  }));
  const [nv, setNv] = useState<VendorF>(vendorF());
  const [busy, setBusy] = useState(false), [askDel, setAskDel] = useState(false), [vinfo, setVinfo] = useState(false);
  const vendor = state.vendors.find(v => String(v.id) === f.vendor_id) || null;
  const isNew = f.vendor_id === 'new';
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { const t = e.target as HTMLInputElement; const v = t.type === 'checkbox' ? t.checked : t.value; setF(x => ({ ...x, [k]: v })); };
  const su = f.pack ? f.stock_unit : f.order_unit; // 재고단위: 구성수량을 안 쓰면 주문단위 그대로
  const save = async () => {
    setBusy(true);
    try {
      const r = await invSend('POST', '/items', { id: item?.id, name: f.name, category: f.category, memo: f.memo, is_pack: item?.is_pack, prepaid: f.prepaid,
        vendor_id: isNew ? null : f.vendor_id || null, ...(isNew ? { new_vendor: vendorBody(nv) } : {}),
        order_unit: f.order_unit, stock_unit: su, pack_qty: f.pack ? Number(f.pack_qty) || null : 1,
        price: f.prepaid || f.price === '' ? (f.prepaid ? item?.price ?? null : null) : Number(f.price), min_stock: Number(f.min_stock) || 0, daily_mode: f.daily_mode || null }) as { vendor_id?: number; item_id?: number };
      notify(isNew ? '업체와 품목을 저장했어요.' : '품목을 저장했어요.');
      if (isNew && r?.vendor_id) { setF(x => ({ ...x, vendor_id: String(r.vendor_id) })); setNv(vendorF()); }
      onSaved(r?.item_id);
    } catch (e) { notify(errText(e)); } finally { setBusy(false); }
  };
  const ready = !!f.name.trim() && (!isNew || vendorReady(nv)) && (!f.pack || Number(f.pack_qty) > 0);
  const vendors = state.vendors.filter(v => v.active !== 0 || String(v.id) === f.vendor_id);
  return <div className="iv-form">
    <div className="iv-fgrid iv-two">
      <label className="sf-input iv-wide"><span>품목 이름</span><input value={f.name} onChange={set('name')} /></label>
      <label className="sf-input iv-wide"><span>거래처</span><select value={f.vendor_id} onChange={e => { setVinfo(false); set('vendor_id')(e); }}><option value="">—</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}{v.active === 0 ? ' (거래 중단)' : ''}</option>)}<option value="new">+ 새 업체</option></select></label>
    </div>
    {isNew && <VendorFields f={nv} setF={setNv} title="새 업체" />}
    {vendor && <VendorLine key={vendor.id} vendor={vendor} open={vinfo} setOpen={setVinfo} state={state} notify={notify} onSaved={() => onSaved()} />}
    <div className="iv-fgrid iv-two">
      <label className="sf-input iv-wide"><span>분류</span><input value={f.category} onChange={set('category')} placeholder="관리제품" /></label>
      <div className="sf-input"><span>주문단위 (살 때)</span><span className="iv-unitrow"><input value="1" disabled aria-label="주문단위 수량" /><select value={f.order_unit} onChange={set('order_unit')} aria-label="주문단위">{unitOpts(f.order_unit).map(x => <option key={x} value={x}>{x}</option>)}</select></span></div>
    </div>
    <label className="iv-check"><input type="checkbox" checked={f.pack} onChange={e => { const c = e.target.checked; setF(x => ({ ...x, pack: c, pack_qty: c ? x.pack_qty : '', stock_unit: c ? (x.stock_unit === x.order_unit ? 'ea' : x.stock_unit) : x.order_unit })); }} /> 구성수량 — 안에 든 낱개로 셀 때</label>
    {f.pack && <div className="iv-packrow"><span>1 {f.order_unit} =</span><input type="number" min={0} inputMode="decimal" value={f.pack_qty} onChange={set('pack_qty')} aria-label="구성수량" /><select value={f.stock_unit} onChange={set('stock_unit')} aria-label="재고단위">{unitOpts(f.stock_unit).map(x => <option key={x} value={x}>{x}</option>)}</select></div>}
    <div className="iv-fgrid iv-two">
      <label className={`sf-input${f.prepaid ? ' is-off' : ''}`}><span>주문단위 가격(원)</span><input type="number" min={0} value={f.prepaid ? '' : f.price} disabled={f.prepaid} placeholder={f.prepaid ? '선결제 옵션으로 대신' : ''} onChange={set('price')} /><small>1 {f.order_unit} 가격</small></label>
      <label className="sf-input"><span>위험 기준</span><input type="number" min={0} value={f.min_stock} onChange={set('min_stock')} /><small>{su} 기준</small></label>
    </div>
    <div className="iv-fgrid iv-two">
      <label className="sf-input"><span>일일 마감</span><select value={f.daily_mode} onChange={set('daily_mode')}><option value="">안 함</option><option value="usage">사용량 입력</option><option value="count">마감재고 입력</option></select></label>
      <label className="sf-input"><span>메모</span><input value={f.memo} onChange={set('memo')} /></label>
    </div>
    <label className="iv-check"><input type="checkbox" checked={f.prepaid} onChange={set('prepaid')} /> 선결제 품목</label>
    {item && !!item.prepaid === f.prepaid && <Options item={item} today={state.today} notify={notify} onSaved={() => onSaved()} />}
    {item && !!item.prepaid !== f.prepaid && <p className="sf-hint">저장하면 {f.prepaid ? '선결제 옵션' : '구매조건'}을 적을 수 있어요.</p>}
    <div className="sf-modal-foot">{item && (askDel ? <span className="iv-inline">이 품목을 목록에서 뺄까요? 기록은 남아요.
      <button type="button" className="sf-btn" onClick={() => setAskDel(false)}>취소</button><button type="button" className="sf-btn is-danger" onClick={async () => { try { await invSend('DELETE', `/items/${item.id}`); notify('품목을 뺐어요.'); onDeleted(); } catch (e) { notify(errText(e)); } }}>빼기</button></span>
      : <button type="button" className="sf-btn" onClick={() => setAskDel(true)}>품목 빼기</button>)}
      <button type="button" className="sf-btn is-primary" disabled={busy || !ready} onClick={() => void save()}>{busy && <SavingMark />}저장</button></div>
  </div>;
}

// 있는 업체: '결제 [방법] [시점]' 한 줄 + '업체 정보'(결제 방법·시점·계좌 수정, 거래 중단·재개 — 같은 업체 품목 모두에 적용)
function VendorLine({ vendor, open, setOpen, state, notify, onSaved }: { vendor: InvVendor; open: boolean; setOpen: (v: boolean) => void; state: InvState; notify: (m: string) => void; onSaved: () => void }) {
  const [f, setF] = useState<VendorF>(vendorF(vendor));
  const [busy, setBusy] = useState(false), [askStop, setAskStop] = useState(false);
  const t = timingOf(vendor);
  const kept = state.items.filter(i => i.vendor_id === vendor.id && i.vendor_stock > 0);
  const send = async (body: object, msg: string) => { setBusy(true); try { await invSend('POST', '/vendors', { id: vendor.id, ...body }); notify(msg); setAskStop(false); onSaved(); } catch (e) { notify(errText(e)); } finally { setBusy(false); } };
  return <>
    <div className="iv-vline"><span>결제</span>
      <span className="iv-ptag is-method">{vendor.payment_method || '결제 방법 —'}</span>
      <span className={`iv-ptag${t ? '' : ' is-none'}`}>{t ? TIMING_LABEL[t] : '결제 시점 미정'}</span>
      {vendor.active === 0 && <span className="iv-ptag is-stop">거래 중단</span>}
      <button type="button" className={`sf-btn iv-vbtn${open ? ' is-on' : ''}`} onClick={() => { setOpen(!open); setF(vendorF(vendor)); }}>업체 정보</button></div>
    {open && <div className="iv-vedit">
      <VendorFields f={f} setF={setF} title={`업체 정보 · ${vendor.name}`} />
      <div className="sf-modal-foot">
        {vendor.active === 0 ? <button type="button" className="sf-btn" disabled={busy} onClick={() => void send({ active: 1 }, '거래를 다시 시작했어요.')}>거래 재개</button>
          : askStop ? <span className="iv-inline">{kept.length ? `업체 보관 잔량이 남아 있어요(${kept.map(i => `${i.name} ${fmtQty(i.vendor_stock)} ${i.stock_unit}`).join(', ')}). ` : ''}거래를 중단할까요?
            <button type="button" className="sf-btn" onClick={() => setAskStop(false)}>아니요</button><button type="button" className="sf-btn is-danger" disabled={busy} onClick={() => void send({ active: 0 }, '거래를 중단했어요. 기록은 그대로예요.')}>거래 중단</button></span>
            : <button type="button" className="sf-btn" onClick={() => setAskStop(true)}>거래 중단</button>}
        <button type="button" className="sf-btn is-primary" disabled={busy || !vendorReady(f)} onClick={() => void send(vendorBody(f), '업체 정보를 저장했어요.')}>{busy && <SavingMark />}저장</button>
      </div></div>}
  </>;
}

// 옵션 = 칸 4개(2026-11-12 사용자): 수량 · 결제금액 · 증정(비우면 없음) · 기간(비우면 늘). 선결제 품목은 선결제 옵션, 일반 품목은 구매조건 — 같은 칸.
const COUNTER: Record<string, string> = { sheet: '장', box: '박스', ea: '개', set: '세트' };
export function Options({ item, today, notify, onSaved }: { item: InvItem; today: string; notify: (m: string) => void; onSaved: () => void }) {
  const packUnit = item.order_unit && item.pack_qty && item.order_unit !== item.stock_unit;
  const blank = { id: 0, count: '', unit: packUnit ? 'order' : 'stock', amount: '', bonus: '', start: '', end: '', open: false };
  const [f, setF] = useState(blank);
  const factor = f.unit === 'order' ? item.pack_qty || 1 : 1;
  const unitName = f.unit === 'order' ? item.order_unit! : item.stock_unit;
  const qty = (Number(f.count) || 0) * factor, bonus = (Number(f.bonus) || 0) * factor, amount = f.amount === '' ? null : Number(f.amount);
  const label = () => { const c = Number(f.count), b = Number(f.bonus) || 0; return b ? `${fmtQty(c)}+${fmtQty(b)}` : `${fmtQty(c)}${COUNTER[unitName] || unitName}`; };
  const pp = !!item.prepaid;
  const save = async () => {
    try {
      await invSend('POST', '/options', { id: f.id || undefined, item_id: item.id, label: label(), qty, bonus_qty: bonus, amount, prepaid: pp, unit_label: unitName, start_date: f.start || null, end_date: f.end || null });
      notify(pp ? '선결제 옵션을 저장했어요.' : '구매조건을 저장했어요.'); setF(blank); onSaved();
    } catch (e) { notify(errText(e)); }
  };
  const per = amount != null && qty + bonus > 0 ? Math.round(amount / (qty + bonus)) : null;
  const ST = { always: '늘', on: '진행 중', soon: '예정', ended: '끝남' } as const;
  return <section className={`iv-sec iv-opts${pp ? ' is-pp' : ''}`}><h3>{pp ? '선결제 옵션' : '구매조건'}</h3>
    {pp && <dl className="iv-d-stats iv-opt-stats"><div><dt>병원재고</dt><dd>{withUnit(item.hospital_stock, item.stock_unit)}</dd></div><div><dt>업체 보관 잔량</dt><dd>{withUnit(item.vendor_stock, item.stock_unit)}</dd></div><div><dt>위험 기준</dt><dd>{withUnit(item.min_stock, item.stock_unit)}</dd></div></dl>}
    <div className="iv-scroll"><table className="sf-table iv-opt-table"><thead><tr><th>옵션 · 기간</th><th className="num">수량</th><th className="num">결제금액</th><th aria-label="수정·삭제" /></tr></thead>
      <tbody>{item.options.map(o => { const st = optState(o, today); return <tr key={o.id} className={st === 'ended' ? 'is-ended' : ''}>
        <td><b>{o.label || '—'}</b>{st !== 'always' && <span className="iv-tag is-event">행사</span>}
          <small className="iv-period">{st === 'always' ? '늘' : <>{o.start_date ? md(o.start_date) : ''} ~ {o.end_date ? md(o.end_date) : ''} <b className={`is-${st}`}>{ST[st]}</b></>}</small></td><td className="num">{fmtQty(o.qty)}{o.bonus_qty ? ` + 증정 ${fmtQty(o.bonus_qty)}` : ''} {item.stock_unit}</td><td className="num">{fmtWon(o.amount)}</td>
        <td className="num iv-row-btns"><button type="button" className="iv-icon-btn" aria-label="수정" title="수정" onClick={() => setF({ id: o.id, count: String(o.qty), unit: 'stock', amount: o.amount == null ? '' : String(o.amount), bonus: o.bonus_qty ? String(o.bonus_qty) : '', start: o.start_date || '', end: o.end_date || '', open: true })}><Pencil size={16} strokeWidth={1.8} /></button>
          <button type="button" className="iv-icon-btn is-danger" aria-label="삭제" title="삭제" onClick={async () => { try { await invSend('DELETE', `/options/${o.id}`); notify('옵션을 지웠어요.'); onSaved(); } catch (e) { notify(errText(e)); } }}><Trash2 size={16} strokeWidth={1.8} /></button></td></tr>; })}
        {!item.options.length && <tr><td colSpan={4}><small>기록 없음</small></td></tr>}</tbody></table></div>
    {!f.open ? <button type="button" className="iv-addopt" onClick={() => setF({ ...blank, open: true })}>+ {pp ? '선결제 옵션' : '구매조건'} 추가</button>
      : <div className="iv-optbox">
        <div className="iv-fgrid">
          <label className="sf-input"><span>수량</span><span className="iv-pair"><input type="number" min={0} inputMode="decimal" value={f.count} onChange={e => setF(x => ({ ...x, count: e.target.value }))} />
            {packUnit ? <select value={f.unit} onChange={e => setF(x => ({ ...x, unit: e.target.value }))}><option value="stock">{item.stock_unit}</option><option value="order">{item.order_unit}({fmtQty(item.pack_qty)}{item.stock_unit})</option></select> : <em>{item.stock_unit}</em>}</span></label>
          <label className="sf-input"><span>결제금액</span><span className="iv-pair"><input type="number" min={0} inputMode="numeric" value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value }))} /><em>원</em></span></label>
          <label className="sf-input"><span>증정 <small className="iv-opt-hint">비우면 없음</small></span><span className="iv-pair"><input type="number" min={0} inputMode="decimal" value={f.bonus} placeholder="—" onChange={e => setF(x => ({ ...x, bonus: e.target.value }))} /><em>{unitName}</em></span></label>
          <div className="sf-input iv-span2"><span>기간 <small className="iv-opt-hint">비우면 늘</small></span><span className="iv-dates"><input type="date" value={f.start} onChange={e => setF(x => ({ ...x, start: e.target.value }))} aria-label="시작" /><i>~</i><input type="date" value={f.end} onChange={e => setF(x => ({ ...x, end: e.target.value }))} aria-label="끝" /></span></div>
        </div>
        {qty > 0 && <div className="iv-calc">{pp ? <><span>업체 보관 잔량 <b>+{fmtQty(qty + bonus)} {item.stock_unit}</b></span>{per != null && <span>{item.stock_unit === 'sheet' ? '장당' : `1 ${item.stock_unit}당`} <b>{per.toLocaleString('ko-KR')}원</b></span>}</>
          : <><span>받는 수량 <b>{fmtQty(qty + bonus)} {item.stock_unit}</b></span>{per != null && <span>{bonus ? '증정 포함 ' : ''}1 {item.stock_unit}당 <b>{per.toLocaleString('ko-KR')}원</b></span>}</>}</div>}
        <div className="sf-modal-foot"><button type="button" className="sf-btn" onClick={() => setF(blank)}>취소</button><button type="button" className="sf-btn is-primary" disabled={!(qty > 0) || amount == null || (!!f.start && !!f.end && f.start > f.end)} onClick={() => void save()}>저장</button></div>
      </div>}
  </section>;
}

/* ───────────── 재고입출고 ───────────── */

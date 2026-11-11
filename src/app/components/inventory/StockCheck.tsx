import { useCallback, useEffect, useState } from 'react';
import { LoadingBox, SavingMark } from '../Feedback';
import { type InvItem, type InvState, announceInventory, fmtQty, invGet, invSend, unitHint, useInventory, subscribeInventory, finishOldFix } from '../../inventoryApi';
import { FlagTag, Modal, Problem, Seg, Shell, errText, flagOf, useToast, withUnit } from './shared';
import { OldDataImport } from './OldData';

export function StockCheck() {
  const { state, error, reload } = useInventory();
  const [toast, setToast] = useToast();
  const [tab, setTab] = useState<'daily' | 'all'>('daily');
  if (error) return <Problem error={error} />;
  if (!state) return <LoadingBox />;
  const prepaid = state.items.filter(it => it.prepaid || it.vendor_stock > 0); // 업체 보관 잔량이 있는 품목(선결제 + 일반 품목 업체 보관)
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

export function AllStock({ state, notify }: { state: InvState; notify: (m: string) => void }) {
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
        <td className="num">{it.prepaid || it.vendor_stock > 0 ? withUnit(it.vendor_stock, it.stock_unit) : <small>—</small>}</td>
        <td className="num"><small>{it.min_stock ? withUnit(it.min_stock, it.stock_unit) : '—'}</small></td>
        <td className="num"><button type="button" className="sf-btn" onClick={() => setAdj(it)}>맞추기</button></td></tr>; })}</tbody>
    </table>
    {adj && <AdjustDialog item={adj} today={state.today} onClose={() => setAdj(null)} onDone={m => { notify(m); setAdj(null); announceInventory(); }} />}
  </>;
}

export function AdjustDialog({ item, today, onClose, onDone }: { item: InvItem; today: string; onClose: () => void; onDone: (m: string) => void }) {
  const [h, setH] = useState(String(item.hospital_stock)), [v, setV] = useState(String(item.vendor_stock)), [memo, setMemo] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <Modal title={`${item.name} 재고 맞추기`} onClose={onClose}>
    <label className="sf-input"><span>병원재고 ({item.stock_unit}) · 지금 {fmtQty(item.hospital_stock)}</span><input type="number" min={0} inputMode="decimal" value={h} onChange={e => setH(e.target.value)} /></label>
    {item.prepaid || item.vendor_stock > 0 ? <label className="sf-input"><span>업체 보관 잔량 ({item.stock_unit}) · 지금 {fmtQty(item.vendor_stock)}</span><input type="number" min={0} inputMode="decimal" value={v} onChange={e => setV(e.target.value)} /></label> : null}
    <label className="sf-input"><span>메모</span><input value={memo} onChange={e => setMemo(e.target.value)} placeholder="예: 11월 실사" /></label>
    {error && <p className="sf-hint is-warn">{error}</p>}
    <div className="sf-modal-foot"><button type="button" className="sf-btn" onClick={onClose}>닫기</button>
      <button type="button" className="sf-btn is-primary" disabled={busy} onClick={async () => { setBusy(true); try { await invSend('POST', '/adjust', { item_id: item.id, hospital_stock: h === '' ? null : Number(h), vendor_stock: (item.prepaid || item.vendor_stock > 0) && v !== '' ? Number(v) : null, memo, date: today }); onDone('재고를 맞췄어요.'); } catch (e) { setError(errText(e)); setBusy(false); } }}>{busy && <SavingMark />}맞추기</button></div>
  </Modal>;
}

export type DailyItem = { id: number; name: string; stock_unit: string; hospital_stock: number; stock_at: number; daily_mode: 'usage' | 'count'; vendor_name?: string | null; used: number | null; open_fix?: number | null; used15: number };
// 일일재고(2026-11-08 사용자 지정): 언제든 기록·수정. 팀장이 출근한 날은 품목 방식대로(당일 사용량 또는 마감재고),
// 팀장이 출근하지 않은 날(미입력·휴무·연차·상담·휴일)은 당일 사용량·모델링 사용 인원은 닫고 모든 품목 마감재고만 적는다.
// 총 피부관리 인원·메모는 늘 열림. 못 센 날 생긴 차이는 따로 표시하지 않는다.
// 2026-11-09 사용자: 휴무·연차·상담 날은 건너뛰고, 다음 근무일에 센 마감재고를 적으면 병원재고가 그 수량이 된다(장부보다 많아도).
// 비운 칸은 그 품목을 건드리지 않는다. 팩 종류(사용량 품목)도 기본은 마감 전 재고 + 마감재고, '사용량'을 누르면 사용량으로.
export type DailyRecord = { state: 'done' | 'missing' | 'skip' | null; first_at: number | null; first_by: string | null; last_at: number | null; last_by: string | null;
  log: { at: number; by: string | null; patients: number | null; memo: string | null; items?: Record<string, { used: number; before: number; left?: number; unit: string }> }[] };
export const RECORD_LABEL = { done: '작성완료', missing: '미작성', skip: '작성제외' } as const;
export const fmtStamp = (ms: number) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export function DailyClose({ today, notify, onSaved }: { items: InvItem[]; today: string; notify: (m: string) => void; onSaved: () => void }) {
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
  useEffect(() => { setData(null); load().catch(e => notify(errText(e))); void finishOldFix(); }, [load, notify]);
  useEffect(() => subscribeInventory(() => { void load().catch(() => undefined); }), [load]);
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

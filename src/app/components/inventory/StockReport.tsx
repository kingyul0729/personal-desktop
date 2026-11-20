import { useEffect, useState } from 'react';
import { LoadingBox } from '../Feedback';
import { readWon } from '../../koreanAmount';
import { fmtQty, invGet, shiftMonth, subscribeInventory, todayLocal } from '../../inventoryApi';
import { InvThumb, Seg, errText } from './shared';
import { invoiceSrc } from '../../inventoryApi';
import { staffGet } from '../../staffApi';
import { BookSummary, bookHasAny, type BookSum } from '../StaffBook';

export type MonthRep = { month: string; spend_total: number; spend_general: number; spend_prepaid: number; in_count: number; no_invoice: number; no_amount: number; patients: number; open_days: number;
  usage: { id: number; name: string; stock_unit: string; used: number; per_day: number | null }[];
  inbound?: { date: string; kind: string; qty: number; bonus_qty: number; amount: number | null; invoice: number; memo: string | null; item_name: string; stock_unit: string; vendor_name: string | null; payment_method: string | null; cancelled_at?: number | null; cancel_reason?: string | null }[];
  prepaid?: { id: number; name: string; stock_unit: string; vendor_stock: number; hospital_stock: number }[];
  stock?: { id: number; name: string; stock_unit: string; hospital_stock: number; min_stock: number }[]; as_of?: string | null;
  payments?: Pay[]; pay_done?: number; pay_due?: number;
  spend_buy?: number; bal_used?: number };
// 5번 결제 내역에서 업체 잔액으로 낸 금액만 표기(2026-11-19 사용자 '따로 블록 없이 결제됐다는 것만')
export type Pay = { bal_used?: number; bal_reason?: string | null; refunds?: { date: string; amount: number }[]; vendor_id: number; name: string; company: string | null; payment_method: string | null; timing?: 'order' | 'month' | null; when: string; amount: number; pay_dates?: string[]; in_dates?: string[]; in_items?: number; status?: string; lines?: { date: string; item: string; qty: number; unit: string; note: string | null; invoice?: 'done' | 'missing' | 'none'; invoice_ids?: string | null }[]; holder?: string | null; bank?: string | null; account?: string | null };
const mdd = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
// 결제 내역(2026-11-12 사용자 시안 5, 원장님 보고용): 그 달에 거래한 업체만(결제했거나 병원으로 물건이 들어온 곳 — 0원·업체 보관에서 입고·선결제 포함),
// 칸 = 번호 · 업체 · 입고일 · 품목 · 수량 · 결제 방법·상태 · 결제금액. 칸 색칠 없이 금액(굵게)·상태(작은 태그)만 강조, 결제 예정은 연핑크.
// 계좌입금 = 그 달에 계좌로 보낼 업체 줄(연핑크), 결제 요약 = 결제 완료 · 결제 예정 · 합계.
const traded = (list: Pay[]) => list.filter(p => p.amount > 0 || (p.lines?.length ?? 0) > 0 || (p.refunds?.length ?? 0) > 0);
const refundSum = (p: Pay) => (p.refunds || []).reduce((t, r) => t + r.amount, 0);
function PayStatus({ p }: { p: Pay }) {
  // 2026-11-20 사용자: 계좌입금·방문결제는 '· 결제 시 배송/월말 결제'를 붙이고, 업체 잔액으로 낸 것도 결제는 끝났으니 '결제 완료'
  const st = p.status === '잔액 차감' ? '결제 완료' : p.status;
  const how = p.payment_method && !/카드|온라인|홈페이지/.test(p.payment_method) && p.timing ? ` · ${p.timing === 'order' ? '결제 시 배송' : '월말 결제'}` : '';
  return <>{p.payment_method ? `${p.payment_method}${how}` : '—'}<br />{st === '결제 완료' || st === '결제 예정' ? <span className={`iv-pstate ${st === '결제 완료' ? 'is-done' : 'is-due'}`}>{st}</span> : <small className="iv-muted">{st || '—'}</small>}</>;
}
// 업체 잔액으로 낸 결제(2026-11-20 사용자 '결제했는데 이중결제해서 이만큼 빠졌다고 꼭 표시'): 구매 금액 → 중복 결제 잔액 차감 → 실제 결제금액
const balLabel = (p: Pay) => `${p.bal_reason ? `${p.bal_reason.split(',')[0]} ` : '업체 '}잔액 차감`;
function BalCalc({ p }: { p: Pay }) {
  return <span className="iv-balcalc"><small>구매 금액 {won(p.amount + (p.bal_used || 0))}</small><small>{balLabel(p)} −{won(p.bal_used || 0)}</small><b className="iv-pamt">{won(p.amount)}</b></span>;
}
function PayTable({ list }: { list: Pay[] }) {
  const [big, setBig] = useState<string[] | null>(null);
  if (!list.length) return <p className="sf-hint">기록 없음</p>;
  const Inv = ({ l }: { l: NonNullable<Pay['lines']>[number] }) => l.invoice_ids ? <button type="button" className="iv-pinv is-done" onClick={() => setBig(String(l.invoice_ids).split(','))}>등록</button>
    : l.invoice === 'done' ? <span className="iv-pinv is-done">등록</span> : l.invoice === 'missing' ? <span className="iv-pinv is-missing">미등록</span> : <span className="iv-muted">—</span>;
  return <div className="iv-scroll"><table className="iv-form-tbl"><thead><tr><th className="c w-no">번호</th><th>업체</th><th className="c">입고일</th><th>품목</th><th className="num">수량</th><th className="c">명세서</th><th className="c">결제 방법 · 상태</th><th className="num">결제금액</th></tr></thead>
    <tbody>{list.map((p, i) => { const lines = p.lines?.length ? p.lines : (p.refunds?.length ? [] : [null]); const rf = p.refunds || []; const n = lines.length + rf.length;
      const head = (j: number) => j === 0 && <><td className="c" rowSpan={n}>{i + 1}</td><td rowSpan={n}>{p.name}</td></>;
      const tail = (j: number) => j === 0 && <><td className="c" rowSpan={n}><PayStatus p={p} /></td><td className="num" rowSpan={n}>{p.bal_used ? <BalCalc p={p} /> : p.amount ? <b className="iv-pamt">{won(p.amount)}</b> : '0원'}{rf.length ? <small className="iv-pay-co">환급 입금 {won(refundSum(p))}</small> : null}</td></>;
      return [...lines.map((l, j) => <tr key={`${p.vendor_id}-${j}`}>
        {head(j)}
        <td className="c">{l ? mdd(l.date) : '—'}</td>
        <td>{l ? <>{l.item}{l.note && <small className="iv-pay-co">{l.note}</small>}</> : '—'}</td>
        <td className="num">{l ? `${fmtQty(l.qty)} ${l.unit}` : '—'}</td>
        <td className="c">{l ? <Inv l={l} /> : '—'}</td>
        {tail(j)}
      </tr>), ...rf.map((r, k) => { const j = lines.length + k; return <tr key={`${p.vendor_id}-r${k}`}>
        {head(j)}<td className="c">{mdd(r.date)}</td><td>업체 잔액 환급 입금<small className="iv-pay-co">{won(r.amount)}</small></td><td className="num">—</td><td className="c">—</td>{tail(j)}
      </tr>; })]; })}
      <tr className="is-total"><th colSpan={7}>합 계</th><td className="num"><b>{won(list.reduce((x, p) => x + p.amount, 0))}</b></td></tr></tbody></table>
    {big && <div className="iv-inv-big" role="dialog" aria-label="거래명세서" onClick={() => setBig(null)}>{big.map(id => <InvThumb key={id} id={id} />)}<a href={invoiceSrc(big[0])} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>원본 열기</a></div>}</div>;
}
function BankTable({ list }: { list: Pay[] }) {
  // 2026-11-20 사용자: 계좌입금 표는 월말 결제(원장님이 입금할 것)만 — 결제 시 배송은 이미 결제했으니 안 보임
  const rows = bankRows(list);
  if (!rows.length) return null;
  return <><h4 className="iv-paysub">계좌입금</h4><div className="iv-scroll"><table className="iv-form-tbl"><thead><tr><th>업체</th><th className="c">예금주</th><th className="c">은행</th><th className="c">계좌번호</th><th className="num">결제금액</th></tr></thead>
    <tbody>{rows.map(p => <tr key={p.vendor_id} className="is-bank"><td>{p.name}</td><td className="c">{p.holder || '—'}</td><td className="c">{p.bank || '—'}</td><td className="c">{p.account || '—'}</td><td className="num"><b>{won(p.amount)}</b></td></tr>)}</tbody></table></div></>;
}
const bankRows = (list: Pay[]) => list.filter(p => p.amount > 0 && p.timing === 'month' && /계좌/.test(p.payment_method || ''));


export function StockReport() {
  const [tab, setTab] = useState<'month' | 'year'>('month');
  const [month, setMonth] = useState(() => shiftMonth(todayLocal().slice(0, 7), -1));
  const [cmp, setCmp] = useState(() => shiftMonth(todayLocal().slice(0, 7), -2));
  const [year, setYear] = useState(() => todayLocal().slice(0, 4));
  const [rep, setRep] = useState<{ a: MonthRep; b: MonthRep } | null>(null);
  const [yr, setYr] = useState<MonthRep[] | null>(null);
  const [team, setTeam] = useState<YearStaff[] | null>(null);
  const [monthTeam, setMonthTeam] = useState<MonthStaff[]>([]); // 월말 직원 근무·연차(성과표와 같은 숫자)
  const [book, setBook] = useState<BookSum | null>(null); // 예약표 집계(보고 월 또는 연도)
  const [error, setError] = useState('');
  // 다른 화면에서 주문 취소·입고·잔액 기록을 바꾸면 보고서도 다시 받는다(2026-11-20 사용자 '취소 눌렀는데' — 열어 둔 보고서가 예전 숫자로 남던 것)
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeInventory(() => setTick(t => t + 1)), []);
  useEffect(() => {
    if (tab !== 'month') return; if (!tick) setRep(null);
    Promise.all([invGet('/report', { month }), invGet('/report', { month: cmp })]).then(([a, b]) => setRep({ a, b }), e => setError(errText(e)));
    setBook(null); staffGet('/book/summary', { period: month }).then(r => setBook(r.kinds), () => setBook(null));
    staffGet('/performance', { month, include_retired: 0 }).then(r => setMonthTeam(Array.isArray(r) ? r : []), () => setMonthTeam([]));
  }, [tab, month, cmp, tick]);
  // 연말 보고(2026-11-12 사용자 '물품별 개수는 빼고 재고·직원관리 내용'): 달마다 월말 보고 자료를 받아 한 해로 모으고, 직원 자료(연차·성과)를 함께 받는다.
  useEffect(() => {
    if (tab !== 'year' || !/^\d{4}$/.test(year)) return; if (!tick) { setYr(null); setTeam(null); }
    const ms = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    Promise.all(ms.map(m => invGet('/report', { month: m }))).then(setYr, e => setError(errText(e)));
    setBook(null); staffGet('/book/summary', { period: year }).then(r => setBook(r.kinds), () => setBook(null));
    Promise.all([staffGet('/list'), ...ms.map(m => staffGet('/performance', { month: m, include_retired: 0 }))])
      .then(([list, ...perf]) => setTeam(yearStaff(list, perf)), () => setTeam([]));
  }, [tab, year, tick]);
  return <div className="sf-wrap iv-wrap iv-report">
    <div className="sf-bar iv-noprint"><Seg label="보고서" value={tab} onChange={setTab} options={[['month', '월말 보고'], ['year', '연말 보고']]} />
      <div className="iv-inline">{tab === 'month' ? <>
        <label className="sf-input"><span>보고 월</span><input type="month" value={month} onChange={e => { const v = e.target.value; if (!v) return; setMonth(v); setCmp(shiftMonth(v, -1)); }} /></label>
        <label className="sf-input"><span>비교 월</span><input type="month" value={cmp} onChange={e => e.target.value && setCmp(e.target.value)} /></label></>
        : <label className="sf-input"><span>연도</span><input type="number" value={year} onChange={e => setYear(e.target.value)} /></label>}
        <button type="button" className="sf-btn is-primary" onClick={() => window.print()}>PDF로 저장·인쇄</button></div></div>
    {error && <p className="sf-hint is-warn">{error}</p>}
    {tab === 'month' ? (rep ? <MonthReport a={rep.a} b={rep.b} book={book} team={monthTeam} /> : <LoadingBox />) : (yr ? <YearReport year={year} months={yr} team={team || []} book={book} /> : <LoadingBox />)}
  </div>;
}

export const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`;
export const diff = (a: number, b: number, f: (v: number) => string) => { const d = a - b; return d === 0 ? '0' : `${d > 0 ? '+' : '−'}${f(Math.abs(d))}`; };
// 월말·연말 보고: 번호 붙은 흰 카드 섹션(2026-11-08 사용자 지정 '10월 피부팀 월 정리' 형식)
export function Block({ n, title, sub, children }: { n: number; title: string; sub?: string; children: React.ReactNode }) {
  return <section className="iv-block"><h3 className="iv-num"><i>{n}</i>{title}{sub && <small>{sub}</small>}</h3>{children}</section>;
}
// 월말 직원 근무·연차(2026-11-20 사용자 '월말에 직원성과가 안 보임'): 직원 관리 › 성과 탭의 월 성과표 숫자 그대로, 합계 줄 없음.
export type MonthStaff = { id: number; name: string; status?: string; work_days?: number | null; total_hours?: number | null; total_managed?: number | null; avg_managed?: number | null; total_designated?: number | null; leave_used?: number | null; remain_leave?: number | null };
// 월말·연말 2026-11-20 사용자 '가로로 길게 말고 네모칸을 좌우 두 개로': 작은 표 둘은 좌우 두 칸(`iv-duo`), 칸 많은 표만 가로 전체.
export function MonthReport({ a, b, book, team = [] }: { a: MonthRep; b: MonthRep; book?: BookSum | null; team?: MonthStaff[] }) {
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
    <div className={bookHasAny(book) ? 'iv-duo' : 'iv-solo'}>
      <Block n={++n} title="재고 확인" sub="하루 평균 사용량">
      {!names.length ? <p className="sf-hint">기록 없음</p> : <table className="sf-table"><thead><tr><th>품목</th><th className="num">{mm(b.month)}</th><th className="num">{mm(a.month)}</th></tr></thead>
        <tbody>{names.map(nm => { const x = a.usage.find(u => u.name === nm), y = b.usage.find(u => u.name === nm); const unit = (x || y)!.stock_unit; return <tr key={nm}><td>{nm} <small>{unit}/일</small></td>
          <td className="num">{y?.per_day ?? <small>기록 없음</small>}</td><td className="num">{x?.per_day != null ? <b>{x.per_day}</b> : <small>기록 없음</small>}</td></tr>; })}</tbody></table>}
    </Block>
      {bookHasAny(book) && <Block n={++n} title="예약표 집계"><BookSummary sum={book!} /></Block>}
    </div>
    {(() => { const rows = team.filter(x => !x.status || x.status === 'active'); const dash = (v: number | null | undefined, f: (v: number) => string) => (v ? f(v) : '—');
      return <Block n={++n} title="직원 근무·연차" sub={`${mm(a.month)} · 잔여연차는 오늘 기준`}>
        {!rows.length ? <p className="sf-hint">기록 없음</p> : <div className="iv-scroll"><table className="sf-table iv-year"><thead><tr><th>직원</th><th className="num">근무일수</th><th className="num">실근무시간</th><th className="num">관리 수</th><th className="num">시간당 관리 수</th><th className="num">지정 환자 수</th><th className="num">이달 사용연차</th><th className="num">잔여연차</th></tr></thead>
          <tbody>{rows.map(x => <tr key={x.id}><td><b>{x.name}</b></td><td className="num">{dash(x.work_days, v => `${v}일`)}</td><td className="num">{dash(x.total_hours, v => `${v}시간`)}</td><td className="num">{dash(x.total_managed, v => `${v}명`)}</td><td className="num">{dash(x.avg_managed, v => `${v}명`)}</td><td className="num">{dash(x.total_designated, v => `${v}명`)}</td><td className="num">{dash(x.leave_used, v => `${v}일`)}</td><td className="num"><b>{x.remain_leave != null ? `${x.remain_leave}일` : '—'}</b></td></tr>)}</tbody></table></div>}
      </Block>; })()}
    {a.payments && (() => { const list = traded(a.payments); return <Block n={++n} title="입고·결제 내역">
      <PayTable list={list} />
      <BankTable list={list} />
      <h4 className="iv-paysub">결제 요약</h4>
      {(() => { const bal = list.reduce((x, p) => x + (p.bal_used || 0), 0), why = list.find(p => p.bal_used)?.bal_used ? balLabel(list.find(p => p.bal_used)!) : '';
        return <div className="iv-scroll"><table className="iv-form-tbl"><thead><tr><th className="c">결제 완료</th><th className="c">결제 예정</th>{bal > 0 && <th className="c">{why}</th>}<th className="c">합 계</th></tr></thead>
          <tbody><tr><td className="num is-done">{won(a.pay_done || 0)}</td><td className="num is-due">{won(a.pay_due || 0)}</td>{bal > 0 && <td className="num">{won(bal)}</td>}<td className="num"><b>{won(list.reduce((x, p) => x + p.amount, 0))}</b></td></tr></tbody></table></div>; })()}
    </Block>; })()}
    <p className="iv-foot">출력 {new Date().toLocaleString('ko-KR')}</p>
  </article>;
}

// 직원별 한 해 합계(2026-11-12 사용자 '연말 보고니까 연말에 맞게'): 근무·관리 실적·연차 사용·상담·토요 휴무·조퇴·무급을 달마다의 성과에서 더한다.
// 2026-11-12 사용자: 상담(팀장만 해당)·조퇴·무급·사용연차 칸은 두지 않고 잔여연차(지금 값)를 보여 준다.
export type YearStaff = { id: number; name: string; remain_leave: number | null; work_days: number; hours: number; managed: number; designated: number; leave_used: number; consult: number; sat_off: number; early_leave: number; unpaid: number };
type StaffRow = { id: number; name: string; status?: string; remain_leave?: number | null };
type PerfKey = 'total_hours' | 'total_managed' | 'total_designated' | 'work_days' | 'leave_used' | 'consult_count' | 'sat_off_count' | 'early_leave_count' | 'unpaid_count';
type PerfMonth = ({ id: number } & Partial<Record<PerfKey, number | null>>)[];
export function yearStaff(list: StaffRow[], perf: PerfMonth[]): YearStaff[] {
  return list.filter(x => !x.status || x.status === 'active').map(x => {
    const rows = perf.map(month => month.find(r => r.id === x.id)).filter(Boolean) as PerfMonth[number][];
    const add = (k: PerfKey) => Math.round(rows.reduce((t, r) => t + (r[k] || 0), 0) * 10) / 10;
    return { id: x.id, name: x.name, remain_leave: x.remain_leave ?? null, work_days: add('work_days'), hours: add('total_hours'), managed: add('total_managed'), designated: add('total_designated'),
      leave_used: add('leave_used'), consult: add('consult_count'), sat_off: add('sat_off_count'), early_leave: add('early_leave_count'), unpaid: add('unpaid_count') };
  });
}

// 연말 보고(2026-11-12 사용자): 물품별 개수 칸 없이 ① 연간 확인 내용 ② 월별 합계 ③ 업체별 결제 ④ 업체 보관 잔량 ⑤ 직원 근무·연차.
export function YearReport({ year, months, team = [], book }: { year: string; months: MonthRep[]; team?: YearStaff[]; book?: BookSum | null }) {
  const sum = (k: 'spend_total' | 'spend_general' | 'spend_prepaid' | 'patients' | 'in_count') => months.reduce((s, m) => s + (m[k] || 0), 0);
  const dash = (v: number, f: (v: number) => string = String) => (v ? f(v) : '—');
  const tiles: [string, string, boolean][] = [
    ['연간 지출 합계', won(sum('spend_total')), true], ['일반 구매', won(sum('spend_general')), false], ['선결제 신규 구매', won(sum('spend_prepaid')), false],
    ['총 피부관리 인원', `${sum('patients')}명`, false], ['입고 건수', `${sum('in_count')}건`, false],
  ];
  // 업체별 결제: 달마다의 입고·결제 내역을 업체로 모은다
  const vendors = new Map<string, { name: string; method: string | null; months: Set<string>; amount: number; done: number; due: number; refund: number; bal: number; why: string }>();
  for (const m of months) for (const p of traded(m.payments || [])) {
    const v = vendors.get(p.name) || { name: p.name, method: p.payment_method, months: new Set<string>(), amount: 0, done: 0, due: 0, refund: 0, bal: 0, why: '' };
    v.refund += refundSum(p); v.bal += p.bal_used || 0; if (p.bal_used) v.why = balLabel(p); if (p.amount > 0 || (p.lines?.length ?? 0) > 0) v.months.add(m.month); v.amount += p.amount; if (p.status === '결제 예정') v.due += p.amount; else v.done += p.amount;
    vendors.set(p.name, v);
  }
  const vendorList = [...vendors.values()].sort((a, b) => b.amount - a.amount);
  const tsum = (k: 'work_days' | 'hours' | 'managed' | 'designated' | 'leave_used' | 'consult' | 'sat_off' | 'early_leave' | 'unpaid') => Math.round(team.reduce((t, x) => t + x[k], 0) * 10) / 10;
  let n = 0;
  return <article className="iv-paper">
    <h2>{year}년 피부팀 연말 보고</h2>
    <div className={bookHasAny(book) ? 'iv-duo' : 'iv-solo'}>
    <Block n={++n} title={`${year}년 확인 내용`}>
      <dl className="iv-tiles">{tiles.map(([label, value, main]) => <div key={label} className={main ? 'is-main' : ''}>
        <dt>{label}</dt><dd><b>{value}</b>{main && sum('spend_total') >= 10000 && <small className="iv-read">{readWon(sum('spend_total'))}</small>}</dd></div>)}</dl>
    </Block>
    {bookHasAny(book) && <Block n={++n} title="예약표 집계"><BookSummary sum={book!} /></Block>}
    </div>
    <Block n={++n} title="월별 합계"><div className="iv-scroll"><table className="sf-table iv-year"><thead><tr><th>월</th><th className="num">지출 합계</th><th className="num">일반 구매</th><th className="num">선결제 신규 구매</th><th className="num">총 피부관리 인원</th><th className="num">입고 건수</th></tr></thead>
      <tbody>{months.map(m => <tr key={m.month}><td>{Number(m.month.slice(5))}월</td><td className="num">{dash(m.spend_total, won)}</td><td className="num">{dash(m.spend_general, won)}</td><td className="num">{dash(m.spend_prepaid, won)}</td>
        <td className="num">{dash(m.patients, v => `${v}명`)}</td><td className="num">{dash(m.in_count, v => `${v}건`)}</td></tr>)}
        <tr className="iv-total-row"><td>합계</td><td className="num">{won(sum('spend_total'))}</td><td className="num">{won(sum('spend_general'))}</td><td className="num">{won(sum('spend_prepaid'))}</td><td className="num">{sum('patients')}명</td><td className="num">{sum('in_count')}건</td></tr></tbody></table></div></Block>
    <Block n={++n} title="업체별 결제" sub={vendorList.length ? `거래 업체 ${vendorList.length}곳` : undefined}>
      {!vendorList.length ? <p className="sf-hint">기록 없음</p> : <div className="iv-scroll"><table className="sf-table iv-year"><thead><tr><th>업체</th><th>결제 방법</th><th className="num">거래 개월 수</th><th className="num">결제 완료</th><th className="num">결제 예정</th><th className="num">결제금액</th></tr></thead>
        <tbody>{vendorList.map(v => <tr key={v.name}><td><b>{v.name}</b></td><td>{v.method || '—'}</td><td className="num">{v.months.size}개월</td><td className="num">{dash(v.done, won)}</td><td className="num">{dash(v.due, won)}</td><td className="num">{v.bal ? <span className="iv-balcalc"><small>구매 금액 {won(v.amount + v.bal)}</small><small>{v.why} −{won(v.bal)}</small><b>{won(v.amount)}</b></span> : <b>{won(v.amount)}</b>}{v.refund ? <small className="iv-pay-co">환급 입금 {won(v.refund)}</small> : null}</td></tr>)}
          <tr className="iv-total-row"><td>합계</td><td /><td /><td className="num">{won(vendorList.reduce((t, v) => t + v.done, 0))}</td><td className="num">{won(vendorList.reduce((t, v) => t + v.due, 0))}</td><td className="num">{won(vendorList.reduce((t, v) => t + v.amount, 0))}</td></tr></tbody></table></div>}
    </Block>
    <Block n={++n} title="직원 근무·연차" sub={`${year}년 한 해 합계 · 잔여연차는 오늘 기준`}>
      {!team.length ? <p className="sf-hint">기록 없음</p> : <div className="iv-scroll"><table className="sf-table iv-year"><thead><tr><th>직원</th><th className="num">근무일수</th><th className="num">실근무시간</th><th className="num">관리 수</th><th className="num">지정 환자 수</th>
        <th className="num">토요일 휴무</th><th className="num">잔여연차</th></tr></thead>
        <tbody>{team.map(x => <tr key={x.id}><td><b>{x.name}</b></td><td className="num">{dash(x.work_days, v => `${v}일`)}</td><td className="num">{dash(x.hours, v => `${v}시간`)}</td><td className="num">{dash(x.managed, v => `${v}명`)}</td><td className="num">{dash(x.designated, v => `${v}명`)}</td>
          <td className="num">{dash(x.sat_off, v => `${v}회`)}</td><td className="num"><b>{x.remain_leave != null ? `${x.remain_leave}일` : '—'}</b></td></tr>)}
          <tr className="iv-total-row"><td>합계</td><td className="num">{tsum('work_days')}일</td><td className="num">{tsum('hours')}시간</td><td className="num">{tsum('managed')}명</td><td className="num">{tsum('designated')}명</td>
            <td className="num">{tsum('sat_off')}회</td><td /></tr></tbody></table></div>}
    </Block>
    <p className="iv-foot">출력 {new Date().toLocaleString('ko-KR')}</p>
  </article>;
}

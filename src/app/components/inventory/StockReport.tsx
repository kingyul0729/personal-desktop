import { useEffect, useState } from 'react';
import { LoadingBox } from '../Feedback';
import { readWon } from '../../koreanAmount';
import { KIND_LABEL, fmtQty, fmtWon, invGet, shiftMonth, todayLocal } from '../../inventoryApi';
import { Seg, errText, withUnit } from './shared';

export type MonthRep = { month: string; spend_total: number; spend_general: number; spend_prepaid: number; in_count: number; no_invoice: number; no_amount: number; patients: number; open_days: number;
  usage: { id: number; name: string; stock_unit: string; used: number; per_day: number | null }[];
  inbound?: { date: string; kind: string; qty: number; bonus_qty: number; amount: number | null; invoice: number; memo: string | null; item_name: string; stock_unit: string; vendor_name: string | null; payment_method: string | null; cancelled_at?: number | null; cancel_reason?: string | null }[];
  prepaid?: { id: number; name: string; stock_unit: string; vendor_stock: number; hospital_stock: number }[];
  stock?: { id: number; name: string; stock_unit: string; hospital_stock: number; min_stock: number }[]; as_of?: string | null;
  payments?: { vendor_id: number; name: string; company: string | null; payment_method: string | null; when: string; amount: number; holder?: string | null; bank?: string | null; account?: string | null }[] };

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

export const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`;
export const diff = (a: number, b: number, f: (v: number) => string) => { const d = a - b; return d === 0 ? '0' : `${d > 0 ? '+' : '−'}${f(Math.abs(d))}`; };
// 월말·연말 보고: 번호 붙은 흰 카드 섹션(2026-11-08 사용자 지정 '10월 피부팀 월 정리' 형식)
export function Block({ n, title, sub, children }: { n: number; title: string; sub?: string; children: React.ReactNode }) {
  return <section className="iv-block"><h3 className="iv-num"><i>{n}</i>{title}{sub && <small>{sub}</small>}</h3>{children}</section>;
}
export function MonthReport({ a, b }: { a: MonthRep; b: MonthRep }) {
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
    {a.prepaid && a.prepaid.length > 0 && <Block n={++n} title="업체 보관 잔량" sub={a.as_of ? `${mm(a.month)} 말` : '현재'}>
      <table className="sf-table"><thead><tr><th>품목</th><th className="num">업체 보관 잔량</th><th className="num">병원재고</th></tr></thead>
        <tbody>{a.prepaid.map(p => <tr key={p.id}><td>{p.name}</td><td className="num"><b>{withUnit(p.vendor_stock, p.stock_unit)}</b></td><td className="num">{withUnit(p.hospital_stock, p.stock_unit)}</td></tr>)}</tbody></table></Block>}
    {a.inbound && <Block n={++n} title="입고·구매 내역">{!a.inbound.length ? <p className="sf-hint">기록 없음</p> : <table className="sf-table"><thead><tr><th>날짜</th><th>품목</th><th>구분</th><th className="num">수량</th><th className="num">금액</th><th>명세서</th></tr></thead>
      <tbody>{a.inbound.map((r, i) => <tr key={i}><td>{Number(r.date.slice(5, 7))}.{Number(r.date.slice(8))}</td><td>{r.item_name} <small>{r.vendor_name}{r.payment_method ? ` · ${r.payment_method}` : ''}</small></td><td><small>{KIND_LABEL[r.kind]}{r.cancelled_at ? <b className="is-warn"> 취소</b> : null}</small></td>
        <td className="num">{fmtQty(r.qty)}{r.bonus_qty ? ` (+${fmtQty(r.bonus_qty)})` : ''} {r.stock_unit}</td><td className="num">{r.kind === 'prepaid_in' ? '—' : fmtWon(r.amount)}</td><td>{r.invoice ? '등록' : (r.amount || 0) > 0 ? <span className="is-warn">미등록</span> : '—'}</td></tr>)}</tbody></table>}</Block>}
    {a.payments && <Block n={++n} title="결제 내역" sub={a.payments.length ? `합계 ${won(a.payments.reduce((x, p) => x + p.amount, 0))}` : undefined}>{!a.payments.length ? <p className="sf-hint">기록 없음</p> : <table className="sf-table"><thead><tr><th>업체</th><th>결제</th><th className="num">결제금액</th></tr></thead>
      <tbody>{a.payments.map(p => <tr key={p.vendor_id}><td><b>{p.name}</b>{p.bank !== undefined ? <><br /><small>{p.company || p.name} · 예금주 {p.holder || '—'} · {p.bank || '은행 —'} {p.account || '계좌 —'}</small></> : null}</td><td><small>{p.payment_method || '—'} · {p.when}</small></td><td className="num"><b>{won(p.amount)}</b></td></tr>)}</tbody></table>}</Block>}
    <p className="iv-foot">출력 {new Date().toLocaleString('ko-KR')}</p>
  </article>;
}

export function YearReport({ year, months }: { year: string; months: MonthRep[] }) {
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

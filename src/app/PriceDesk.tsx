import { useMemo, useState, useEffect } from 'react';
import { Calculator, ReceiptText, BookOpen, Menu, Minus, Square, X, Copy, Check, Search, ChevronRight, CircleDollarSign, Clock3, Sparkles, ListFilter } from 'lucide-react';

type AppTab = 'calculator' | 'prices' | 'scripts';
type CalcTab = 'rounds' | 'vat' | 'discount' | 'prepaid';

declare global {
  interface Document {
    modelContext?: {
      registerTool: (tool: {
        name: string;
        title: string;
        description: string;
        inputSchema: object;
        annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
        execute: (input: unknown) => unknown;
      }, options?: { signal?: AbortSignal }) => void | Promise<void>;
    };
  }
}

const priceItems = [
  { category: '색소', name: '레블라이트 + 비타민', price: 19.8, unit: '1회' }, { category: '색소', name: '피코플러스 + 비타민', price: 19.8, unit: '1회' },
  { category: '색소', name: '스타룩스 XD', price: 33, unit: '1회' }, { category: '색소', name: '맥스지 + 알렉스', price: 44, unit: '1회' },
  { category: '관리', name: 'LDM', price: 16.5, unit: '1회' }, { category: '여드름', name: '여드름 4주', price: 38.5, unit: '총 4회' },
  { category: '여드름', name: '여드름 6주', price: 77, unit: '총 6회' }, { category: '여드름', name: '여드름 8주', price: 99, unit: '총 8회' },
  { category: '색소', name: '스페셜 토닝 1', price: 132, unit: '총 11회' }, { category: '색소', name: '스페셜 토닝 2', price: 143, unit: '총 10회' },
  { category: '색소', name: '스페셜 토닝 3', price: 154, unit: '총 11회' }, { category: '색소', name: '스페셜 토닝 4', price: 165, unit: '총 10회' },
  { category: '흉터·모공', name: '흉터 10회 · 양볼', price: 154, unit: '총 10회' }, { category: '흉터·모공', name: '전체 모공 6회', price: 165, unit: '총 6회' },
  { category: '리프팅', name: '올리지오 600샷 · 대표', price: 110, unit: '1회' }, { category: '리프팅', name: '세르프 600샷 · 대표', price: 198, unit: '1회' },
];

const fmt = (value: number) => Number.isFinite(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '0';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1300); };
  return <button className="copy-button" onClick={copy} aria-label="문장 복사">{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? '복사됨' : '복사'}</button>;
}

function NumberField({ label, value, onChange, suffix = '만원' }: { label: string; value: number; onChange: (v: number) => void; suffix?: string }) {
  return <label className="field"><span>{label}</span><div className="input-shell"><input type="number" min="0" step="0.1" value={value} onChange={(e) => onChange(Number(e.target.value))} /><b>{suffix}</b></div></label>;
}

export default function PriceDesk() {
  const [currentTime, setCurrentTime] = useState('');
  const [windowOpen, setWindowOpen] = useState(true);
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [appTab, setAppTab] = useState<AppTab>('calculator');
  const [calcTab, setCalcTab] = useState<CalcTab>('rounds');
  const [normalUnit, setNormalUnit] = useState(10);
  const [discountUnit, setDiscountUnit] = useState(9);
  const [count, setCount] = useState(5);
  const [vatSeparate, setVatSeparate] = useState(true);
  const [vatBase, setVatBase] = useState(45);
  const [discountBase, setDiscountBase] = useState(100);
  const [prepaidTotal, setPrepaidTotal] = useState(300);
  const [prepaidBase, setPrepaidBase] = useState(291);
  const [receivable, setReceivable] = useState(6);
  const [usedPoints, setUsedPoints] = useState(294);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('전체');

  useEffect(() => {
    const update = () => setCurrentTime(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }));
    update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const registration = context.registerTool({
      name: 'calculate_price_guidance',
      title: '금액과 안내 멘트 계산',
      description: '1회 정가, 1회 할인가, 횟수와 부가세 기준을 입력해 총액과 환자 안내 문장을 계산합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          normalUnit: { type: 'number', minimum: 0 },
          discountUnit: { type: 'number', minimum: 0 },
          count: { type: 'number', minimum: 1 },
          vatSeparate: { type: 'boolean' }
        },
        required: ['normalUnit', 'discountUnit', 'count', 'vatSeparate'],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const value = input as { normalUnit?: unknown; discountUnit?: unknown; count?: unknown; vatSeparate?: unknown };
        if (typeof value.normalUnit !== 'number' || value.normalUnit < 0 || typeof value.discountUnit !== 'number' || value.discountUnit < 0 || typeof value.count !== 'number' || value.count < 1 || typeof value.vatSeparate !== 'boolean') throw new Error('유효한 금액, 횟수와 부가세 기준이 필요합니다.');
        const total = value.normalUnit * value.count;
        const discounted = value.discountUnit * value.count;
        const payment = discounted * (value.vatSeparate ? 1.1 : 1);
        setNormalUnit(value.normalUnit); setDiscountUnit(value.discountUnit); setCount(value.count); setVatSeparate(value.vatSeparate); setAppTab('calculator'); setCalcTab('rounds'); setWindowOpen(true); setMinimized(false);
        return { normalTotal: total, discountedTotal: discounted, paymentTotal: payment, guidance: [`1회 정가는 ${fmt(value.normalUnit)}만 원입니다. ${fmt(value.count)}회 정가는 ${fmt(total)}만 원입니다.`, `정가는 ${fmt(total)}만 원이고, 할인가 ${fmt(discounted)}만 원입니다.`, value.vatSeparate ? `부가세 전 금액은 ${fmt(discounted)}만 원입니다. 실제 결제 금액은 ${fmt(payment)}만 원입니다.` : `실제 결제 금액은 ${fmt(payment)}만 원입니다. 1회 단가는 ${fmt(value.discountUnit)}만 원입니다.`] };
      }
    }, { signal: lifecycle.signal });
    Promise.resolve(registration).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  const normalTotal = normalUnit * count;
  const discountedTotal = discountUnit * count;
  const paymentTotal = discountedTotal * (vatSeparate ? 1.1 : 1);
  const discountRate = normalTotal > 0 ? (1 - discountedTotal / normalTotal) * 100 : 0;
  const prepaidAvailable = prepaidBase + receivable;
  const prepaidRemaining = prepaidAvailable - usedPoints;
  const guidance = useMemo(() => [
    `1회 정가는 ${fmt(normalUnit)}만 원입니다. ${fmt(count)}회 정가는 ${fmt(normalTotal)}만 원입니다.`,
    `정가는 ${fmt(normalTotal)}만 원이고, 할인가 ${fmt(discountedTotal)}만 원입니다.`,
    vatSeparate ? `부가세 전 금액은 ${fmt(discountedTotal)}만 원입니다. 실제 결제 금액은 ${fmt(paymentTotal)}만 원입니다.` : `실제 결제 금액은 ${fmt(paymentTotal)}만 원입니다. 1회 단가는 ${fmt(discountUnit)}만 원입니다.`,
  ], [normalUnit, count, normalTotal, discountedTotal, vatSeparate, paymentTotal, discountUnit]);

  const categories = ['전체', ...Array.from(new Set(priceItems.map((item) => item.category)))];
  const filteredPrices = priceItems.filter((item) => (category === '전체' || item.category === category) && item.name.toLowerCase().includes(query.toLowerCase()));
  const launch = (tab: AppTab) => { setAppTab(tab); setWindowOpen(true); setMinimized(false); };
  const usePrice = (price: number) => { setNormalUnit(price); setDiscountUnit(price); setCount(1); setAppTab('calculator'); setCalcTab('rounds'); };
  const applyDiscount = (rate: number) => setDiscountUnit(Number((normalUnit * (1 - rate / 100)).toFixed(2)));

  return <main className="desktop">
    <div className="aurora aurora-one" /><div className="aurora aurora-two" />
    <section className="desktop-icons" aria-label="데스크톱 앱">
      <button onClick={() => launch('calculator')}><span className="desktop-icon coral"><Calculator /></span><b>금액 계산</b></button>
      <button onClick={() => launch('prices')}><span className="desktop-icon mint"><ReceiptText /></span><b>간단 가격표</b></button>
      <button onClick={() => launch('scripts')}><span className="desktop-icon violet"><BookOpen /></span><b>안내 멘트</b></button>
    </section>

    {windowOpen && !minimized && <section className={`app-window ${maximized ? 'maximized' : ''}`} aria-label="금액 안내 프로그램">
      <header className="titlebar"><div><span className="app-mark"><CircleDollarSign size={17} /></span><b>금액 안내 데스크톱</b><span className="title-status">내부 상담용</span></div><nav aria-label="창 제어"><button onClick={() => setMinimized(true)} aria-label="최소화"><Minus /></button><button onClick={() => setMaximized((v) => !v)} aria-label="최대화"><Square /></button><button className="close" onClick={() => setWindowOpen(false)} aria-label="닫기"><X /></button></nav></header>
      <div className="app-body">
        <aside className="sidebar"><div className="brand-block"><span>PRICE DESK</span><strong>금액 안내</strong><p>숫자는 정확하게,<br />설명은 짧게.</p></div><nav className="side-nav"><button className={appTab === 'calculator' ? 'active' : ''} onClick={() => setAppTab('calculator')}><Calculator />금액 계산</button><button className={appTab === 'prices' ? 'active' : ''} onClick={() => setAppTab('prices')}><ReceiptText />간단 가격표</button><button className={appTab === 'scripts' ? 'active' : ''} onClick={() => setAppTab('scripts')}><BookOpen />안내 멘트</button></nav><div className="sidebar-note"><Sparkles size={16} /><span>부가세·할인·P 계산을 한곳에서 확인합니다.</span></div></aside>
        <section className="workspace">
          {appTab === 'calculator' && <>
            <div className="page-heading"><div><span className="eyebrow">CALCULATOR</span><h1>금액 계산</h1><p>필요한 계산만 선택하고 노란색 입력칸을 수정하세요.</p></div><span className="live-pill"><Clock3 size={14} /> 자동 계산</span></div>
            <div className="calc-tabs" role="tablist">{([['rounds', '정가 · 할인가'], ['vat', '부가세'], ['discount', '할인율'], ['prepaid', '선불권 P']] as [CalcTab, string][]).map(([id, label]) => <button key={id} className={calcTab === id ? 'active' : ''} onClick={() => setCalcTab(id)}>{label}</button>)}</div>

            {calcTab === 'rounds' && <div className="calculator-grid"><section className="panel input-panel"><div className="panel-title"><div><span>01</span><h2>금액 입력</h2></div><small>만원 기준</small></div><div className="form-grid"><NumberField label="1회 정상가" value={normalUnit} onChange={setNormalUnit} /><NumberField label="횟수" value={count} onChange={setCount} suffix="회" /><NumberField label="1회 할인가" value={discountUnit} onChange={setDiscountUnit} /><label className="field"><span>부가세 기준</span><div className="segmented"><button className={!vatSeparate ? 'active' : ''} onClick={() => setVatSeparate(false)}>포함</button><button className={vatSeparate ? 'active' : ''} onClick={() => setVatSeparate(true)}>별도</button></div></label></div><div className="preset-row"><span>할인 빠른 적용</span>{[10, 15, 20].map((rate) => <button key={rate} onClick={() => applyDiscount(rate)}>{rate}%</button>)}</div></section><section className="panel result-panel"><div className="panel-title"><div><span>02</span><h2>계산 결과</h2></div><small>VAT {vatSeparate ? '별도' : '포함'}</small></div><div className="result-list"><div><span>정상 총금액</span><strong>{fmt(normalTotal)}<small>만원</small></strong></div><div><span>할인 총금액</span><strong>{fmt(discountedTotal)}<small>만원</small></strong></div><div className="accent-result"><span>실제 결제 금액</span><strong>{fmt(paymentTotal)}<small>만원</small></strong></div></div><div className="result-meta"><span>할인율 <b>{fmt(discountRate)}%</b></span><span>할인 금액 <b>{fmt(normalTotal - discountedTotal)}만원</b></span></div></section><section className="panel script-panel full-span"><div className="panel-title"><div><span>03</span><h2>바로 말할 문장</h2></div><small>한 문장 숫자 2개 이하</small></div><div className="script-list">{guidance.map((line) => <div key={line}><p>{line}</p><CopyButton text={line} /></div>)}</div></section></div>}

            {calcTab === 'vat' && <div className="single-layout"><section className="panel compact-input"><div className="panel-title"><div><span>01</span><h2>부가세 계산</h2></div></div><NumberField label="부가세 전 금액" value={vatBase} onChange={setVatBase} /></section><section className="panel vat-result"><span>부가세 전</span><strong>{fmt(vatBase)}만원</strong><ChevronRight /><span>실제 결제</span><strong>{fmt(vatBase * 1.1)}만원</strong></section><section className="panel full-span quick-panel"><div className="panel-title"><div><span>02</span><h2>빠른 부가세표</h2></div><small>10% 적용</small></div><div className="vat-table">{Array.from({ length: 10 }, (_, i) => (i + 1) * 10).map((n) => <div key={n}><span>{n}만원</span><ChevronRight /><b>{fmt(n * 1.1)}만원</b></div>)}</div></section></div>}
            {calcTab === 'discount' && <div className="single-layout"><section className="panel compact-input"><div className="panel-title"><div><span>01</span><h2>기준 금액</h2></div></div><NumberField label="정가" value={discountBase} onChange={setDiscountBase} /></section><section className="panel discount-intro"><b>정가에서 할인 금액을 바로 비교합니다.</b><span>10% · 15% · 20%</span></section><section className="panel full-span quick-panel"><div className="panel-title"><div><span>02</span><h2>할인 가격 비교</h2></div></div><div className="discount-cards">{[0, 10, 15, 20].map((rate) => <div key={rate} className={rate === 15 ? 'featured' : ''}><span>{rate === 0 ? '정가' : `${rate}% 할인`}</span><strong>{fmt(discountBase * (1 - rate / 100))}<small>만원</small></strong><p>{rate === 0 ? '할인 없음' : `${fmt(discountBase * rate / 100)}만원 할인`}</p></div>)}</div></section></div>}
            {calcTab === 'prepaid' && <div className="calculator-grid"><section className="panel input-panel"><div className="panel-title"><div><span>01</span><h2>선불권 입력</h2></div><small>P 기준</small></div><div className="form-grid"><NumberField label="총 선불권" value={prepaidTotal} onChange={setPrepaidTotal} suffix="P" /><NumberField label="선금 제외 후" value={prepaidBase} onChange={setPrepaidBase} suffix="P" /><NumberField label="추가 미수금" value={receivable} onChange={setReceivable} suffix="P" /><NumberField label="사용 금액" value={usedPoints} onChange={setUsedPoints} suffix="P" /></div></section><section className="panel result-panel"><div className="panel-title"><div><span>02</span><h2>선불권 결과</h2></div></div><div className="result-list"><div><span>총 선불권</span><strong>{fmt(prepaidTotal)}<small>P</small></strong></div><div><span>계산 가능 금액</span><strong>{fmt(prepaidAvailable)}<small>P</small></strong></div><div className="accent-result"><span>차감 후 남은 금액</span><strong>{fmt(prepaidRemaining)}<small>P</small></strong></div></div></section><section className="panel script-panel full-span"><div className="panel-title"><div><span>03</span><h2>차트 작성 문장</h2></div></div><div className="script-list">{[`선불권은 총 ${fmt(prepaidTotal)}P입니다. 사용 금액은 ${fmt(usedPoints)}P입니다.`, `계산 가능한 금액은 ${fmt(prepaidAvailable)}P입니다. 차감 후 ${fmt(prepaidRemaining)}P가 남습니다.`, `선금 제외 후 ${fmt(prepaidBase)}P이며, 미수금 ${fmt(receivable)}P를 더해 계산합니다.`].map((line) => <div key={line}><p>{line}</p><CopyButton text={line} /></div>)}</div></section></div>}
          </>}

          {appTab === 'prices' && <><div className="page-heading"><div><span className="eyebrow">QUICK PRICE</span><h1>간단 가격표</h1><p>부가세가 포함된 병원 기준 금액입니다.</p></div><span className="live-pill"><ReceiptText size={14} /> {filteredPrices.length}개</span></div><div className="price-toolbar"><label><Search size={17} /><input placeholder="시술명 검색" value={query} onChange={(e) => setQuery(e.target.value)} /></label><div className="category-row"><ListFilter size={16} />{categories.map((c) => <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>{c}</button>)}</div></div><div className="price-table-wrap"><table className="price-table"><thead><tr><th>구분</th><th>시술·프로그램</th><th>기준</th><th>금액</th><th></th></tr></thead><tbody>{filteredPrices.map((item) => <tr key={`${item.category}-${item.name}`}><td><span>{item.category}</span></td><td><b>{item.name}</b></td><td>{item.unit}</td><td><strong>{fmt(item.price)}</strong> 만원</td><td><button onClick={() => usePrice(item.price)}>계산에 넣기</button></td></tr>)}</tbody></table>{filteredPrices.length === 0 && <div className="empty-state">검색 결과가 없습니다.</div>}</div></>}

          {appTab === 'scripts' && <><div className="page-heading"><div><span className="eyebrow">PRICE SCRIPT</span><h1>금액 안내 멘트</h1><p>계산 결과를 짧고 정확한 존댓말로 정리합니다.</p></div></div><div className="script-page-grid"><section className="panel rules-card"><div className="panel-title"><div><span>01</span><h2>말하는 순서</h2></div></div><ol><li><b>1회 단가</b><span>총액과 함께 안내합니다.</span></li><li><b>정가 → 할인가</b><span>할인 전후를 순서대로 말합니다.</span></li><li><b>부가세 전 → 실제 결제</b><span>별도 금액이면 결제액까지 말합니다.</span></li><li><b>총 P → 사용 P → 남은 P</b><span>선불권 금액을 섞지 않습니다.</span></li></ol></section><section className="panel script-panel"><div className="panel-title"><div><span>02</span><h2>현재 계산 멘트</h2></div><button className="link-button" onClick={() => { setAppTab('calculator'); setCalcTab('rounds'); }}>금액 수정</button></div><div className="script-list large">{guidance.map((line) => <div key={line}><p>{line}</p><CopyButton text={line} /></div>)}</div></section><section className="panel caution-card full-span"><div><b>사용하지 않는 표현</b><p>완치 · 무조건 · 100% · 반드시 · 재발하지 않는다 · 효과를 보장하는 표현</p></div><span>이 도구는 금액 안내만 다룹니다. 시술 효과·부작용·적응증 설명은 포함하지 않습니다.</span></section></div></>}
        </section>
      </div>
    </section>}
    <footer className="taskbar"><button className="start-button"><Menu size={18} /><span>시작</span></button><div className="task-divider" /><button className={windowOpen ? 'task-app active' : 'task-app'} onClick={() => { setWindowOpen(true); setMinimized(false); }}><CircleDollarSign size={18} /><span>금액 안내</span></button><div className="tray"><span>KR</span><b>{currentTime}</b></div></footer>
  </main>;
}

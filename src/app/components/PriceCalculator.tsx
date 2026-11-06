import { useEffect, useRef, useState } from 'react';
import { normalizeCalculatorInput } from '../calculatorInput';
import { calculateGeneral, discountUnitForRate, emptyGeneralInput, matchingQuickRate, quickDiscountRates, type GeneralInput, type VatBasis } from '../generalCalc';
import { calculatePrepaid, emptyPrepaidInput, enteredPrepaidAmount, formatWonAmount, prepaidDiscountRates, prepaidModeLabels, wonToManwonText, type PrepaidInput, type PrepaidMode, type PrepaidResult, type PrepaidTier } from '../prepaid';
import { chartClipboardContent, chartColors, copyChartContent, createPrepaidChart, emptyChartContext, type ChartPaymentMethod } from '../prepaidChart';

// 계산기 메뉴는 두 가지: 일반 금액 계산(정가·할인가, 횟수, 부가세, 할인율)과 선불권 P.
type CalcMode = 'general' | 'prepaid';
const modeLabels: Record<CalcMode, string> = { general: '일반 금액 계산', prepaid: '선불권 P' };

const fmt = (value: number) => Number.isFinite(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '0';

export function Field({ label, value, onChange, suffix = '만원', placeholder, hideLabel = false, readOnly = false, hint }: { label: string; value: string; onChange?: (v: string) => void; suffix?: string; placeholder?: string; hideLabel?: boolean; readOnly?: boolean; hint?: string }) {
  return <label className={`pc-field${suffix === '회' ? ' pc-count-field' : ''}${hideLabel ? ' pc-field-label-hidden' : ''}`}><span className={hideLabel ? 'sr-only' : undefined}>{label}</span><div><input
    type="text" inputMode={suffix === '회' ? 'numeric' : 'decimal'} autoComplete="off"
    placeholder={placeholder} readOnly={readOnly}
    value={value} onFocus={(e) => e.currentTarget.select()}
    onChange={(e) => {
      const next = normalizeCalculatorInput(e.currentTarget.value, suffix === '회');
      if (!readOnly && next !== null) onChange?.(next);
    }}
  /><b>{suffix}</b></div>{hint && <small className="pc-field-hint">{hint}</small>}</label>;
}

// 만 원 입력값을 원으로 보여주는 작은 안내 (예: 15.29만원 → 152,900원)
const wonHint = (value: string) => { const won = enteredPrepaidAmount(value); return won !== null && won > 0 ? `= ${formatWonAmount(won)}` : undefined; };

function Toggle<T extends string>({ legend, value, options, onChange, className = '' }: { legend: string; value: T; options: [T, string][]; onChange: (value: T) => void; className?: string }) {
  return <fieldset className={`pc-field pc-vat-basis ${className}`}>
    <legend>{legend}</legend>
    <div className="pc-toggle" role="group" aria-label={legend}>
      {options.map(([id, label]) => <button key={id} type="button" className={value === id ? 'active' : ''} aria-pressed={value === id} onClick={() => onChange(id)}>{label}</button>)}
    </div>
  </fieldset>;
}

export function VatReferenceTable() {
  return <section className="pc-card pc-wide pc-vat-reference" aria-label="부가세 전후 가격표">
    <div className="pc-vat-reference-columns">
      {[[10, 50], [51, 100]].map(([start, end]) =>
        <div key={start} className="pc-vat-reference-scroll" role="region" aria-label={`${start}만 원부터 ${end}만 원까지 부가세 전후 가격표`} tabIndex={0}>
          <table aria-label={`${start}만 원부터 ${end}만 원`}>
          <thead><tr><th scope="col">부가세 전</th><th scope="col">부가세 후 (10%)</th></tr></thead>
          <tbody>{Array.from({ length: end - start + 1 }, (_, index) => start + index).map((before) =>
            <tr key={before}><td>{fmt(before)}</td><td>{fmt(before * 11 / 10)}</td></tr>
          )}</tbody>
          </table>
        </div>
      )}
    </div>
  </section>;
}

// 크게 보여주는 금액 한 줄
function BigAmount({ label, won, tone, note }: { label: string; won: number | null; tone?: 'main' | 'blue' | 'red'; note?: string }) {
  return <div className={`pc-big pc-big-${tone ?? 'main'}`}>
    <span>{label}</span>
    <strong>{won === null ? '—' : formatWonAmount(won)}</strong>
    {note && <small>{note}</small>}
  </div>;
}

// ───────── 일반 금액 계산 ─────────
export function GeneralPanel({ input, onChange }: { input: GeneralInput; onChange: (input: GeneralInput) => void }) {
  const result = calculateGeneral(input);
  const set = <K extends keyof GeneralInput>(key: K, value: GeneralInput[K]) => onChange({ ...input, [key]: value });
  const quick = matchingQuickRate(input);
  const rateText = result.rate === null ? '—' : `${fmt(Math.abs(result.rate))}%`;
  return <div className="pc-grid pc-grid-rounds">
    <section className="pc-card" aria-label="일반 금액 입력">
      <h2>금액 입력</h2>
      <div className="pc-fields">
        <Field label="1회 정상가" value={input.normalUnit} onChange={(value) => set('normalUnit', value)} />
        <Field label="1회 할인가" placeholder="비우면 정가" value={input.discountUnit} onChange={(value) => set('discountUnit', value)} />
        <Field label="횟수" value={input.count} onChange={(value) => set('count', value)} suffix="회" />
        <Toggle<VatBasis> legend="입력 금액" value={input.vat} options={[['separate', '부가세 별도'], ['included', '부가세 포함']]} onChange={(value) => set('vat', value)} />
      </div>
      <fieldset className="pc-field pc-quick-rates">
        <legend>할인율 빠른 선택</legend>
        <div className="pp-choice pc-rate-buttons" role="group" aria-label="할인율 빠른 선택">
          {quickDiscountRates.map((rate) => <button key={rate} type="button" aria-pressed={quick === rate}
            onClick={() => set('discountUnit', rate === 0 ? '' : discountUnitForRate(input.normalUnit, rate))}>{rate === 0 ? '정가' : `${rate}%`}</button>)}
        </div>
      </fieldset>
      <p className="pc-vat-note">{input.vat === 'separate' ? '부가세 별도 금액입니다. 결제 시 부가세 10%를 더합니다.' : '부가세 포함 금액입니다. 부가세를 더하지 않습니다.'}</p>
    </section>
    <section className="pc-card pc-calc-result" aria-label="일반 금액 계산 결과">
      <h2>계산 결과 <small>부가세 포함 결제 기준</small></h2>
      <dl className="pc-result-rows">
        <div><dt>정상가{result.count > 0 ? ` (${fmt(result.count)}회)` : ''}</dt><dd>{formatWonAmount(result.normalPayment)}</dd></div>
        <div><dt>{result.discountPayment < 0 ? '차액 (할인가가 높음)' : '할인금액'}</dt><dd>{result.discountPayment < 0 ? '+ ' : result.discountPayment > 0 ? '− ' : ''}{formatWonAmount(Math.abs(result.discountPayment))} <small>({rateText})</small></dd></div>
      </dl>
      <BigAmount label="최종 결제금액" won={result.ready ? result.finalPayment : null}
        note={result.ready ? `공급가 ${formatWonAmount(result.supply)} + 부가세 ${formatWonAmount(result.vat)}` : '1회 정상가와 횟수를 입력해 주세요.'} />
    </section>
    <details className="pc-card pc-wide pc-vat-details">
      <summary>부가세 전후 가격표 (10~100만 원)</summary>
      <VatReferenceTable />
    </details>
  </div>;
}

// ───────── 선불권 P ─────────
export function ChartPaymentMethods({ method, onChange }: { method: ChartPaymentMethod; onChange: (method: ChartPaymentMethod) => void }) {
  return <fieldset className="pp-chart-settings">
    <legend>결제수단</legend>
    <div className="pp-choice pp-payment-methods">
      {([['card', '카드'], ['cash', '현금'], ['transfer', '계좌이체'], ['mixed', '복합']] as [ChartPaymentMethod, string][]).map(([id, label]) =>
        <button key={id} type="button" aria-pressed={method === id} onClick={() => onChange(method === id ? '' : id)}>{label}</button>
      )}
    </div>
  </fieldset>;
}

export function PrepaidChartCopy({ result, method }: { result: PrepaidResult; method: ChartPaymentMethod }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [context, setContext] = useState(emptyChartContext);
  const [copyStatus, setCopyStatus] = useState('');
  const draft = createPrepaidChart(result, method, context);
  const clipboard = draft ? chartClipboardContent(draft.lines) : null;
  useEffect(() => { setCopyStatus(''); }, [clipboard?.text]);
  useEffect(() => {
    if (!copyStatus) return;
    const timer = window.setTimeout(() => setCopyStatus(''), 2500);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  return <>
    <button ref={trigger} type="button" aria-haspopup="dialog" onClick={() => { setCopyStatus(''); dialog.current?.showModal(); }}>차트 입력용 문구</button>
    <dialog ref={dialog} className="pp-chart-dialog" aria-label="차트 입력용 문구"
      onClose={() => trigger.current?.focus({ preventScroll: true })}
      onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="pp-chart-body">
        <header><h2>차트 입력용 문구</h2><button type="button" onClick={() => dialog.current?.close()}>닫기</button></header>
        <details className="pp-chart-context">
          <summary>차트 정보 · 가족 공용</summary>
          <div className="pp-chart-context-fields">
            <label>사용자 이름·차트번호<input type="text" autoComplete="off" value={context.subject} onChange={(event) => setContext({ ...context, subject: event.currentTarget.value })} /></label>
            <label>프로그램·처방<input type="text" autoComplete="off" value={context.program} onChange={(event) => setContext({ ...context, program: event.currentTarget.value })} /></label>
            <label className="pp-chart-family"><input type="checkbox" checked={context.familyShared} onChange={(event) => setContext({ ...context, familyShared: event.currentTarget.checked })} />가족 공용</label>
            {context.familyShared && <>
              <label>선불권 보유자 이름·차트번호<input type="text" autoComplete="off" value={context.owner} onChange={(event) => setContext({ ...context, owner: event.currentTarget.value })} /></label>
              <p>사용자와 선불권 보유자 두 차트에 같은 문구를 붙여넣으세요.</p>
            </>}
          </div>
        </details>
        <div className="pp-chart-text" aria-label="차트 문구 미리보기" aria-live="polite">
          {draft?.lines.map((line, index) => <p key={index}>{line.map((part, partIndex) => <span key={partIndex} style={{ color: chartColors[part.tone] }}>{part.text}</span>)}</p>)}
        </div>
        <footer>
          <span role="status">{copyStatus}</span>
          <button type="button" disabled={!draft?.canCopy} title={!draft ? '정상가와 잔액을 확인해 주세요.' : !draft.familyReady ? '사용자와 선불권 보유자를 입력해 주세요.' : !draft.canCopy ? '결제수단을 선택해 주세요.' : undefined} onClick={async () => {
            if (!clipboard || !draft?.canCopy) return;
            try {
              const copied = await copyChartContent(clipboard);
              setCopyStatus(copied === 'rich' ? '복사됨' : copied === 'plain' ? '텍스트 복사됨' : '복사 실패');
            } catch { setCopyStatus('복사 실패'); }
          }}>복사</button>
        </footer>
      </div>
    </dialog>
  </>;
}

export function PrepaidPanel({ input, onChange, method, onMethod }: { input: PrepaidInput; onChange: (input: PrepaidInput) => void; method: ChartPaymentMethod; onMethod: (method: ChartPaymentMethod) => void }) {
  const result = calculatePrepaid(input);
  const change = <K extends keyof PrepaidInput>(key: K, value: PrepaidInput[K]) => onChange({ ...input, [key]: value });
  const isPurchase = input.mode === 'purchase';
  const depositText = input.deposit ?? (result.depositIsSuggested ? wonToManwonText(result.deposit) : '');

  return <div className="pp-layout">
    <section className="pc-card pp-card" aria-label="선불권 입력">
      <h2>선불권 입력</h2>
      <div className="pp-fields">
        <fieldset className="pp-tier">
          <legend>이번 결제 방식</legend>
          <div className="pp-choice pp-modes" role="group" aria-label="이번 결제 방식">
            {(['balance', 'purchase'] as PrepaidMode[]).map((mode) => <button key={mode} type="button" aria-pressed={input.mode === mode}
              onClick={() => onChange({ ...input, mode, deposit: null, collected: null })}>{prepaidModeLabels[mode]}</button>)}
          </div>
        </fieldset>
        <fieldset className="pp-tier">
          <legend>{isPurchase ? '추가 구매할 선불권' : '기존 선불권 종류'}</legend>
          <div className="pp-choice pp-tiers" role="group" aria-label="선불권 종류">
            {([300, 400, 500] as PrepaidTier[]).map((tier) => <button key={tier} type="button" aria-pressed={input.tier === tier} onClick={() => change('tier', tier)}>{tier}만원권 <small>{prepaidDiscountRates[tier]}%</small></button>)}
          </div>
        </fieldset>
        <Field label="기존 잔액" placeholder={isPurchase ? '없으면 비워 두세요' : '잔액 입력'} value={input.balance} onChange={(value) => change('balance', value)} hint={wonHint(input.balance)} />
        <Field label="이번 시술 정상가" value={input.normalPrice} onChange={(value) => change('normalPrice', value)} hint={wonHint(input.normalPrice)} />
        <fieldset className="pp-option">
          <legend>예약금</legend>
          <div className="pp-option-body">
            <div className="pp-choice pp-yes-no" role="group" aria-label="예약금">
              <button type="button" aria-pressed={input.hasDeposit} onClick={() => onChange({ ...input, hasDeposit: true, deposit: null })}>받음</button>
              <button type="button" aria-pressed={!input.hasDeposit} onClick={() => onChange({ ...input, hasDeposit: false, deposit: null })}>없음</button>
            </div>
            {input.hasDeposit && <Field label="받은 예약금" hideLabel placeholder="받은 예약금" value={depositText} onChange={(value) => change('deposit', value)} />}
          </div>
          {input.hasDeposit && <small className="pc-field-hint">{isPurchase ? `구매금액의 10%(${formatWonAmount(Math.round(result.tierAmount / 10))})를 넣어 두었습니다. 실제 받은 금액으로 고칠 수 있습니다.` : '실제로 받은 예약금을 입력해 주세요.'}</small>}
        </fieldset>
        <ChartPaymentMethods method={method} onChange={onMethod} />
        <details className="pp-collected-details">
          <summary>받은 금액이 다를 때</summary>
          <Field label="오늘 실제 받은 금액" placeholder={result.ready || input.collected !== null ? wonToManwonText(result.today) : '오늘 받을 금액'}
            value={input.collected ?? ''} onChange={(value) => change('collected', value === '' ? null : value)} hint={input.collected === null ? '비워 두면 오늘 받을 금액을 모두 받은 것으로 계산합니다.' : wonHint(input.collected)} />
        </details>
      </div>
      <p className="pp-rule-note">선불권 할인은 정상가에만 적용하며 부가세를 더하지 않습니다. 이벤트 할인, 기존 할인가, 리프팅 우대가, 재티켓팅 할인, 제모 결합할인과 중복 적용하지 않습니다.</p>
    </section>
    <section className="pc-card pp-card pp-results" aria-label="선불권 결과">
      <header className="pp-results-heading">
        <h2>{prepaidModeLabels[input.mode]}</h2>
        <div className="pp-actions"><PrepaidChartCopy result={result} method={method} /></div>
      </header>
      <BigAmount label="오늘 받을 금액" won={result.ready ? result.today : null} />
      <BigAmount label="남은잔액" won={result.ready ? result.remaining : null} tone="blue"
        note={result.ready && result.isUsageComplete ? '잔액 0원 · 사용완료' : undefined} />
      {result.ready && result.receivable > 0 && <BigAmount label="미수금" won={result.receivable} tone="red" note="아직 받지 않은 금액입니다." />}
      {result.ready && result.overpaid > 0 && <BigAmount label="초과 수납" won={result.overpaid} tone="red" note="받을 금액보다 더 받았습니다." />}
      {result.ready && result.shortfall > 0 && <p className="pp-warning">시술비가 기존 잔액과 구매한 선불권을 합한 금액보다 {formatWonAmount(result.shortfall)} 많습니다. 이 금액은 따로 결제해야 합니다.</p>}
      {!result.ready && <p className="pp-empty">{isPurchase ? '이번 시술 정상가를 입력해 주세요.' : '기존 잔액과 이번 시술 정상가를 입력해 주세요.'}</p>}
    </section>
  </div>;
}

export function PriceCalculator() {
  const [mode, setMode] = useState<CalcMode>('general');
  // 입력값은 여기 모아 둔다: 창을 최소화해도 닫기 전까지 그대로 남는다.
  const [general, setGeneral] = useState<GeneralInput>(emptyGeneralInput);
  const [prepaid, setPrepaid] = useState<PrepaidInput>(emptyPrepaidInput);
  const [method, setMethod] = useState<ChartPaymentMethod>('');

  return <div className={`price-program${mode === 'prepaid' ? ' pc-prepaid-mode' : ''}`}>
    <header className="pc-header pc-header-simple">
      <div><h1>금액 계산</h1><span>입력은 만 원, 결과는 원</span></div>
    </header>
    <div className="pc-page">
      <div className="pc-mode-row">
        <div className="pc-mode-tabs">{(['general', 'prepaid'] as CalcMode[]).map((id) => <button key={id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)}>{modeLabels[id]}</button>)}</div>
      </div>
      {mode === 'general' && <GeneralPanel input={general} onChange={setGeneral} />}
      {mode === 'prepaid' && <PrepaidPanel input={prepaid} onChange={setPrepaid} method={method} onMethod={setMethod} />}
    </div>
  </div>;
}

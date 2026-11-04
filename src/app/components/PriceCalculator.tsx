import { useEffect, useRef, useState, type ReactNode } from 'react';
import { calculatePriceGuide, createPriceGuideMessage, formatGuideAmount, type PriceGuideValues, type VatView } from '../priceGuide';
import { calculatorNumber, emptyCalculatorInputs, normalizeCalculatorInput } from '../calculatorInput';
import { calculatePrepaid, emptyPrepaidInput, formatPrepaidAmount, prepaidResultRows, type PrepaidInput, type PrepaidResult, type PrepaidTier } from '../prepaid';
import { chartClipboardContent, chartColors, copyChartContent, createPrepaidChart, emptyChartContext, type ChartPaymentMethod } from '../prepaidChart';
import { PinkFolderIcon, type PinkFolderVariant } from './PinkFolderIcon';
import { compareDiscount, formatWon, splitIncludedWon, splitVat, toWon, unitFromPackage, wonToManwon, type VatInput, type VatSplit } from '../consultCalc';

type CalcMode = 'rounds' | 'vat' | 'discount' | 'prepaid';
type DiscountBasis = 'unit' | 'package';
const modeFolder: Record<CalcMode, PinkFolderVariant> = { rounds: 'heart', vat: 'flower', discount: 'cherry', prepaid: 'kitty' };

const fmt = (value: number) => Number.isFinite(value)
  ? value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '0';

export function Field({ label, value, onChange, suffix = '만원', placeholder, hideLabel = false, readOnly = false }: { label: string; value: string; onChange?: (v: string) => void; suffix?: string; placeholder?: string; hideLabel?: boolean; readOnly?: boolean }) {
  return <label className={`pc-field${suffix === '회' ? ' pc-count-field' : ''}${hideLabel ? ' pc-field-label-hidden' : ''}`}><span className={hideLabel ? 'sr-only' : undefined}>{label}</span><div><input
    type="text" inputMode={suffix === '회' ? 'numeric' : 'decimal'} autoComplete="off"
    placeholder={placeholder} readOnly={readOnly}
    value={value} onFocus={(e) => e.currentTarget.select()}
    onChange={(e) => {
      const next = normalizeCalculatorInput(e.currentTarget.value, suffix === '회');
      if (!readOnly && next !== null) onChange?.(next);
    }}
  /><b>{suffix}</b></div></label>;
}

function VatBasis({ separate, onChange }: { separate: boolean; onChange: (value: boolean) => void }) {
  return <fieldset className="pc-field pc-vat-basis">
    <legend>부가세 기준</legend>
    <div className="pc-toggle">
      <button type="button" className={separate ? 'active' : ''} aria-pressed={separate} onClick={() => onChange(true)}>부가세 전</button>
      <button type="button" className={!separate ? 'active' : ''} aria-pressed={!separate} onClick={() => onChange(false)}>부가세 후</button>
    </div>
  </fieldset>;
}

export function RoundResults({ normalUnit, discountUnit, count, vatSeparate }: { normalUnit: number; discountUnit: number; count: number; vatSeparate: boolean }) {
  const vatView: VatView = 'after';
  const prices = calculatePriceGuide({ normalUnit, discountUnit, count, vatSeparate }, vatView);
  // Same won total as the payment line; a VAT-separate input keeps its own supply amount.
  const paymentWon = Math.round(prices.appliedTotal * 10000);
  const vatSplit = splitIncludedWon(paymentWon, vatSeparate ? toWon(discountUnit * count) : undefined);
  return <PriceGuideView prices={prices} count={count} vatView={vatView} vatSplit={vatSplit} />;
}

function DiscountBasisToggle({ basis, onChange }: { basis: DiscountBasis; onChange: (basis: DiscountBasis) => void }) {
  return <fieldset className="pc-field pc-vat-basis pc-discount-basis">
    <legend>할인가 입력 기준</legend>
    <div className="pc-toggle">
      <button type="button" className={basis === 'unit' ? 'active' : ''} aria-pressed={basis === 'unit'} onClick={() => onChange('unit')}>회당 금액</button>
      <button type="button" className={basis === 'package' ? 'active' : ''} aria-pressed={basis === 'package'} onClick={() => onChange('package')}>패키지 총액</button>
    </div>
  </fieldset>;
}

export function PriceGuideView({ prices, count, vatView, vatSplit }: {
  prices: PriceGuideValues;
  count: number;
  vatView: VatView;
  vatSplit?: VatSplit;
}) {
  const totalDiscount = prices.normalTotal - prices.appliedTotal;
  const discountRate = prices.normalTotal > 0 ? Math.abs(totalDiscount / prices.normalTotal * 100) : null;
  const paymentWon = Math.round(prices.appliedTotal * (vatView === 'before' ? 1.1 : 1) * 10000).toLocaleString('ko-KR');
  const guidance = createPriceGuideMessage(prices, count);
  return <section className="pc-card pc-price-guide" aria-label="가격 안내">
    <header className="pc-guide-heading">
      <h2>가격 안내 ({vatView === 'after' ? '부가세 포함' : '부가세 별도'})</h2>
    </header>
    <div className="pc-guide-table-wrap">
      <table className="pc-guide-table" aria-label={`가격 비교 · ${vatView === 'after' ? '부가세 포함' : '부가세 별도'}`}>
        <colgroup><col className="pc-guide-col-name" /><col className="pc-guide-col-unit" /><col className="pc-guide-col-count" /><col className="pc-guide-col-total" /></colgroup>
        <thead><tr><th scope="col">구분</th><th scope="col">1회 단가</th><th scope="col">횟수</th><th scope="col">총금액</th></tr></thead>
        <tbody>
          <tr><th scope="row">정상가 기준</th><td>{formatGuideAmount(prices.normalUnit)}만 원</td><td>× {formatGuideAmount(count)}회</td><td>{formatGuideAmount(prices.normalTotal)}만 원</td></tr>
          <tr className="pc-guide-applied"><th scope="row">{formatGuideAmount(count)}회 적용가</th><td>{formatGuideAmount(prices.appliedUnit)}만 원</td><td>× {formatGuideAmount(count)}회</td><td>{formatGuideAmount(prices.appliedTotal)}만 원</td></tr>
        </tbody>
      </table>
    </div>
    <dl className="pc-guide-summary" aria-label="혜택 및 최종 금액">
      <div className="pc-guide-benefit">
        <dt>{totalDiscount < 0 ? '총 차액' : '총 혜택'}</dt>
        <dd>
          <span>{totalDiscount > 0 ? `− ${formatGuideAmount(totalDiscount)}만 원 할인` : totalDiscount < 0 ? `+ ${formatGuideAmount(-totalDiscount)}만 원` : '할인 없음'}</span>
          {discountRate !== null && <small>({formatGuideAmount(discountRate)}% {totalDiscount < 0 ? '증가' : '절감'})</small>}
        </dd>
      </div>
      <div className="pc-guide-payment">
        <dt>최종 결제금액</dt>
        <dd><strong>{paymentWon} 원</strong><small>(부가세 포함)</small></dd>
      </div>
      {vatSplit && <div className="pc-guide-vat-split">
        <dt>부가세 별도</dt>
        <dd><span>공급가 {formatGuideAmount(wonToManwon(vatSplit.supply))}만 원</span><small>+ 부가세 {formatGuideAmount(wonToManwon(vatSplit.vat))}만 원</small></dd>
      </div>}
    </dl>
    <output hidden data-price-guide-message="true">{guidance}</output>
  </section>;
}

export function DiscountResults({ base }: { base: number }) {
  return <section className="pc-card"><h2>정가 → 할인가</h2><div className="pc-discounts">
    {[0, 10, 15, 20].map((rate) => {
      const price = base * (1 - rate / 100);
      return <div key={rate}>
        <h3>{rate === 0 ? '정가' : `${rate}% 할인`}</h3>
        <dl>
          <div><dt>부가세 별도</dt><dd>{fmt(price)}만원</dd></div>
          <div className="pc-discount-payment"><dt>실제 결제 금액<small>부가세 포함</small></dt><dd>{fmt(price * 1.1)}만원</dd></div>
        </dl>
      </div>;
    })}
  </div></section>;
}

export function DiscountPanel({ value, onChange, children }: { value: string; onChange: (value: string) => void; children?: ReactNode }) {
  return <div className="pc-grid pc-grid-discount">
    <section className="pc-card">
      <h2>기준 금액</h2>
      <Field label="정가" value={value} onChange={onChange} />
      <p className="pc-vat-note">입력 금액은 부가세 별도입니다.</p>
      {children}
    </section>
    <DiscountResults base={calculatorNumber(value)} />
  </div>;
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

// A won-exact payment line, shown apart from the other results.
function PaymentTotal({ label, won, note }: { label: string; won: number; note?: string }) {
  return <div className="pc-total">
    <span>{label}</span>
    <strong>{formatWon(won)} 원</strong>
    {note && <small>{note}</small>}
  </div>;
}

export function VatPanel({ value, onChange, input, onInput }: { value: string; onChange: (value: string) => void; input: VatInput; onInput: (input: VatInput) => void }) {
  const split = splitVat(calculatorNumber(value), input);
  return <div className="pc-grid pc-grid-vat">
    <section className="pc-card" aria-label="부가세 계산 입력">
      <h2>금액 입력</h2>
      <div className="pc-fields pc-fields-single">
        <Field label={input === 'separate' ? '금액 (부가세 별도)' : '금액 (부가세 포함)'} value={value} onChange={onChange} />
        <fieldset className="pc-field pc-vat-basis">
          <legend>입력 금액 기준</legend>
          <div className="pc-toggle">
            <button type="button" className={input === 'separate' ? 'active' : ''} aria-pressed={input === 'separate'} onClick={() => onInput('separate')}>부가세 별도</button>
            <button type="button" className={input === 'included' ? 'active' : ''} aria-pressed={input === 'included'} onClick={() => onInput('included')}>부가세 포함</button>
          </div>
        </fieldset>
      </div>
      <p className="pc-vat-note">{input === 'separate' ? '입력 금액에 부가세 10%를 더합니다.' : '입력 금액에서 공급가액과 부가세를 나눕니다. 부가세를 다시 더하지 않습니다.'}</p>
    </section>
    <section className="pc-card pc-calc-result" aria-label="부가세 계산 결과">
      <h2>계산 결과</h2>
      <dl className="pc-result-rows">
        <div><dt>공급가액</dt><dd>{formatGuideAmount(wonToManwon(split.supply))}<span>만 원</span></dd></div>
        <div><dt>부가세 (10%)</dt><dd>{formatGuideAmount(wonToManwon(split.vat))}<span>만 원</span></dd></div>
      </dl>
      <PaymentTotal label="최종 금액 (부가세 포함)" won={split.total} />
    </section>
  </div>;
}

export function DiscountComparePanel({ normal, discounted, onChange }: { normal: string; discounted: string; onChange: (value: string) => void }) {
  const result = compareDiscount(calculatorNumber(normal), calculatorNumber(discounted));
  const payment = splitVat(wonToManwon(result.discounted), 'separate');
  const rate = result.rate === null ? '—' : `${formatGuideAmount(Math.abs(result.rate))}%`;
  return <section className="pc-discount-compare" aria-label="할인율 확인">
    <h2>할인율 확인</h2>
    <div className="pc-compare-body">
      <div className="pc-compare-input">
        <Field label="할인가 (부가세 별도)" value={discounted} onChange={onChange} />
      </div>
      <dl className="pc-result-rows">
        <div><dt>{result.difference < 0 ? '차액 (할인가가 높음)' : '할인금액'}</dt><dd>{formatGuideAmount(wonToManwon(Math.abs(result.difference)))}<span>만 원</span></dd></div>
        <div><dt>{result.difference < 0 ? '증가율' : '할인율'}</dt><dd>{rate}</dd></div>
        <div><dt>할인가 부가세 포함</dt><dd>{formatGuideAmount(wonToManwon(payment.total))}<span>만 원</span></dd></div>
      </dl>
    </div>
  </section>;
}

function PrepaidOptionalAmount({ label, enabled, onToggle, value, onChange, placeholder, buttonLabels = ['있음', '없음'], buttonAriaLabels }: {
  label: string; enabled: boolean; onToggle: (enabled: boolean) => void;
  value: string; onChange: (value: string) => void; placeholder: string;
  buttonLabels?: [string, string]; buttonAriaLabels?: [string, string];
}) {
  return <fieldset className="pp-option">
    <legend>{label}</legend>
    <div className="pp-option-body">
      <div className="pp-choice pp-yes-no" role="group" aria-label={label}>
        <button type="button" aria-label={buttonAriaLabels?.[0]} aria-pressed={enabled} onClick={() => onToggle(true)}>{buttonLabels[0]}</button>
        <button type="button" aria-label={buttonAriaLabels?.[1]} aria-pressed={!enabled} onClick={() => onToggle(false)}>{buttonLabels[1]}</button>
      </div>
      {enabled && <Field label={`${label} 금액`} hideLabel placeholder={placeholder} value={value} onChange={onChange} />}
    </div>
  </fieldset>;
}

export function ChartPaymentMethods({ method, onChange }: { method: ChartPaymentMethod; onChange: (method: ChartPaymentMethod) => void }) {
  return <fieldset className="pp-chart-settings">
    <legend>결제수단</legend>
    <div className="pp-choice pp-payment-methods">
      {([['card', '카드'], ['cash', '현금'], ['transfer', '계좌'], ['mixed', '복합']] as [ChartPaymentMethod, string][]).map(([id, label]) =>
        <button key={id} type="button" aria-pressed={method === id} onClick={() => onChange(id)}>{label}</button>
      )}
    </div>
  </fieldset>;
}

export function PrepaidChartCopy({ result }: { result: PrepaidResult }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [method, setMethod] = useState<ChartPaymentMethod>('');
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
    <button ref={trigger} type="button" aria-haspopup="dialog" onClick={() => {
      setCopyStatus('');
      dialog.current?.showModal();
    }}>차트 입력용 문구</button>
    <dialog ref={dialog} className="pp-chart-dialog" aria-label="차트 입력용 문구"
      onClose={() => trigger.current?.focus({ preventScroll: true })}
      onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="pp-chart-body">
        <header><h2>차트 입력용 문구</h2><button type="button" onClick={() => dialog.current?.close()}>닫기</button></header>
        <ChartPaymentMethods method={method} onChange={setMethod} />
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
          <button type="button" disabled={!draft?.canCopy} title={!draft ? '프로그램 정상가와 선택한 입력 금액을 확인해 주세요.' : !draft.familyReady ? '사용자와 선불권 보유자를 입력해 주세요.' : !draft.canCopy ? '결제수단을 선택해 주세요.' : undefined} onClick={async () => {
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

export function PrepaidPanel({ input, onChange }: { input: PrepaidInput; onChange: (input: PrepaidInput) => void }) {
  const result = calculatePrepaid(input);
  const rows = prepaidResultRows(result);
  const change = <Key extends keyof PrepaidInput>(key: Key, value: PrepaidInput[Key]) => onChange({ ...input, [key]: value });

  return <div className="pp-layout">
    <section className="pc-card pp-card" aria-label="선불권 입력">
      <h2>선불권 입력</h2>
      <div className="pp-fields">
        <fieldset className="pp-tier">
          <legend>선불권 기준</legend>
          <div className="pp-choice pp-tiers" role="group" aria-label="선불권 기준">
            {([300, 400, 500] as PrepaidTier[]).map((tier) => <button key={tier} type="button" aria-pressed={input.tier === tier} onClick={() => change('tier', tier)}>{tier} 선불권</button>)}
          </div>
        </fieldset>
        <Field label="프로그램 정상가" value={input.normalPrice} onChange={(value) => change('normalPrice', value)} />
        <PrepaidOptionalAmount label="예약금 수납" buttonLabels={['O', 'X']} buttonAriaLabels={['O · 예약금 수납 완료', 'X · 예약금 미수납']} enabled={input.hasDeposit} onToggle={(value) => change('hasDeposit', value)} value={input.deposit ?? (result.depositIsAutomatic ? String(result.deposit / 10000) : '')} onChange={(value) => change('deposit', value)} placeholder="예약금 입력" />
        <PrepaidOptionalAmount label="기존 선불권 잔액" enabled={input.hasBalance} onToggle={(value) => change('hasBalance', value)} value={input.balance} onChange={(value) => change('balance', value)} placeholder="잔액 입력" />
        <div className="pp-collected-input"><Field label={input.hasDeposit ? '추가 수납금액' : '당일 수납금액'} placeholder={input.hasDeposit ? '추가로 수납한 금액' : input.hasBalance ? '예약금 제외 실제 수납액' : '신규 선불권·차액 포함 수납액'} value={input.collected ?? (result.collectionIsAutomatic ? String(result.collected! / 10000) : '')} onChange={(value) => change('collected', value)} /></div>
      </div>
      <p className="pp-rule-note">선불권 할인은 정상가에만 적용합니다. 이벤트 할인, 기존 할인가, 리프팅 우대가, 재티켓팅 할인, 제모 결합할인과 중복 적용하지 않습니다.</p>
    </section>
    <section className="pc-card pp-card pp-results" aria-label="선불권 결과">
      <header className="pp-results-heading">
        <h2>선불권 결과</h2>
        <div className="pp-actions">
          <PrepaidChartCopy result={result} />
        </div>
      </header>
      <dl className="pp-result-list">
        {rows.map((row) => <div key={row.key} className={`pp-result-row pp-row-${row.key}`} data-tone={row.tone} data-positive={row.value !== null && row.value > 0 ? 'true' : undefined}>
          <dt>{row.label}</dt><dd>{row.text ?? formatPrepaidAmount(row.value)}{!row.text && row.value !== null && <span>만원</span>}</dd>
        </div>)}
      </dl>
      {result.ready && <PaymentTotal label={result.hasDeposit ? '결제 필요금액 (예약금 차감 후)' : '결제 필요금액'} won={result.payable} />}
    </section>
  </div>;
}

export function PriceCalculator() {
  const [mode, setMode] = useState<CalcMode>('rounds');
  const [inputs, setInputs] = useState(emptyCalculatorInputs);
  const [prepaid, setPrepaid] = useState<PrepaidInput>(emptyPrepaidInput);
  const setInput = (name: keyof typeof inputs, value: string) => setInputs((previous) => ({ ...previous, [name]: value }));
  const normalUnit = calculatorNumber(inputs.normalUnit);
  const discountUnit = calculatorNumber(inputs.discountUnit);
  const count = calculatorNumber(inputs.count);
  const [vatSeparate, setVatSeparate] = useState(true);
  // Extra inputs live here too, so a minimized window keeps everything being calculated.
  const [discountBasis, setDiscountBasis] = useState<DiscountBasis>('unit');
  const [discountTotal, setDiscountTotal] = useState('');
  const [vatInput, setVatInput] = useState<VatInput>('separate');
  const [compareDiscounted, setCompareDiscounted] = useState('');
  const appliedUnit = discountBasis === 'unit' ? discountUnit : unitFromPackage(calculatorNumber(discountTotal), count);

  const vatNote = vatSeparate ? '부가세 전 금액입니다. 결제 시 부가세 10%가 추가됩니다.' : '부가세 후 금액입니다. 부가세를 추가하지 않습니다.';

  return <div className={`price-program${mode === 'prepaid' ? ' pc-prepaid-mode' : mode === 'vat' ? ' pc-vat-mode' : ''}`}>
    <header className="pc-header pc-header-simple">
      <div><b>금액 계산기</b>{mode !== 'prepaid' && <span>만원 기준</span>}</div>
    </header>

    <div className="pc-page">
      <div className="pc-mode-row">
        <div className="pc-mode-tabs">{([['rounds', '정가 · 할인가'], ['vat', '부가세'], ['discount', '할인율'], ['prepaid', '선불권 P']] as [CalcMode, string][]).map(([id, label]) => <button key={id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)}><PinkFolderIcon variant={modeFolder[id]} />{label}</button>)}</div>
        {mode === 'vat' && <div className="pc-vat-caption"><h2>부가세 전후 가격표</h2><span>단위: 만 원</span></div>}
      </div>

      {mode === 'rounds' && <div className="pc-grid pc-grid-rounds">
        <section className="pc-card"><h2>금액 입력</h2><div className="pc-fields"><DiscountBasisToggle basis={discountBasis} onChange={setDiscountBasis} /><Field label="1회 정상가" value={inputs.normalUnit} onChange={(value) => setInput('normalUnit', value)} />{discountBasis === 'unit'
          ? <Field label="1회 할인가" value={inputs.discountUnit} onChange={(value) => setInput('discountUnit', value)} />
          : <Field label="패키지 할인 총액" value={discountTotal} onChange={setDiscountTotal} />}<Field label="횟수" value={inputs.count} onChange={(value) => setInput('count', value)} suffix="회" /><VatBasis separate={vatSeparate} onChange={setVatSeparate} /></div><p className="pc-vat-note">{vatNote}</p>{discountBasis === 'package' && <p className="pc-vat-note pc-package-note">{count > 0 ? `패키지 총액을 횟수로 나눈 1회 ${formatGuideAmount(appliedUnit)}만 원으로 계산합니다.` : '횟수를 입력하면 1회 할인가를 계산합니다.'}</p>}</section>
        <RoundResults normalUnit={normalUnit} discountUnit={appliedUnit} count={count} vatSeparate={vatSeparate} />
      </div>}

      {mode === 'vat' && <><VatPanel value={inputs.vatBase} onChange={(value) => setInput('vatBase', value)} input={vatInput} onInput={setVatInput} /><VatReferenceTable /></>}

      {mode === 'discount' && <DiscountPanel value={inputs.discountBase} onChange={(value) => setInput('discountBase', value)}><DiscountComparePanel normal={inputs.discountBase} discounted={compareDiscounted} onChange={setCompareDiscounted} /></DiscountPanel>}

      {mode === 'prepaid' && <PrepaidPanel input={prepaid} onChange={setPrepaid} />}
    </div>
  </div>;
}

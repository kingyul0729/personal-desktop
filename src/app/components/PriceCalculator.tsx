import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { readWon } from '../koreanAmount';
import { normalizeCalculatorInput } from '../calculatorInput';
import { calculateGeneral, discountUnitForRate, emptyGeneralInput, matchingQuickRate, quickDiscountRates, type GeneralInput, type VatBasis } from '../generalCalc';
import { calculatePrepaid, emptyPrepaidInput, enteredPrepaidAmount, formatWonAmount, prepaidDiscountRates, prepaidModeLabels, wonToManwonText, type PrepaidInput, type PrepaidMode, type PrepaidResult, type PrepaidTier } from '../prepaid';
import { chartClipboardContent, chartColors, copyChartContent, createPrepaidChart, emptyChartContext, type ChartPaymentMethod } from '../prepaidChart';

// 계산기 메뉴는 두 가지: 일반 금액 계산(정가·할인가, 횟수, 부가세, 할인율)과 선불권 P.
type CalcMode = 'general' | 'prepaid';
const modeLabels: Record<CalcMode, string> = { general: '일반 금액 계산', prepaid: '선불권 P' };

const fmt = (value: number) => Number.isFinite(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '0';

// 숫자 패드: 아이패드에서는 화면 패드로, 컴퓨터에서는 자판으로 입력한다. 같은 칸을 두 방식 모두 받는다.
export interface PadApi {
  active: string | null;
  touch: boolean;
  register(key: string, value: string, onChange: ((v: string) => void) | undefined, whole: boolean): void;
  activate(key: string): void;
}

// 다음 입력칸으로: Enter(자판)나 패드의 '다음'이 쓴다.
export function focusNextField(from: HTMLElement | null, delta = 1) {
  const root = from?.closest('.price-program');
  if (!root || !from) return;
  const inputs = [...root.querySelectorAll<HTMLInputElement>('.pc-field input:not([readonly])')].filter(input => input.offsetParent !== null);
  const next = inputs[inputs.indexOf(from as HTMLInputElement) + delta];
  next?.focus();
}

export function Field({ label, value, onChange, suffix = '만원', placeholder, hideLabel = false, readOnly = false, hint, pad, padKey }: { label: string; value: string; onChange?: (v: string) => void; suffix?: string; placeholder?: string; hideLabel?: boolean; readOnly?: boolean; hint?: string; pad?: PadApi; padKey?: string }) {
  const whole = suffix === '회';
  if (pad && padKey) pad.register(padKey, value, onChange, whole);
  const active = !!pad && !!padKey && pad.active === padKey;
  return <label className={`pc-field${whole ? ' pc-count-field' : ''}${hideLabel ? ' pc-field-label-hidden' : ''}${active ? ' is-active' : ''}`}><span className={hideLabel ? 'sr-only' : undefined}>{label}</span><div><input
    type="text" inputMode={pad?.touch ? 'none' : whole ? 'numeric' : 'decimal'} autoComplete="off" enterKeyHint="next"
    placeholder={placeholder} readOnly={readOnly} data-pad-key={padKey}
    value={value} onFocus={(e) => { e.currentTarget.select(); if (pad && padKey) pad.activate(padKey); }}
    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusNextField(e.currentTarget, e.shiftKey ? -1 : 1); } }}
    onChange={(e) => {
      const next = normalizeCalculatorInput(e.currentTarget.value, whole);
      if (!readOnly && next !== null) onChange?.(next);
    }}
  /><b>{suffix}</b></div>{hint && <small className="pc-field-hint">{hint}</small>}</label>;
}

// 화면 숫자 패드. 누를 때 입력칸의 포커스를 빼앗지 않는다(키보드가 다시 뜨지 않게).
export function NumberPad({ onKey }: { onKey: (key: string) => void }) {
  const keep = (event: ReactPointerEvent) => event.preventDefault();
  const keys: [string, string][] = [['7', '7'], ['8', '8'], ['9', '9'], ['4', '4'], ['5', '5'], ['6', '6'], ['1', '1'], ['2', '2'], ['3', '3'], ['.', '.'], ['0', '0'], ['back', '⌫']];
  return <div className="pc-pad" role="group" aria-label="숫자 패드">
    {keys.map(([key, label]) => <button key={key} type="button" className={key === 'back' || key === '.' ? 'is-sub' : ''} aria-label={key === 'back' ? '한 글자 지우기' : undefined} onPointerDown={keep} onClick={() => onKey(key)}>{label}</button>)}
    <button type="button" className="is-sub" onPointerDown={keep} onClick={() => onKey('clear')}>지우기</button>
    <button type="button" className="is-sub" onPointerDown={keep} onClick={() => onKey('prev')}>이전 칸</button>
    <button type="button" className="is-next" onPointerDown={keep} onClick={() => onKey('next')}>다음 칸</button>
  </div>;
}

// 금액 한 개: 원 단위 숫자 + 그 옆 작은 '만' 읽기(1,028,500원 · 102만 8,500원)
export function Amount({ won }: { won: number }) {
  return <span className="amt"><span className="amt-num">{formatWonAmount(won)}</span>{won >= 10000 && <span className="amt-read">{readWon(won)}</span>}</span>;
}

// 만 원 입력값을 원으로 보여주는 작은 안내 (예: 15.29만원 → 152,900원 · 15만 2,900원)
const wonHint = (value: string) => { const won = enteredPrepaidAmount(value); return won !== null && won > 0 ? `= ${formatWonAmount(won)}${won >= 10000 ? ` · ${readWon(won)}` : ''}` : undefined; };

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
// ───────── 영수증 ─────────
// 오른쪽 결과는 영수증처럼: 줄마다 이름 ……… 금액, 맨 아래 합계. 합계 옆에 작게 '만' 읽기.
type ReceiptLine = { label: string; won: number; sign?: '−' | '+'; note?: string; tone?: 'warn' };
function Receipt({ title, sub, lines, total, extra, empty, actions }: { title: string; sub?: string; lines: (ReceiptLine | 'rule' | null | false)[]; total: { label: string; won: number | null }; extra?: (ReceiptLine | null | false)[]; empty?: string; actions?: ReactNode }) {
  const today = new Date();
  const date = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;
  const row = (line: ReceiptLine, key: number) => <div key={key} className={`rc-row${line.tone === 'warn' ? ' is-warn' : ''}`}>
    <dt>{line.label}{line.note && <small>{line.note}</small>}</dt><i aria-hidden="true" /><dd>{line.sign ? `${line.sign} ` : ''}{formatWonAmount(line.won)}</dd>
  </div>;
  return <div className="receipt">
    <header className="rc-head"><div><b>{title}</b><span>{sub ? `${sub} · ` : ''}{date}</span></div>{actions}</header>
    {total.won === null ? <p className="rc-empty">{empty}</p> : <>
      <dl className="rc-lines">{lines.map((line, i) => line === 'rule' ? <hr key={i} /> : line ? row(line, i) : null)}</dl>
      <div className="rc-total"><span>{total.label}</span><strong>{formatWonAmount(total.won)}</strong>{total.won >= 10000 && <em className="amt-read">{readWon(total.won)}</em>}</div>
      {extra && <dl className="rc-lines rc-extra">{extra.map((line, i) => line ? row(line, i) : null)}</dl>}
    </>}
  </div>;
}

// ───────── 일반 금액 계산 ─────────
export function GeneralPanel({ input, onChange, pad }: { input: GeneralInput; onChange: (input: GeneralInput) => void; pad?: PadApi }) {
  const result = calculateGeneral(input);
  const set = <K extends keyof GeneralInput>(key: K, value: GeneralInput[K]) => onChange({ ...input, [key]: value });
  const quick = matchingQuickRate(input);
  const rateText = result.rate === null ? '—' : `${fmt(Math.abs(result.rate))}%`;
  return <div className="pc-grid pc-grid-rounds">
    <section className="pc-card" aria-label="일반 금액 입력">
      <h2>금액 입력</h2>
      <div className="pc-fields">
        <Field label="1회 정상가" value={input.normalUnit} onChange={(value) => set('normalUnit', value)} pad={pad} padKey="g-normal" hint={wonHint(input.normalUnit)} />
        <Field label="1회 할인가" placeholder="비우면 정가" value={input.discountUnit} onChange={(value) => set('discountUnit', value)} pad={pad} padKey="g-discount" hint={wonHint(input.discountUnit)} />
        <Field label="횟수" value={input.count} onChange={(value) => set('count', value)} suffix="회" pad={pad} padKey="g-count" />
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
      <Receipt title="시술 금액 안내" sub={input.vat === 'separate' ? '부가세 별도 입력' : '부가세 포함 입력'}
        empty="1회 정상가와 횟수를 입력하면 여기에 금액이 정리됩니다."
        lines={[
          { label: `정상가${result.count > 0 ? ` (${fmt(result.count)}회)` : ''}`, won: result.normalPayment, note: result.count > 0 && result.normalPayment ? `1회 ${formatWonAmount(Math.round(result.normalPayment / result.count))}` : undefined },
          result.discountPayment !== 0 && { label: result.discountPayment < 0 ? '차액 (할인가가 높음)' : `할인 ${rateText}`, won: Math.abs(result.discountPayment), sign: result.discountPayment < 0 ? '+' : '−' },
        ]}
        total={{ label: '결제하실 금액', won: result.ready ? result.finalPayment : null }}
        extra={[
          result.ready && result.count > 1 && { label: '1회당', won: Math.round(result.finalPayment / result.count) },
          result.ready && { label: '부가세 포함', won: result.vat, note: `공급가 ${formatWonAmount(result.supply)}` },
        ]} />
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

export function PrepaidPanel({ input, onChange, method, onMethod, pad }: { input: PrepaidInput; onChange: (input: PrepaidInput) => void; method: ChartPaymentMethod; onMethod: (method: ChartPaymentMethod) => void; pad?: PadApi }) {
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
        <Field label="기존 잔액" placeholder={isPurchase ? '없으면 비워 두세요' : '잔액 입력'} value={input.balance} onChange={(value) => change('balance', value)} hint={wonHint(input.balance)} pad={pad} padKey="p-balance" />
        <Field label="이번 시술 정상가" value={input.normalPrice} onChange={(value) => change('normalPrice', value)} hint={wonHint(input.normalPrice)} pad={pad} padKey="p-price" />
        <fieldset className="pp-option">
          <legend>예약금</legend>
          <div className="pp-option-body">
            <div className="pp-choice pp-yes-no" role="group" aria-label="예약금">
              <button type="button" aria-pressed={input.hasDeposit} onClick={() => onChange({ ...input, hasDeposit: true, deposit: null })}>받음</button>
              <button type="button" aria-pressed={!input.hasDeposit} onClick={() => onChange({ ...input, hasDeposit: false, deposit: null })}>없음</button>
            </div>
            {input.hasDeposit && <Field label="받은 예약금" hideLabel placeholder="받은 예약금" value={depositText} onChange={(value) => change('deposit', value)} pad={pad} padKey="p-deposit" hint={wonHint(depositText)} />}
          </div>
          {input.hasDeposit && <small className="pc-field-hint">{isPurchase ? `구매금액의 10%(${formatWonAmount(Math.round(result.tierAmount / 10))})를 넣어 두었습니다. 실제 받은 금액으로 고칠 수 있습니다.` : '실제로 받은 예약금을 입력해 주세요.'}</small>}
        </fieldset>
        <ChartPaymentMethods method={method} onChange={onMethod} />
        <details className="pp-collected-details">
          <summary>받은 금액이 다를 때</summary>
          <Field label="오늘 실제 받은 금액" placeholder={result.ready || input.collected !== null ? wonToManwonText(result.today) : '오늘 받을 금액'}
            value={input.collected ?? ''} onChange={(value) => change('collected', value === '' ? null : value)} hint={input.collected === null ? '비워 두면 오늘 받을 금액을 모두 받은 것으로 계산합니다.' : wonHint(input.collected)}  pad={pad} padKey="p-collected" />
        </details>
      </div>
      <p className="pp-rule-note">선불권 할인은 정상가에만 적용하며 부가세를 더하지 않습니다. 이벤트 할인, 기존 할인가, 리프팅 우대가, 재티켓팅 할인, 제모 결합할인과 중복 적용하지 않습니다.</p>
    </section>
    <section className="pc-card pp-card pp-results" aria-label="선불권 결과">
      <Receipt title={`${input.tier}만원권 ${prepaidDiscountRates[input.tier]}%`} sub={prepaidModeLabels[input.mode]}
        actions={<div className="pp-actions"><PrepaidChartCopy result={result} method={method} /></div>}
        empty={isPurchase ? '이번 시술 정상가를 입력하면 여기에 금액이 정리됩니다.' : '기존 잔액과 이번 시술 정상가를 입력하면 여기에 금액이 정리됩니다.'}
        lines={[
          // 꼭 필요한 줄만: 시술비 → (오늘 결제 계산) → 오늘 받을 금액, 남은잔액은 아래 한 줄
          { label: '시술비', won: result.fee, note: `${readWon(result.normal).replace(/원$/, '')}원에서 ${result.discountRate}% 할인` },
          'rule',
          isPurchase ? { label: `${input.tier}만원권 결제`, won: result.purchase } : { label: '기존 잔액에서 차감', won: result.deducted, sign: '−' },
          result.deposit > 0 && { label: '예약금', won: result.deposit, sign: '−' },
        ]}
        total={{ label: '오늘 받을 금액', won: result.ready ? result.today : null }}
        extra={[
          { label: '남은잔액', won: result.remaining, note: result.isUsageComplete ? '사용완료' : isPurchase ? '시술비 차감 후' : undefined },
          result.ready && result.receivable > 0 && { label: '미수금', won: result.receivable, note: '아직 받지 않은 금액', tone: 'warn' },
          result.ready && result.overpaid > 0 && { label: '초과 수납', won: result.overpaid, note: '받을 금액보다 더 받음', tone: 'warn' },
          result.ready && result.shortfall > 0 && { label: '시술비 부족분', won: result.shortfall, note: '따로 결제', tone: 'warn' },
        ]} />
    </section>
  </div>;
}

export function PriceCalculator() {
  const [mode, setMode] = useState<CalcMode>('general');
  // 입력값은 여기 모아 둔다: 다른 메뉴로 갔다 와도 그대로 남는다.
  const [general, setGeneral] = useState<GeneralInput>(emptyGeneralInput);
  const [prepaid, setPrepaid] = useState<PrepaidInput>(emptyPrepaidInput);
  const [method, setMethod] = useState<ChartPaymentMethod>('');

  // 터치 화면(아이패드)이면 숫자 패드를 처음부터 보이고, 컴퓨터에서는 자판으로 입력한다. 버튼으로 바꿀 수 있다.
  const touch = typeof window !== 'undefined' && !!window.matchMedia?.('(any-pointer: coarse)').matches;
  const [showPad, setShowPad] = useState(() => { try { const saved = localStorage.getItem('calc-pad'); return saved === null ? touch : saved === '1'; } catch { return touch; } });
  useEffect(() => { try { localStorage.setItem('calc-pad', showPad ? '1' : '0'); } catch { /* 이 기기에서만 쓰는 편의 설정 */ } }, [showPad]);
  const [active, setActive] = useState<string | null>(null);
  const fresh = useRef(false); // 칸을 고른 직후 첫 숫자는 기존 값을 바꾼다(자판에서 전체 선택된 것과 같게)
  const fields = useRef(new Map<string, { value: string; onChange?: (v: string) => void; whole: boolean }>());
  const root = useRef<HTMLDivElement>(null);
  const pad: PadApi = {
    active: showPad ? active : null,
    touch: showPad && touch,
    register: (key, value, onChange, whole) => { fields.current.set(key, { value, onChange, whole }); },
    activate: (key) => { setActive(key); fresh.current = true; },
  };
  const press = (key: string) => {
    const input = active ? root.current?.querySelector<HTMLInputElement>(`[data-pad-key="${active}"]`) ?? null : null;
    if (key === 'next' || key === 'prev') {
      if (input) focusNextField(input, key === 'next' ? 1 : -1);
      else root.current?.querySelector<HTMLInputElement>('.pc-field input:not([readonly])')?.focus();
      return;
    }
    const field = active ? fields.current.get(active) : undefined;
    if (!field?.onChange) { root.current?.querySelector<HTMLInputElement>('.pc-field input:not([readonly])')?.focus(); return; }
    const base = fresh.current ? '' : field.value;
    fresh.current = false;
    const next = key === 'clear' ? '' : key === 'back' ? base.slice(0, -1) : normalizeCalculatorInput(base + key, field.whole);
    if (next !== null) field.onChange(next);
    input?.focus();
  };

  return <div ref={root} className={`price-program${mode === 'prepaid' ? ' pc-prepaid-mode' : ''}${showPad ? ' has-pad' : ''}`}>
    <header className="pc-header pc-header-simple">
      <div><h1>금액 계산</h1><span>입력은 만 원, 결과는 원</span></div>
    </header>
    <div className="pc-page">
      <div className="pc-mode-row">
        <div className="pc-mode-tabs">{(['general', 'prepaid'] as CalcMode[]).map((id) => <button key={id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)}>{modeLabels[id]}</button>)}</div>
        <button type="button" className="pc-pad-toggle" aria-pressed={showPad} onClick={() => setShowPad(!showPad)}>{showPad ? '숫자 패드 숨기기' : '숫자 패드'}</button>
      </div>
      {mode === 'general' && <GeneralPanel input={general} onChange={setGeneral} pad={pad} />}
      {mode === 'prepaid' && <PrepaidPanel input={prepaid} onChange={setPrepaid} method={method} onMethod={setMethod} pad={pad} />}
    </div>
    {showPad && <aside className="pc-pad-wrap"><NumberPad onKey={press} /></aside>}
  </div>;
}

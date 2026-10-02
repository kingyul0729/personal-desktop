import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { desktopReducer, initialDesktop } from '../src/app/desktopState.ts';
import { calculatePriceGuide, createPriceGuideMessage } from '../src/app/priceGuide.ts';
import { calculatorNumber, emptyCalculatorInputs, normalizeCalculatorInput } from '../src/app/calculatorInput.ts';
import { emptyPrepaidInput } from '../src/app/prepaid.ts';

// Render real components without a browser; keep the bundle entirely in memory.
const bundled = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server.browser';
      import { Taskbar } from './src/app/components/Taskbar';
      import { Window } from './src/app/components/Window';
      import { RoundResults, DiscountResults, DiscountPanel, PriceGuideView, PriceCalculator, Field, VatReferenceTable, PrepaidPanel, ChartPaymentMethods } from './src/app/components/PriceCalculator';
      import { calculatePriceGuide } from './src/app/priceGuide';
      export const renderGuide = (vatSeparate, vatView, extra = {}) => {
        const input = { normalUnit: 10, discountUnit: 9, count: 5, vatSeparate, ...extra };
        return renderToStaticMarkup(React.createElement(PriceGuideView, {
          prices: calculatePriceGuide(input, vatView), count: input.count, vatView
        }));
      };
      export const renderRounds = (vatSeparate, extra = {}) => renderToStaticMarkup(React.createElement(RoundResults, {
        normalUnit: 10, discountUnit: 9, count: 5, vatSeparate, ...extra
      }));
      export const renderCalculator = () => renderToStaticMarkup(React.createElement(PriceCalculator));
      export const renderVatTable = () => renderToStaticMarkup(React.createElement(VatReferenceTable));
      export const paymentMethodButtons = (props) => ChartPaymentMethods(props).props.children[1].props.children;
      export const renderPaymentMethods = (props) => renderToStaticMarkup(React.createElement(ChartPaymentMethods, props));
      export const renderPrepaid = (input) => renderToStaticMarkup(React.createElement(PrepaidPanel, { input, onChange() {} }));
      export const prepaidCollectionField = (input, onChange) => PrepaidPanel({ input, onChange }).props.children[0].props.children[1].props.children[4].props.children;
      export const prepaidDepositControl = (input, onChange) => PrepaidPanel({ input, onChange }).props.children[0].props.children[1].props.children[2];
      export const prepaidNormalField = (input, onChange) => PrepaidPanel({ input, onChange }).props.children[0].props.children[1].props.children[1];
      export const fieldInput = (props) => Field(props).props.children[1].props.children[0];
      export const renderDiscounts = (base) => renderToStaticMarkup(React.createElement(DiscountResults, {
        base
      }));
      export const renderDiscountPanel = (value) => renderToStaticMarkup(React.createElement(DiscountPanel, { value, onChange() {} }));
      export const renderTaskbar = (desktop) => renderToStaticMarkup(React.createElement(Taskbar, {
        desktop, onOpenWindow() {}, onTaskClick() {}, currentTime: '05:12'
      }));
      export const renderWindow = (extra = {}) => renderToStaticMarkup(React.createElement(Window, {
        title: '금액 계산', icon: null, isOpen: true, isMinimized: false, isActive: true,
        bounds: { width: 820, height: 1124 }, defaultPosition: { x: 250, y: 52 },
        defaultSize: { width: 980, height: 680 }, zIndex: 10,
        onClose() {}, onMinimize() {}, onFocus() {}, ...extra,
      }, React.createElement('input', { defaultValue: '37' })));
    `,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    loader: 'tsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const { renderTaskbar, renderWindow, renderRounds, renderDiscounts, renderDiscountPanel, renderGuide, renderCalculator, renderVatTable, renderPrepaid, prepaidCollectionField, prepaidDepositControl, prepaidNormalField, fieldInput, paymentMethodButtons, renderPaymentMethods } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

test('taskbar renders exactly the running windows and updates after close', () => {
  assert.equal((renderTaskbar(initialDesktop).match(/class="taskbar-task\b/g) ?? []).length, 0);
  const opened = desktopReducer(desktopReducer(initialDesktop, { type: 'open', id: 'priceCalculator' }), { type: 'open', id: 'fileExplorer' });
  const html = renderTaskbar(opened);
  assert.equal((html.match(/class="taskbar-task\b/g) ?? []).length, 2);
  assert.ok(html.includes('aria-label="가격표 보관함"'));
  assert.ok(html.includes('aria-label="금액 계산"'));
  assert.ok(!html.includes('aria-label="Terminal"'));
  const closed = renderTaskbar(desktopReducer(opened, { type: 'close', id: 'fileExplorer' }));
  assert.equal((closed.match(/class="taskbar-task\b/g) ?? []).length, 1);
  assert.ok(!closed.includes('aria-label="가격표 보관함"'));
});

test('minimized window retains its child content, but closing removes it', () => {
  const minimized = renderWindow({ isMinimized: true });
  assert.ok(minimized.includes('hidden=""'));
  assert.ok(minimized.includes('value="37"'));
  assert.equal(renderWindow({ isOpen: false }), '');
  const restored = renderWindow();
  assert.ok(!restored.includes('hidden=""'));
  assert.ok(restored.includes('value="37"'));
});

test('portrait rendering clamps position and width; titlebar controls remain present', () => {
  const html = renderWindow();
  assert.ok(html.includes('left:8px'));
  assert.ok(html.includes('width:804px'));
  for (const label of ['금액 계산 최소화', '금액 계산 최대화', '금액 계산 닫기']) {
    assert.ok(html.includes(`aria-label="${label}"`));
  }
});

test('minimized task stays available and has a restore label', () => {
  const opened = desktopReducer(desktopReducer(initialDesktop, { type: 'open', id: 'priceCalculator' }), { type: 'open', id: 'fileExplorer' });
  const minimized = desktopReducer(opened, { type: 'minimize', id: 'fileExplorer' });
  const html = renderTaskbar(minimized);
  assert.equal((html.match(/class="taskbar-task\b/g) ?? []).length, 2);
  assert.ok(html.includes('aria-label="가격표 보관함 복원"'));
});

const visibleGuideText = (html) => html.replace(/<output hidden[\s\S]*?<\/output>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('price guide converts before-VAT input to inclusive unit prices, totals and benefits', () => {
  const html = renderRounds(true, { normalUnit: 11, discountUnit: 10 });
  const text = visibleGuideText(html);
  assert.doesNotMatch(html, /<button/);
  assert.match(html, /aria-label="가격 비교 · 부가세 포함"/);
  assert.match(text, /가격 안내 \(부가세 포함\) 구분 1회 단가 횟수 총금액/);
  assert.match(text, /정상가 기준 12.1만 원 × 5회 60.5만 원 5회 적용가 11만 원 × 5회 55만 원/);
  assert.match(text, /총 혜택 − 5.5만 원 할인 \(9.09% 절감\)/);
  assert.match(text, /최종 결제금액 550,000 원 \(부가세 포함\)/);
  for (const hiddenText of ['시스템 계산 결과', '계산 기준', '정상가는', '부가세 추가액']) assert.ok(!text.includes(hiddenText));
  assert.match(html, /<output hidden="" data-price-guide-message="true">정상가는/);
  assert.match(html, /정상가는 1회 12.1만원으로 5회 진행 시 60.5만원이고,/);
  assert.match(html, /5회로 진행하시면 1회 11만원, 총 55만원입니다./);
});

test('VAT-after display does not add VAT to already-inclusive input', () => {
  const html = renderRounds(false, { normalUnit: 11, discountUnit: 10 });
  const text = visibleGuideText(html);
  assert.match(html, /aria-label="가격 비교 · 부가세 포함"/);
  assert.match(text, /정상가 기준 11만 원 × 5회 55만 원 5회 적용가 10만 원 × 5회 50만 원/);
  assert.match(text, /총 혜택 − 5만 원 할인 \(9.09% 절감\)/);
  assert.match(text, /최종 결제금액 500,000 원 \(부가세 포함\)/);
});

test('before-VAT comparison still gives the inclusive final payment', () => {
  for (const html of [renderGuide(true, 'before'), renderGuide(false, 'before', { normalUnit: 11, discountUnit: 9.9 })]) {
    const text = visibleGuideText(html);
    assert.match(text, /정상가 기준 10만 원 × 5회 50만 원 5회 적용가 9만 원 × 5회 45만 원/);
    assert.match(text, /총 혜택 − 5만 원 할인 \(10% 절감\)/);
    assert.match(text, /최종 결제금액 495,000 원 \(부가세 포함\)/);
  }
});

test('benefits and won payment follow changed prices and counts without misleading discounts', () => {
  const changed = visibleGuideText(renderGuide(true, 'after', { normalUnit: 20, discountUnit: 17, count: 3 }));
  assert.match(changed, /총 혜택 − 9.9만 원 할인 \(15% 절감\)/);
  assert.match(changed, /최종 결제금액 561,000 원 \(부가세 포함\)/);
  const zero = visibleGuideText(renderGuide(true, 'after', { normalUnit: 0, discountUnit: 0 }));
  assert.match(zero, /총 혜택 할인 없음 최종 결제금액 0 원/);
  assert.doesNotMatch(zero, /NaN|Infinity/);
  const increase = visibleGuideText(renderGuide(true, 'after', { discountUnit: 11 }));
  assert.match(increase, /5회 적용가/);
  assert.match(increase, /총 차액 \+ 5.5만 원 \(10% 증가\)/);
  assert.doesNotMatch(increase, /할인|절감/);
});

test('manual fields start blank and rounds retain the left VAT selector', () => {
  assert.deepEqual(Object.keys(emptyCalculatorInputs), ['normalUnit', 'discountUnit', 'count', 'vatBase', 'discountBase']);
  for (const value of [...Object.values(emptyCalculatorInputs), emptyPrepaidInput.normalPrice, emptyPrepaidInput.deposit ?? '', emptyPrepaidInput.balance]) {
    assert.equal(value, '');
    assert.equal(calculatorNumber(value), 0);
    const input = fieldInput({ label: '금액', value, onChange() {} });
    assert.equal(input.props.value, '');
    assert.equal(input.props.inputMode, 'decimal');
  }
  const html = renderCalculator();
  assert.equal((html.match(/value=""/g) ?? []).length, 3);
  assert.equal((html.match(/>부가세 전<\/button>/g) ?? []).length, 1);
  assert.equal((html.match(/>부가세 후<\/button>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /VAT 전|VAT 후|1회 정상가 \(|할인 적용|pc-presets/);
});

test('prepaid keeps its inputs and exposes chart text only in a closed-on-load popup', () => {
  const all = renderPrepaid(emptyPrepaidInput);
  const html = all.replace(/<dialog[\s\S]*?<\/dialog>/g, '');
  assert.equal((html.match(/<input /g) ?? []).length, 2);
  assert.doesNotMatch(html, /<dialog|계산 공식|pp-formula/);
  assert.match(html, />차트 입력용 문구<\/button>/);
  assert.doesNotMatch(html, /pp-chart-text|실제 수납금액|결제수단/);
  assert.match(all, /<dialog[^>]+aria-label="차트 입력용 문구"/);
  assert.doesNotMatch(all, /<dialog[^>]+\bopen(?:=|\s|>)/);
  assert.match(all, /<footer>[\s\S]*>복사<\/button>/);
  const popup = all.match(/<dialog[\s\S]*?<\/dialog>/)[0];
  assert.match(popup, /<details class="pp-chart-context">/);
  assert.match(popup, /사용자 이름·차트번호/);
  assert.match(popup, /프로그램·처방/);
  assert.doesNotMatch(popup, /<select|실제 수납금액/);
  for (const label of ['카드', '현금', '계좌', '복합']) assert.ok(popup.includes(`>${label}</button>`));
  assert.match(html, /<legend>선불권 기준<\/legend>/);
  assert.doesNotMatch(html, /선불권 종류/);
  const enabled = renderPrepaid({ ...emptyPrepaidInput, hasDeposit: true, hasBalance: true }).replace(/<dialog[\s\S]*?<\/dialog>/g, '');
  assert.equal((enabled.match(/<input /g) ?? []).length, 4);
  assert.match(enabled, /placeholder="예약금 입력"/);
  assert.match(enabled, /placeholder="잔액 입력"/);
  for (const removed of ['총 선불권', '선금 제외 후', '추가 미수금', '사용 금액', '총 P', '계산 가능 P', '사용 P', '남은 P', '남은 선불권 잔액', '유무 선택 후']) {
    assert.ok(!enabled.includes(removed), removed);
  }
});

test('new purchase and existing voucher produce the chart examples in the same card', () => {
  const values = { ...emptyPrepaidInput, normalPrice: '342.1' };
  const html = renderPrepaid(values);
  assert.equal(prepaidCollectionField(values, () => {}).props.value, '307.89');
  for (const [label, value] of [['선불권 금액', 300], ['차액 수납금액', 7.89], ['당일 수납금액', 307.89]]) {
    assert.ok(html.includes(`<dt>${label}</dt><dd>${value}<span>만원`));
  }
  const popup = html.match(/<dialog[\s\S]*?<\/dialog>/)[0];
  assert.match(popup, /적용후 차액 7.89p 추가수납/);
  assert.match(popup, /342.1p→307.89p/);
  assert.match(html, /<dd>선불권제 사용완료<\/dd>/);
  assert.match(popup, /선불권제 사용완료/);
  assert.doesNotMatch(popup, /미수금|예약금|차액금/);
  assert.equal((html.match(/class="pp-result-list"/g) ?? []).length, 1);
  const existing = renderPrepaid({ ...emptyPrepaidInput, tier: 500, normalPrice: '157.1125', hasBalance: true, balance: '257.12' });
  assert.match(existing, /<dt>남은 차액<\/dt><dd>131.43<span>만원/);
  assert.match(existing, /남은 차액: 131.43P/);
  assert.doesNotMatch(existing, /선불권 금액|차액 수납금액/);
});

test('receivable appears in screen and chart only after an actual deposit and before full settlement', () => {
  const base = { ...emptyPrepaidInput, normalPrice: '342.1' };
  for (const extra of [
    {}, { deposit: '3' }, { collected: '300' },
    { hasDeposit: true, deposit: '' }, { hasDeposit: true, deposit: '0' },
    { hasDeposit: true, deposit: '3', collected: '304.89' },
  ]) {
    const html = renderPrepaid({ ...base, ...extra });
    assert.doesNotMatch(html, /<dt>미수금<\/dt>|>미수금 [\d.]+P/);
  }
  for (const [collected, due] of [['', '304.89'], ['300', '4.89']]) {
    const html = renderPrepaid({ ...base, hasDeposit: true, deposit: '3', collected });
    assert.ok(html.includes(`<dt>미수금</dt><dd>${due}<span>만원`));
    assert.ok(html.includes(`미수금 ${due}P`));
  }
  // Switching O back to X must hide both copies even with a retained deposit input.
  const switchedOff = renderPrepaid({ ...base, hasDeposit: false, deposit: '3', collected: '300' });
  assert.doesNotMatch(switchedOff, /<dt>미수금<\/dt>|>미수금 [\d.]+P|선불권제 사용완료/);
});

test('actual receipt remains editable and updates screen and chart together', () => {
  for (const [extra, value] of [[{}, '307.89'], [{ tier: 400 }, '400'], [{ hasDeposit: true, deposit: '30' }, ''], [{ tier: 500, hasDeposit: true, deposit: '50', hasBalance: true, balance: '200' }, '']]) {
    const html = renderPrepaid({ ...emptyPrepaidInput, normalPrice: '342.1', ...extra });
    const field = html.match(/<div class="pp-collected-input">([\s\S]*?)<\/label>/)[1];
    assert.doesNotMatch(field, /readonly/);
    assert.ok(field.includes(`value="${value}"`));
    assert.ok(field.includes(extra.hasDeposit ? 'placeholder="추가로 수납한 금액"' : extra.hasBalance ? 'placeholder="예약금 제외 실제 수납액"' : 'placeholder="신규 선불권·차액 포함 수납액"'));
    if (extra.hasDeposit) assert.doesNotMatch(html, /<dt>당일 수납금액<\/dt>|<dt>추가 수납금액<\/dt>/);
    else assert.ok(html.includes(`<dt>당일 수납금액</dt><dd>${value || '0'}<span>만원</span></dd>`));
  }
  let values = { ...emptyPrepaidInput, normalPrice: '342.1', hasDeposit: true, deposit: '3' };
  const control = prepaidCollectionField(values, changed => { values = changed; });
  const field = fieldInput(control.props);
  for (const [receipt, due] of [['100', 204.89], ['300', 4.89], ['304.89', 0]]) {
    field.props.onChange({ currentTarget: { value: receipt } });
    assert.equal(values.collected, receipt);
    const updated = renderPrepaid(values);
    assert.ok(updated.includes(`<dt>추가 수납금액</dt><dd>${receipt}<span>만원`));
    if (due) assert.ok(updated.includes(`<dt>미수금</dt><dd>${due}<span>만원`));
    else assert.doesNotMatch(updated, /<dt>미수금<\/dt>/);
    assert.match(updated, /aria-label="O · 예약금 수납 완료" aria-pressed="true"/);
    assert.match(updated, /aria-label="X · 예약금 미수납" aria-pressed="false"/);
    const popup = updated.match(/<dialog[\s\S]*?<\/dialog>/)[0];
    assert.match(popup, /예약금 3P/);
    assert.ok(popup.includes(`당일수납 ${receipt}P`));
    if (due) assert.ok(popup.includes(`미수금 ${due}P`));
    else assert.doesNotMatch(popup, /미수금/);
  }
  field.props.onChange({ currentTarget: { value: '' } });
  assert.equal(prepaidCollectionField(values, () => {}).props.value, '');
  assert.match(renderPrepaid(values), /<dt>미수금<\/dt><dd>304.89<span>만원/);
});

test('deposit-only visits stay unpaid in input, results and chart while existing-balance settlement stays automatic', () => {
  for (const extra of [{ hasDeposit: true, deposit: '11' }, { hasBalance: true, balance: '11' }]) {
    let values = { ...emptyPrepaidInput, normalPrice: '341.2', ...extra };
    const control = prepaidCollectionField(values, changed => { values = changed; });
    assert.equal(control.props.value, extra.hasDeposit ? '' : '296.08');
    const html = renderPrepaid(values);
    if (extra.hasDeposit) {
      assert.match(html, /<dt>미수금<\/dt><dd>296.08<span>만원/);
      assert.match(html, /미수금 296.08P/);
      assert.doesNotMatch(html, /당일수납|당일 수납금액|선불권제 사용완료/);
    } else {
      assert.match(html, /<dt>당일 수납금액<\/dt><dd>296.08<span>만원/);
      assert.match(html, /당일수납 296.08P/);
      assert.doesNotMatch(html, /<dt>미수금<\/dt>|>미수금 [\d.]+P/);
    }
    if (extra.hasDeposit) assert.match(html, /<dt>남은 차액<\/dt><dd>—<\/dd>/);
    else assert.match(html, /<dt>남은 차액<\/dt><dd>선불권제 사용완료<\/dd>/);
    if (extra.hasBalance) assert.doesNotMatch(html, /선불권 금액/);
    // An explicit receipt overrides the default, including no collection today.
    fieldInput(control.props).props.onChange({ currentTarget: { value: '0' } });
    assert.equal(prepaidCollectionField(values, () => {}).props.value, '0');
    const updated = renderPrepaid(values);
    assert.doesNotMatch(updated, /당일수납 296.08P|선불권제 사용완료/);
    if (extra.hasDeposit) {
      assert.match(updated, /<dt>미수금<\/dt><dd>296.08<span>만원/);
      assert.match(updated, /미수금 296.08P/);
    } else assert.doesNotMatch(updated, /<dt>미수금<\/dt>|>미수금 [\d.]+P/);
  }
});

test('editing an automatic new receipt immediately changes both its result and chart', () => {
  let values = { ...emptyPrepaidInput, normalPrice: '342.1' };
  const control = prepaidCollectionField(values, changed => { values = changed; });
  assert.equal(control.props.value, '307.89');
  fieldInput(control.props).props.onChange({ currentTarget: { value: '310' } });
  const html = renderPrepaid(values);
  assert.equal(prepaidCollectionField(values, () => {}).props.value, '310');
  assert.match(html, /<dt>당일 수납금액<\/dt><dd>310<span>만원/);
  assert.match(html, /당일수납 310P/);
  assert.match(html, /<dt>남은 차액<\/dt><dd>2.11<span>만원/);
  assert.match(html, /남은 차액: 2.11P/);
  assert.doesNotMatch(html, /차감 후 잔액|남은 잔액/);
});

test('normal price then reservation O automatically fills 10% and displays the unpaid remainder', () => {
  for (const reservationFirst of [false, true]) {
    let values = { ...emptyPrepaidInput };
    const onChange = changed => { values = changed; };
    if (reservationFirst) prepaidDepositControl(values, onChange).props.onToggle(true);
    fieldInput(prepaidNormalField(values, onChange).props).props.onChange({ currentTarget: { value: '350' } });
    if (!reservationFirst) prepaidDepositControl(values, onChange).props.onToggle(true);
    assert.equal(prepaidDepositControl(values, onChange).props.value, '35');
    assert.equal(prepaidCollectionField(values, onChange).props.value, '');
    let html = renderPrepaid(values);
    assert.match(html, /<dt>예약금 수납<\/dt><dd>35<span>만원/);
    assert.match(html, /<dt>미수금<\/dt><dd>280<span>만원/);
    assert.match(html, /예약금 35P/);
    assert.match(html, /미수금 280P/);
    assert.doesNotMatch(html, /당일 수납금액|당일수납|선불권제 사용완료/);
    fieldInput(prepaidNormalField(values, onChange).props).props.onChange({ currentTarget: { value: '360' } });
    assert.equal(prepaidDepositControl(values, onChange).props.value, '36');
    assert.match(renderPrepaid(values), /<dt>미수금<\/dt><dd>288<span>만원/);
    // Actual deposits remain editable; price changes must not replace a manual amount.
    prepaidDepositControl(values, onChange).props.onChange('11');
    fieldInput(prepaidNormalField(values, onChange).props).props.onChange({ currentTarget: { value: '350' } });
    assert.equal(prepaidDepositControl(values, onChange).props.value, '11');
    assert.match(renderPrepaid(values), /미수금 304P/);
    fieldInput(prepaidCollectionField(values, onChange).props).props.onChange({ currentTarget: { value: '100' } });
    html = renderPrepaid(values);
    assert.match(html, /<dt>추가 수납금액<\/dt><dd>100<span>만원/);
    assert.match(html, /미수금 204P/);
    assert.match(html, /당일수납 100P/);
  }
});

test('VAT reference contains every amount from the supplied table without gaps', () => {
  const html = renderVatTable();
  const rows = [...html.matchAll(/<tr><td>([\d.]+)<\/td><td>([\d.]+)<\/td><\/tr>/g)].map((row) => [Number(row[1]), Number(row[2])]);
  assert.equal(rows.length, 91);
  assert.equal(rows[0][0], 10);
  assert.equal(rows.at(-1)[0], 100);
  assert.ok(rows.every(([before], index) => index === 0 || before === rows[index - 1][0] + 1));
  const prices = new Map(rows);
  for (const [before, after] of [[10, 11], [13, 14.3], [45, 49.5], [50, 55], [51, 56.1], [61, 67.1], [99, 108.9], [100, 110]]) {
    assert.equal(prices.get(before), after);
  }
});

test('actual field handlers preserve clearing, decimal editing and replacement without a forced zero', () => {
  const edits = [];
  const input = fieldInput({ label: '금액', value: '12', onChange: value => edits.push(value) });
  let selected = false;
  input.props.onFocus({ currentTarget: { select() { selected = true; } } });
  assert.ok(selected);
  for (const value of ['', '0', '0.', '0.5', '', '9', '9.', '9.9', '009.9', 'abc']) input.props.onChange({ currentTarget: { value } });
  assert.deepEqual(edits, ['', '0', '0.', '0.5', '', '9', '9.', '9.9', '9.9']);
  assert.equal(calculatorNumber('9.9'), 9.9);
  assert.equal(calculatorNumber('.'), 0);
  assert.equal(normalizeCalculatorInput('1.5', true), null);
  assert.equal(normalizeCalculatorInput('05', true), '5');
});

test('calculator returns exactly four prices and generates the requested internal message', () => {
  const prices = calculatePriceGuide({ normalUnit: 10, discountUnit: 9, count: 5, vatSeparate: true }, 'after');
  assert.deepEqual(prices, { normalUnit: 11, normalTotal: 55, appliedUnit: 9.9, appliedTotal: 49.5 });
  assert.equal(createPriceGuideMessage(prices, 5), '정상가는 1회 11만원으로 5회 진행 시 55만원이고,\n5회로 진행하시면 1회 9.9만원, 총 49.5만원입니다.');
  const changed = calculatePriceGuide({ normalUnit: 20, discountUnit: 18, count: 3, vatSeparate: true }, 'after');
  assert.equal(changed.normalTotal, changed.normalUnit * 3);
  assert.equal(changed.appliedTotal, changed.appliedUnit * 3);
});

test('discount rates show both separate-VAT amounts and included-VAT payment', () => {
  const html = renderDiscounts(100);
  for (const [before, payment] of [[100, 110], [90, 99], [85, 93.5], [80, 88]]) {
    assert.ok(html.includes(`<dt>부가세 별도</dt><dd>${before}만원`));
    assert.ok(html.includes(`실제 결제 금액<small>부가세 포함</small></dt><dd>${payment}만원`));
  }
});

test('discount tab accepts 22 before VAT and shows both prices for all four rates without a VAT selector', () => {
  const html = renderDiscountPanel('22');
  for (const [before, payment] of [[22, 24.2], [19.8, 21.78], [18.7, 20.57], [17.6, 19.36]]) {
    assert.ok(html.includes(`<dt>부가세 별도</dt><dd>${before}만원`));
    assert.ok(html.includes(`실제 결제 금액<small>부가세 포함</small></dt><dd>${payment}만원`));
  }
  assert.equal((html.match(/<h3>/g) ?? []).length, 4);
  assert.equal((html.match(/<input /g) ?? []).length, 1);
  assert.match(html, /value="22"/);
  assert.doesNotMatch(html, /<button|<select|<dialog|pc-vat-basis/);
});


test('payment buttons select exactly one method and can switch through card, cash, transfer and mixed', () => {
  let method = '';
  const onChange = value => { method = value; };
  for (const [index, expected] of ['card', 'cash', 'transfer', 'mixed'].entries()) {
    const buttons = paymentMethodButtons({ method, onChange });
    assert.equal(buttons[index].props.type, 'button');
    buttons[index].props.onClick();
    assert.equal(method, expected);
    const updated = paymentMethodButtons({ method, onChange });
    assert.deepEqual(updated.map(button => button.props['aria-pressed']), updated.map((_, i) => i === index));
    const html = renderPaymentMethods({ method, onChange });
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /disabled/);
  }
});

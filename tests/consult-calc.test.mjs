import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { compareDiscount, formatWon, splitIncludedWon, splitVat, toWon, unitFromPackage } from '../src/app/consultCalc.ts';
import { calculatePrepaid, emptyPrepaidInput } from '../src/app/prepaid.ts';

const bundled = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server.browser';
      import { RoundResults, VatPanel, DiscountPanel, DiscountComparePanel, PrepaidPanel } from './src/app/components/PriceCalculator';
      export const rounds = (props) => renderToStaticMarkup(React.createElement(RoundResults, props));
      export const vat = (value, input) => renderToStaticMarkup(React.createElement(VatPanel, { value, input, onChange() {}, onInput() {} }));
      export const compare = (normal, discounted) => renderToStaticMarkup(React.createElement(DiscountPanel, { value: normal, onChange() {} },
        React.createElement(DiscountComparePanel, { normal, discounted, onChange() {} })));
      export const prepaid = (input) => renderToStaticMarkup(React.createElement(PrepaidPanel, { input, onChange() {} }));
    `,
    resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'consult-entry.tsx',
  },
  bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', logLevel: 'silent',
});
const ui = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const text = (html) => html.replace(/<dialog[\s\S]*?<\/dialog>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('VAT is added once to a separate amount and split once from an included amount', () => {
  assert.deepEqual(splitVat(100, 'separate'), { supply: 1000000, vat: 100000, total: 1100000 });
  assert.deepEqual(splitVat(110, 'included'), { supply: 1000000, vat: 100000, total: 1100000 });
  // 10만 원 VAT included: supply rounds to the won, VAT is the exact remainder.
  assert.deepEqual(splitVat(10, 'included'), { supply: 90909, vat: 9091, total: 100000 });
  for (const bad of [NaN, Infinity, -5, 0]) assert.deepEqual(splitVat(bad, 'separate'), { supply: 0, vat: 0, total: 0 });
  assert.deepEqual(splitIncludedWon(NaN), { supply: 0, vat: 0, total: 0 });
  assert.equal(formatWon(NaN), '0');
  assert.equal(toWon(-1), 0);
});

test('VAT tab shows supply, VAT and a won-exact final amount', () => {
  const included = text(ui.vat('10', 'included'));
  assert.match(included, /공급가액 9.09 만 원 부가세 \(10%\) 0.91 만 원 최종 금액 \(부가세 포함\) 100,000 원/);
  const separate = text(ui.vat('22', 'separate'));
  assert.match(separate, /공급가액 22 만 원 부가세 \(10%\) 2.2 만 원 최종 금액 \(부가세 포함\) 242,000 원/);
  assert.doesNotMatch(text(ui.vat('', 'separate')), /NaN|Infinity/);
});

test('a package total becomes the per-session discount price over the shared count', () => {
  assert.equal(unitFromPackage(100, 5), 20);
  assert.equal(unitFromPackage(100, 0), 0);
  assert.equal(unitFromPackage(NaN, 3), 0);
  const html = text(ui.rounds({ normalUnit: 30, discountUnit: unitFromPackage(100, 5), count: 5, vatSeparate: true }));
  assert.match(html, /5회 적용가 22만 원 × 5회 110만 원/);
  assert.match(html, /최종 결제금액 1,100,000 원 \(부가세 포함\) 부가세 별도 공급가 100만 원 \+ 부가세 10만 원/);
  // A package that does not divide evenly still charges the entered total, not a rounded unit.
  const uneven = text(ui.rounds({ normalUnit: 40, discountUnit: unitFromPackage(100, 3), count: 3, vatSeparate: true }));
  assert.match(uneven, /최종 결제금액 1,100,000 원/);
});

test('VAT-included rounds input is not taxed again', () => {
  const html = text(ui.rounds({ normalUnit: 11, discountUnit: 9.9, count: 5, vatSeparate: false }));
  assert.match(html, /최종 결제금액 495,000 원 \(부가세 포함\) 부가세 별도 공급가 45만 원 \+ 부가세 4.5만 원/);
});

test('discount check gives the amount and rate, and guards zero and higher prices', () => {
  assert.deepEqual(compareDiscount(22, 18.7), { normal: 220000, discounted: 187000, difference: 33000, rate: 15 });
  assert.equal(compareDiscount(0, 10).rate, null);
  const html = text(ui.compare('22', '18.7'));
  assert.match(html, /할인금액 3.3 만 원 할인율 15% 할인가 부가세 포함 20.57 만 원/);
  const higher = text(ui.compare('10', '12'));
  assert.match(higher, /차액 \(할인가가 높음\) 2 만 원 증가율 20%/);
  assert.doesNotMatch(text(ui.compare('', '')), /NaN|Infinity/);
});

// Values recorded from the calculator before this change. prepaid.ts is unchanged; these lock it.
test('prepaid results match the confirmed formula for new purchase, balance, deposit and receipt changes', () => {
  const pick = (input) => {
    const r = calculatePrepaid({ ...emptyPrepaidInput, ...input });
    return { applied: r.applied, payable: r.payable, collected: r.collected, receivable: r.receivable, remaining: r.remaining };
  };
  assert.deepEqual(pick({ tier: 300, normalPrice: '100' }), { applied: 900000, payable: 3000000, collected: 3000000, receivable: 0, remaining: 2100000 });
  assert.deepEqual(pick({ tier: 300, normalPrice: '100', hasDeposit: true }), { applied: 900000, payable: 2900000, collected: 0, receivable: 2900000, remaining: 0 });
  assert.deepEqual(pick({ tier: 300, normalPrice: '100', hasDeposit: true, deposit: '10', hasBalance: true, balance: '150' }), { applied: 900000, payable: 0, collected: 0, receivable: 0, remaining: 700000 });
  assert.deepEqual(pick({ tier: 300, normalPrice: '400' }), { applied: 3600000, payable: 3600000, collected: 3600000, receivable: 0, remaining: 0 });
  assert.deepEqual(pick({ tier: 300, normalPrice: '100', collected: '250' }), { applied: 900000, payable: 3000000, collected: 2500000, receivable: 500000, remaining: 1600000 });
});

test('prepaid shows the won-exact payment and the no-stacking rule without new inputs', () => {
  const html = ui.prepaid({ ...emptyPrepaidInput, normalPrice: '342.1' });
  assert.match(text(html), /결제 필요금액 3,078,900 원/);
  assert.match(text(html), /이벤트 할인, 기존 할인가, 리프팅 우대가, 재티켓팅 할인, 제모 결합할인과 중복 적용하지 않습니다/);
  const deposit = text(ui.prepaid({ ...emptyPrepaidInput, normalPrice: '100', hasDeposit: true }));
  assert.match(deposit, /미수금 290 만원/);
  assert.match(deposit, /결제 필요금액 \(예약금 차감 후\) 2,900,000 원/);
  assert.doesNotMatch(text(ui.prepaid(emptyPrepaidInput)), /결제 필요금액/);
});

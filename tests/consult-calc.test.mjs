import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { compareDiscount, formatWon, splitIncludedWon, splitVat, toWon, unitFromPackage } from '../src/app/consultCalc.ts';
import { calculateGeneral, discountUnitForRate, emptyGeneralInput, matchingQuickRate } from '../src/app/generalCalc.ts';
import { emptyPrepaidInput } from '../src/app/prepaid.ts';

const bundled = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server.browser';
      import { GeneralPanel, PrepaidPanel } from './src/app/components/PriceCalculator';
      export const general = (input) => renderToStaticMarkup(React.createElement(GeneralPanel, { input, onChange() {} }));
      export const generalTree = (input, onChange) => GeneralPanel({ input, onChange });
      export const prepaid = (input, method = '') => renderToStaticMarkup(React.createElement(PrepaidPanel, { input, onChange() {}, method, onMethod() {} }));
    `,
    resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'consult-entry.tsx',
  },
  bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', logLevel: 'silent',
});
const ui = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const text = (html) => html.replace(/<dialog[\s\S]*?<\/dialog>/g, '').replace(/<details[\s\S]*?<\/details>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const g = (extra) => ({ ...emptyGeneralInput, ...extra });

test('VAT is added once to a separate amount and split once from an included amount', () => {
  assert.deepEqual(splitVat(100, 'separate'), { supply: 1000000, vat: 100000, total: 1100000 });
  assert.deepEqual(splitVat(110, 'included'), { supply: 1000000, vat: 100000, total: 1100000 });
  assert.deepEqual(splitVat(10, 'included'), { supply: 90909, vat: 9091, total: 100000 });
  for (const bad of [NaN, Infinity, -5, 0]) assert.deepEqual(splitVat(bad, 'separate'), { supply: 0, vat: 0, total: 0 });
  assert.deepEqual(splitIncludedWon(NaN), { supply: 0, vat: 0, total: 0 });
  assert.equal(formatWon(NaN), '0');
  assert.equal(toWon(-1), 0);
  assert.equal(unitFromPackage(100, 5), 20);
  assert.deepEqual(compareDiscount(22, 18.7), { normal: 220000, discounted: 187000, difference: 33000, rate: 15 });
});

// 검증 1: 일반 금액 및 부가세 계산
test('general amount: totals, discount and VAT follow the confirmed formula', () => {
  const r = calculateGeneral(g({ normalUnit: '10', discountUnit: '9', count: '5', vat: 'separate' }));
  assert.deepEqual([r.normalTotal, r.discountTotal, r.discountAmount, r.rate], [500000, 450000, 50000, 10]);
  assert.deepEqual([r.normalPayment, r.discountPayment, r.finalPayment, r.supply, r.vat], [550000, 55000, 495000, 450000, 45000]);
  const included = calculateGeneral(g({ normalUnit: '11', discountUnit: '9.9', count: '5', vat: 'included' }));
  assert.deepEqual([included.normalPayment, included.finalPayment, included.supply, included.vat], [550000, 495000, 450000, 45000]);
  const html = text(ui.general(g({ normalUnit: '10', discountUnit: '9', count: '5' })));
  assert.match(html, /정상가 \(5회\) 550,000원/);
  assert.match(html, /할인금액 − 55,000원 \( ?10% ?\)/);
  assert.match(html, /최종 결제금액 495,000원 공급가 450,000원 \+ 부가세 45,000원/);
  assert.doesNotMatch(text(ui.general(emptyGeneralInput)), /NaN|Infinity/);
});

// 검증 2: 할인율 자동 적용 (버튼 → 할인가, 할인가 직접 입력 → 할인율)
test('quick discount rates fill the discount price and a typed price updates the rate', () => {
  assert.equal(discountUnitForRate('22', 10), '19.8');
  assert.equal(discountUnitForRate('22', 15), '18.7');
  assert.equal(discountUnitForRate('22', 20), '17.6');
  assert.equal(discountUnitForRate('', 10), '');
  assert.equal(matchingQuickRate({ normalUnit: '22', discountUnit: '' }), 0);
  assert.equal(matchingQuickRate({ normalUnit: '22', discountUnit: '18.7' }), 15);
  assert.equal(matchingQuickRate({ normalUnit: '22', discountUnit: '18' }), null);
  assert.equal(calculateGeneral(g({ normalUnit: '22', discountUnit: '18', count: '1' })).rate.toFixed(4), (4 / 22 * 100).toFixed(4));
  let next = null;
  const tree = ui.generalTree(g({ normalUnit: '22', count: '1' }), (value) => { next = value; });
  const buttons = JSON.stringify(tree, (key, value) => key === '_owner' ? undefined : value);
  assert.ok(buttons.includes('할인율 빠른 선택'));
  // 할인가가 높은 경우 할인이 아니라 차액으로 표시
  assert.match(text(ui.general(g({ normalUnit: '10', discountUnit: '12', count: '1' }))), /차액 \(할인가가 높음\) \+ 22,000원/);
  assert.equal(next, null);
});

test('prepaid panel shows two big results, the no-stacking rule and no old wording', () => {
  const both = { ...emptyPrepaidInput, tier: 300, balance: '15.29', normalPrice: '154' };
  const balance = text(ui.prepaid({ ...both, mode: 'balance' }));
  assert.match(balance, /오늘 받을 금액 1,233,100원 남은잔액 0원 잔액 0원 · 사용완료/);
  const purchase = text(ui.prepaid({ ...both, mode: 'purchase' }));
  assert.match(purchase, /오늘 받을 금액 3,000,000원 남은잔액 1,766,900원/);
  for (const html of [balance, purchase]) {
    assert.match(html, /이벤트 할인, 기존 할인가, 리프팅 우대가, 재티켓팅 할인, 제모 결합할인과 중복 적용하지 않습니다/);
    assert.doesNotMatch(html, /신규 충전|충전 있음|충전 없음|NaN/);
  }
  assert.match(purchase, /기존 잔액만 사용 선불권 추가 구매/);
  assert.doesNotMatch(text(ui.prepaid(emptyPrepaidInput)), /오늘 받을 금액 [\d,]+원/);
});

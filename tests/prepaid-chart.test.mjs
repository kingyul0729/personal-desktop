import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyPrepaidInput, calculatePrepaid, prepaidResultRows } from '../src/app/prepaid.ts';
import { createPrepaidChart, chartClipboardContent, copyChartContent } from '../src/app/prepaidChart.ts';

const input = extra => ({ ...emptyPrepaidInput, tier: 300, normalPrice: '180', ...extra });
const chart = (values, method = 'card') => chartClipboardContent(createPrepaidChart(calculatePrepaid(values), method).lines);

test('compact chart uses the shared result for new purchases, reservations and existing deductions', () => {
  const cases = [
    [{ normalPrice: '342.1' }, '300선불권 적용후 차액 7.89p 추가수납\n342.1p→307.89p 카 ok\n선불권제 사용완료'],
    [{ normalPrice: '341.2', hasDeposit: true, deposit: '11' }, '300선불권\n341.2p→307.08p\n예약금 11P 카 ok\n미수금 296.08P'],
    [{ normalPrice: '350', hasDeposit: true }, '300선불권\n350p→315p\n예약금 35P 카 ok\n미수금 280P'],
    [{ normalPrice: '341.2', hasBalance: true, balance: '11' }, '300선불권 적용후 차액 296.08p 추가수납\n341.2p→307.08p\n선불권에서 11p 차감\n당일수납 296.08P 카 ok\n선불권제 사용완료'],
    [{ normalPrice: '342.1', hasDeposit: true, deposit: '3', collected: '300' }, '300선불권\n342.1p→307.89p\n예약금 3P\n당일수납 300P 카 ok\n미수금 4.89P'],
    [{ tier: 500, normalPrice: '157.1125', hasBalance: true, balance: '257.12' }, '500선불권\n157.1125p→125.69p\n선불권에서 125.69p 차감\n남은 차액: 131.43P'],
    [{ tier: 400, normalPrice: '320', hasBalance: true, balance: '32', collected: '400' }, '400선불권 적용후 차액 240p 추가수납\n320p→272p\n선불권에서 32p 차감\n당일수납 400P 카 ok\n남은 차액: 160P'],
  ];
  for (const [extra, expected] of cases) {
    const result = Object.freeze(calculatePrepaid(input(extra)));
    const output = chartClipboardContent(createPrepaidChart(result, 'card').lines);
    assert.equal(output.text, expected);
    const remainingRow = prepaidResultRows(result).find(row => row.key === 'remaining');
    assert.equal(output.text.includes('선불권제 사용완료'), result.isUsageComplete);
    if (result.isUsageComplete) assert.equal(remainingRow.text, '선불권제 사용완료');
    if (remainingRow.value > 0) assert.ok(output.text.includes(`남은 차액: ${remainingRow.value / 10000}P`));
    assert.doesNotMatch(output.text, /신규 선불권|차액금|필요금액|누적|미수금 0P|예약금 0P|당일수납 0P|남은 차액: 0P/);
    if (result.showReceivable) assert.doesNotMatch(output.text, /추가수납|사용완료/);
  }
});

test('receipt wording and colors distinguish completion, remaining balance and reservation-only visits', () => {
  const completed = chart(input({ normalPrice: '342.1' }));
  assert.match(completed.html, /color:#c52222">300선불권/);
  assert.match(completed.html, /color:#111111"> 적용후 차액 7.89p 추가수납/);
  assert.match(completed.html, /color:#111111">342.1p→307.89p 카 ok/);
  assert.match(completed.html, /color:#c52222">선불권제 사용완료/);
  const reservation = chart(input({ normalPrice: '380', hasDeposit: true }));
  assert.match(reservation.html, /color:#111111">예약금 38P 카 ok/);
  assert.match(reservation.html, /color:#c52222">미수금 304P/);
  assert.doesNotMatch(reservation.text, /추가수납|사용완료|남은 차액/);
  const remainder = chart(input({ hasBalance: true, balance: '358', normalPrice: '22' }));
  assert.match(remainder.html, /color:#2168ce">남은 차액: 338.2P/);
  assert.doesNotMatch(remainder.text, /사용완료/);
});

test('all four payment methods update actual receipt or reservation text and enable copying', () => {
  for (const extra of [{ normalPrice: '' }, { collected: '.' }, { hasDeposit: true, deposit: '' }, { hasBalance: true, balance: '' }]) {
    assert.equal(createPrepaidChart(calculatePrepaid(input(extra)), 'card'), null);
  }
  for (const values of [input({ collected: '300' }), input({ normalPrice: '380', hasDeposit: true })]) {
    const result = calculatePrepaid(values);
    assert.equal(createPrepaidChart(result, '').canCopy, false);
    for (const [method, code] of [['card', '카 ok'], ['cash', '현금 ok'], ['transfer', '계좌 ok'], ['mixed', '복합 ok']]) {
      const draft = createPrepaidChart(result, method);
      assert.equal(draft.canCopy, true);
      const text = chartClipboardContent(draft.lines).text;
      assert.ok(text.includes(values.hasDeposit ? `예약금 38P ${code}` : `당일수납 300P ${code}`));
    }
  }
  const zero = createPrepaidChart(calculatePrepaid(input({ collected: '' })), '');
  assert.equal(zero.canCopy, true);
  assert.doesNotMatch(chartClipboardContent(zero.lines).text, /선불권제 사용완료|남은 차액/);
});

test('family chart text includes the entered parties and program without inventing patient data', () => {
  const result = Object.freeze(calculatePrepaid(input({ tier: 500, normalPrice: '157.1125', hasBalance: true, balance: '257.12' })));
  const context = { subject: '사용자A(차트A)', program: '프로그램 및 처방', familyShared: true, owner: '보유자B(차트B)' };
  const draft = createPrepaidChart(result, '', context);
  assert.equal(draft.canCopy, true);
  const output = chartClipboardContent(draft.lines);
  assert.match(output.text, /선불권 보유자: 보유자B\(차트B\)/);
  assert.match(output.text, /사용자A\(차트A\) 프로그램 및 처방, 선불권에서 125.69p 차감/);
  assert.match(output.html, /color:#2168ce">남은 차액: 131.43P/);
  assert.doesNotMatch(output.text, /사용완료|당일수납|미수금/);
  assert.equal(createPrepaidChart(result, '', { ...context, owner: '' }).canCopy, false);
  assert.equal(createPrepaidChart(result, '', { ...context, subject: '' }).canCopy, false);
  const escaped = chartClipboardContent(createPrepaidChart(result, '', { ...context, subject: '<b>입력 & 이름</b>' }).lines);
  assert.match(escaped.text, /<b>입력 & 이름<\/b>/);
  assert.match(escaped.html, /&lt;b&gt;입력 &amp; 이름&lt;\/b&gt;/);
  assert.doesNotMatch(chartClipboardContent(createPrepaidChart(result, '').lines).text, /사용자A|보유자B/);
});

test('rich clipboard carries identical plain wording and HTML colors, with a plain fallback', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalItem = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
  let written;
  class Item { constructor(parts) { this.parts = parts; } }
  try {
    Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: Item });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { async write(items) { written = items[0].parts; } } } });
    const content = chart(input({ tier: 300, normalPrice: '333.3333', hasDeposit: true, deposit: '3', collected: '291' }));
    assert.equal(await copyChartContent(content), 'rich');
    assert.equal(await written['text/plain'].text(), content.text);
    assert.equal(await written['text/html'].text(), content.html);
    let plain;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: {
      async write() { throw new Error('HTML unsupported'); }, async writeText(text) { plain = text; },
    } } });
    assert.equal(await copyChartContent(content), 'plain');
    assert.equal(plain, content.text);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else delete globalThis.navigator;
    if (originalItem) Object.defineProperty(globalThis, 'ClipboardItem', originalItem); else delete globalThis.ClipboardItem;
  }
});

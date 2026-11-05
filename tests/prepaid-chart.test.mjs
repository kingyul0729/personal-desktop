import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePrepaid, emptyPrepaidInput } from '../src/app/prepaid.ts';
import { chartClipboardContent, chartPaymentLabels, copyChartContent, createPrepaidChart } from '../src/app/prepaidChart.ts';

const input = extra => ({ ...emptyPrepaidInput, tier: 300, balance: '15.29', normalPrice: '154', ...extra });
const chart = (values, method = 'card', context) => createPrepaidChart(calculatePrepaid(values), method, context);
const text = (values, method = 'card', context) => chartClipboardContent(chart(values, method, context).lines).text;

test('required chart text for ① and ②', () => {
  assert.equal(text(input({ mode: 'balance' })), '300만원권\n차감 152,900원 · 추가 수납 1,233,100원 (카드)\n잔액 0원 · 사용완료');
  assert.equal(text(input({ mode: 'purchase' })), '300만원권\n차감 1,386,000원 · 추가 수납 3,000,000원 (카드)\n남은잔액 1,766,900원');
});

test('chart shows deposit, receivable, over-collection and shortfall only when they exist', () => {
  assert.equal(text(input({ balance: '200' }), ''), '300만원권\n차감 1,386,000원\n남은잔액 614,000원');
  assert.equal(text(input({ mode: 'purchase', hasDeposit: true })),
    '300만원권\n차감 1,386,000원 · 예약금 300,000원 · 추가 수납 2,700,000원 (카드)\n남은잔액 1,766,900원');
  assert.equal(text(input({ collected: '100' }), 'cash'),
    '300만원권\n차감 152,900원 · 추가 수납 1,000,000원 (현금)\n미수금 233,100원\n잔액 0원');
  assert.equal(text(input({ collected: '130' }), 'transfer'),
    '300만원권\n차감 152,900원 · 추가 수납 1,300,000원 (계좌이체)\n초과 수납 66,900원\n잔액 0원 · 사용완료');
  assert.equal(text(input({ mode: 'purchase', balance: '', normalPrice: '400' })),
    '300만원권\n차감 3,000,000원 · 추가 수납 3,000,000원 (카드)\n시술비 부족분 600,000원\n잔액 0원');
  for (const values of [input({ mode: 'balance' }), input({ mode: 'purchase' })]) assert.doesNotMatch(text(values), /신규 충전|충전/);
});

test('colors: title red, remaining blue, used-up red', () => {
  const lines = chart(input({ mode: 'purchase' })).lines;
  assert.equal(lines[0][0].tone, 'red');
  assert.equal(lines.at(-1)[0].tone, 'blue');
  assert.equal(chart(input({ mode: 'balance' })).lines.at(-1)[0].tone, 'red');
  assert.match(chartClipboardContent(lines).html, /color:#2168ce">남은잔액 1,766,900원/);
});

test('all four payment methods appear in the text; a collected amount needs a method before copying', () => {
  assert.deepEqual(Object.values(chartPaymentLabels), ['카드', '현금', '계좌이체', '복합']);
  for (const [method, label] of Object.entries(chartPaymentLabels)) {
    const c = chart(input({ mode: 'purchase' }), method);
    assert.ok(c.canCopy);
    assert.match(chartClipboardContent(c.lines).text, new RegExp(`추가 수납 3,000,000원 \\(${label}\\)`));
  }
  const noMethod = chart(input({ mode: 'purchase' }), '');
  assert.deepEqual([noMethod.needsPaymentMethod, noMethod.canCopy], [true, false]);
  assert.equal(chart(input({ balance: '200' }), '').canCopy, true);
  assert.equal(chart(input({ balance: '' })), null);
});

test('family-shared chart lists the owner and subject without inventing data', () => {
  const ctx = { subject: '딸 김○○', program: '여드름 관리', familyShared: true, owner: '어머니 박○○' };
  assert.equal(text(input({ mode: 'purchase' }), 'card', ctx),
    '300만원권\n선불권 보유자: 어머니 박○○\n딸 김○○ 여드름 관리\n차감 1,386,000원 · 추가 수납 3,000,000원 (카드)\n남은잔액 1,766,900원');
  assert.equal(chart(input({ mode: 'purchase' }), 'card', { ...ctx, owner: '' }).canCopy, false);
});

test('rich clipboard carries identical plain wording and HTML colors, with a plain fallback', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalItem = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
  let written;
  class Item { constructor(parts) { this.parts = parts; } }
  try {
    Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: Item });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { async write(items) { written = items[0].parts; } } } });
    const content = chartClipboardContent(chart(input({ mode: 'purchase', hasDeposit: true, deposit: '30' })).lines);
    assert.equal(await copyChartContent(content), 'rich');
    assert.equal(await written['text/plain'].text(), content.text);
    assert.equal(await written['text/html'].text(), content.html);
    let plain;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: {
      async write() { throw new Error('HTML unsupported'); }, async writeText(value) { plain = value; },
    } } });
    assert.equal(await copyChartContent(content), 'plain');
    assert.equal(plain, content.text);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else delete globalThis.navigator;
    if (originalItem) Object.defineProperty(globalThis, 'ClipboardItem', originalItem); else delete globalThis.ClipboardItem;
  }
});

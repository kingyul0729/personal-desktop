import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePrepaid, emptyPrepaidInput, enteredPrepaidAmount, formatWonAmount, settlePrepaidReceivable, suggestedDeposit, wonToManwonText } from '../src/app/prepaid.ts';

const input = extra => ({ ...emptyPrepaidInput, tier: 300, ...extra });
const pick = (r, keys) => Object.fromEntries(keys.map(k => [k, r[k]]));

// 필수 검증: 잔액 152,900원 · 정상가 1,540,000원 · 300만원권
test('required check ①: existing balance only → today 1,233,100 / remaining 0', () => {
  const r = calculatePrepaid(input({ mode: 'balance', balance: '15.29', normalPrice: '154' }));
  assert.deepEqual(pick(r, ['fee', 'today', 'remaining', 'deducted', 'ready', 'isUsageComplete']),
    { fee: 1386000, today: 1233100, remaining: 0, deducted: 152900, ready: true, isUsageComplete: true });
});

test('required check ②: add a voucher → today 3,000,000 / remaining 1,766,900', () => {
  const r = calculatePrepaid(input({ mode: 'purchase', balance: '15.29', normalPrice: '154' }));
  assert.deepEqual(pick(r, ['fee', 'purchase', 'today', 'remaining', 'deducted', 'shortfall']),
    { fee: 1386000, purchase: 3000000, today: 3000000, remaining: 1766900, deducted: 1386000, shortfall: 0 });
});

test('tiers fix the discount at 10/15/20% and the fee is rounded to the won without VAT', () => {
  assert.equal(calculatePrepaid(input({ mode: 'purchase', normalPrice: '100' })).fee, 900000);
  const t400 = calculatePrepaid(input({ mode: 'purchase', tier: 400, normalPrice: '100' }));
  assert.deepEqual([t400.fee, t400.today, t400.remaining], [850000, 4000000, 3150000]);
  const t500 = calculatePrepaid(input({ mode: 'purchase', tier: 500, normalPrice: '100' }));
  assert.deepEqual([t500.fee, t500.today, t500.remaining], [800000, 5000000, 4200000]);
  assert.equal(calculatePrepaid(input({ mode: 'purchase', normalPrice: '154.123' })).fee, 1387107);
});

test('① balance larger than the fee leaves the rest and collects nothing', () => {
  const r = calculatePrepaid(input({ balance: '200', normalPrice: '154' }));
  assert.deepEqual(pick(r, ['today', 'remaining', 'deducted', 'collected', 'receivable']),
    { today: 0, remaining: 614000, deducted: 1386000, collected: 0, receivable: 0 });
});

test('① needs an entered balance; ② treats a blank balance as 0', () => {
  assert.equal(calculatePrepaid(input({ normalPrice: '154' })).ready, false);
  assert.equal(calculatePrepaid(input({ balance: '.', normalPrice: '154' })).ready, false);
  assert.equal(calculatePrepaid(input({ mode: 'purchase', normalPrice: '154' })).ready, true);
  assert.equal(calculatePrepaid(input({ mode: 'purchase', normalPrice: '' })).ready, false);
});

test('deposit is optional, suggests 10% of the purchase and can be edited', () => {
  assert.equal(suggestedDeposit({ mode: 'purchase', tier: 300 }), 300000);
  assert.equal(suggestedDeposit({ mode: 'purchase', tier: 500 }), 500000);
  assert.equal(suggestedDeposit({ mode: 'balance', tier: 300 }), 0);
  const suggested = calculatePrepaid(input({ mode: 'purchase', normalPrice: '154', hasDeposit: true }));
  assert.deepEqual([suggested.deposit, suggested.depositIsSuggested, suggested.today], [300000, true, 2700000]);
  const edited = calculatePrepaid(input({ mode: 'purchase', normalPrice: '154', hasDeposit: true, deposit: '50' }));
  assert.deepEqual([edited.deposit, edited.depositIsSuggested, edited.today, edited.remaining], [500000, false, 2500000, 1614000]);
  const off = calculatePrepaid(input({ mode: 'purchase', normalPrice: '154', hasDeposit: false, deposit: '50' }));
  assert.equal(off.deposit, 0);
});

test('① deposit is subtracted once; a deposit above the amount due is shown as over-collected', () => {
  const r = calculatePrepaid(input({ balance: '15.29', normalPrice: '154', hasDeposit: true, deposit: '10' }));
  assert.deepEqual([r.today, r.remaining], [1133100, 0]);
  const over = calculatePrepaid(input({ balance: '15.29', normalPrice: '154', hasDeposit: true, deposit: '200' }));
  assert.deepEqual([over.today, over.overpaid, over.receivable], [0, 766900, 0]);
});

test('partial or excess actual receipts create 미수금 or 초과 수납 only when needed', () => {
  const full = calculatePrepaid(input({ balance: '15.29', normalPrice: '154' }));
  assert.deepEqual([full.receivable, full.overpaid, full.collectedIsAutomatic], [0, 0, true]);
  const partial = calculatePrepaid(input({ balance: '15.29', normalPrice: '154', collected: '100' }));
  assert.deepEqual([partial.collected, partial.receivable, partial.overpaid, partial.isUsageComplete], [1000000, 233100, 0, false]);
  const extra = calculatePrepaid(input({ balance: '15.29', normalPrice: '154', collected: '130' }));
  assert.deepEqual([extra.receivable, extra.overpaid], [0, 66900]);
  assert.equal(calculatePrepaid(input({ balance: '15.29', normalPrice: '154', collected: 'x' })).ready, false);
  assert.equal(settlePrepaidReceivable(233100, 100000), 133100);
  assert.equal(settlePrepaidReceivable(233100, 300000), 0);
});

test('② a fee larger than balance plus purchase is reported as a separate shortfall', () => {
  const r = calculatePrepaid(input({ mode: 'purchase', normalPrice: '400' }));
  assert.deepEqual(pick(r, ['fee', 'today', 'remaining', 'deducted', 'shortfall', 'isUsageComplete']),
    { fee: 3600000, today: 3000000, remaining: 0, deducted: 3000000, shortfall: 600000, isUsageComplete: false });
});

test('amount helpers accept only finished numbers and format whole won', () => {
  assert.equal(enteredPrepaidAmount('15.29'), 152900);
  assert.equal(enteredPrepaidAmount('.5'), 5000);
  for (const bad of ['', '.', '-1', '1e3', 'abc']) assert.equal(enteredPrepaidAmount(bad), null);
  assert.equal(formatWonAmount(1233100), '1,233,100원');
  assert.equal(formatWonAmount(-5), '0원');
  assert.equal(wonToManwonText(152900), '15.29');
});

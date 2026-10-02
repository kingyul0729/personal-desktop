import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePrepaid, emptyPrepaidInput, formatPrepaidAmount, prepaidResultRows, settlePrepaidReceivable } from '../src/app/prepaid.ts';
const input = (extra = {}) => ({ ...emptyPrepaidInput, tier: 300, normalPrice: '342.1', ...extra });
const won = n => Math.round(n * 10000);

test('new purchase separates voucher, excess, actual payment and remaining balance', () => {
  const r = calculatePrepaid(input());
  assert.deepEqual([r.applied, r.newPurchase, r.used, r.excess, r.payable, r.collected, r.receivable, r.remaining],
    [307.89, 300, 300, 7.89, 307.89, 307.89, 0, 0].map(won));
  assert.equal(r.startingBalance, 0);
  assert.equal(r.collectionIsAutomatic, true);
  const voucherOnly = calculatePrepaid(input({ collected: '300' }));
  assert.equal(voucherOnly.receivable, won(7.89));
  assert.equal(voucherOnly.remaining, 0);
});

test('existing voucher deducts only the applied program from its actual balance', () => {
  // This fixture yields the chart's already-discounted deduction of 125.69.
  const values = Object.freeze(input({ tier: 500, normalPrice: '157.1125', hasBalance: true, balance: '257.12', collected: '0' }));
  const r = calculatePrepaid(values);
  assert.deepEqual([r.applied, r.startingBalance, r.newPurchase, r.used, r.excess, r.payable, r.receivable, r.remaining],
    [125.69, 257.12, 0, 125.69, 0, 0, 0, 131.43].map(won));
  assert.equal(values.balance, '257.12');
  assert.equal(values.collected, '0');
});

test('tier fixes the discount at all prices and never adds funds to an existing voucher', () => {
  for (const [tier, percent] of [[300, 90], [400, 85], [500, 80]]) {
    for (const normal of [22, 320, 499, 500, 501, 600, 1000]) {
      const r = calculatePrepaid(input({ tier, normalPrice: String(normal), hasBalance: true, balance: '32' }));
      assert.equal(r.applied, Math.round(normal * 10000 * percent / 100));
      assert.equal(r.startingBalance, 320000);
      assert.equal(r.newPurchase, 0);
      assert.equal(r.payable, Math.max(0, r.applied - 320000));
      assert.equal(r.collected, r.payable);
    }
  }
});

test('new prepaid purchase below its face value retains only actually paid unused funds', () => {
  const paid = calculatePrepaid(input({ normalPrice: '180', collected: '300' }));
  assert.deepEqual([paid.applied, paid.payable, paid.receivable, paid.remaining], [162, 300, 0, 138].map(won));
  const automatic = calculatePrepaid(input({ normalPrice: '180' }));
  assert.deepEqual([automatic.collected, automatic.remaining], [300, 138].map(won));
  const unpaid = calculatePrepaid(input({ normalPrice: '180', collected: '0' }));
  assert.equal(unpaid.collected, 0);
  assert.equal(unpaid.receivable, won(300));
  assert.equal(unpaid.remaining, 0);
  // Existing mode with a spent (zero) balance is still not a new purchase.
  assert.equal(calculatePrepaid(input({ normalPrice: '180', hasBalance: true, balance: '0' })).newPurchase, 0);
});

test('an entered deposit overrides the default and is subtracted only once', () => {
  const values = input({ hasDeposit: true, deposit: '3' });
  const r = calculatePrepaid({ ...values, collected: '304.89' });
  assert.deepEqual([r.deposit, r.payable, r.receivable, r.remaining], [3, 304.89, 0, 0].map(won));
  const partial = calculatePrepaid({ ...values, collected: '300' });
  assert.equal(partial.receivable, won(4.89));
  assert.equal(settlePrepaidReceivable(partial.receivable, won(2)), won(2.89));
  assert.equal(settlePrepaidReceivable(won(2.89), won(3)), 0);
  assert.deepEqual(calculatePrepaid(input({ deposit: '100', balance: '500' })), calculatePrepaid(input()));
});

test('existing funds, partial and excess actual receipts settle without adding a tier', () => {
  const base = input({ tier: 400, normalPrice: '320', hasBalance: true, balance: '32' });
  for (const [collected, due, remaining] of [['100', 140, 0], ['240', 0, 0], ['400', 0, 160]]) {
    const r = calculatePrepaid({ ...base, collected });
    assert.deepEqual([r.applied, r.payable, r.receivable, r.remaining], [272, 240, due, remaining].map(won));
  }
  const deposit = calculatePrepaid({ ...base, hasDeposit: true, deposit: '52', collected: '188' });
  assert.equal(deposit.receivable, 0);
  assert.equal(deposit.remaining, 0);
});

test('manual receipts are preserved; invalid numbers cannot be copied as completed calculations', () => {
  const empty = calculatePrepaid(emptyPrepaidInput);
  assert.equal(empty.newPurchase, 0);
  assert.equal(empty.receivable, 0);
  assert.equal(empty.ready, false);
  for (const collected of ['', '0']) assert.equal(calculatePrepaid(input({ collected })).collected, 0);
  const incomplete = calculatePrepaid(input({ collected: '.' }));
  assert.equal(incomplete.collected, null);
  assert.equal(incomplete.receivable, null);
  assert.equal(incomplete.remaining, null);
  assert.equal(incomplete.ready, false);
  const r = calculatePrepaid(input({ normalPrice: '100.0001' }));
  assert.equal(formatPrepaidAmount(r.applied), '90.0001');
});

test('automatic full settlement follows price and tier while manual receipts remain explicit', () => {
  const automatic = input();
  for (const [changes, expected] of [[{}, 307.89], [{ normalPrice: '360' }, 324], [{ tier: 400 }, 400], [{ tier: 500 }, 500]]) {
    assert.equal(calculatePrepaid({ ...automatic, ...changes }).collected, won(expected));
  }
  for (const changes of [{}, { normalPrice: '360' }, { tier: 400 }]) {
    const values = Object.freeze({ ...automatic, ...changes, collected: '300' });
    assert.equal(calculatePrepaid(values).collected, won(300));
    assert.equal(values.collected, '300');
  }
  const depositOnly = calculatePrepaid({ ...automatic, hasDeposit: true, deposit: '3', collected: '0' });
  assert.deepEqual([depositOnly.collected, depositOnly.receivable, depositOnly.showReceivable], [0, won(304.89), true]);
  assert.equal(automatic.collected, null);
});

test('reservation-only stays unpaid while existing-balance settlement can default to 296.08', () => {
  for (const extra of [{ hasDeposit: true, deposit: '11' }, { hasBalance: true, balance: '11' }]) {
    const values = Object.freeze(input({ normalPrice: '341.2', ...extra }));
    const result = calculatePrepaid(values);
    assert.deepEqual([result.applied, result.payable, result.collected, result.receivable, result.remaining],
      [307.08, 296.08, extra.hasDeposit ? 0 : 296.08, extra.hasDeposit ? 296.08 : 0, 0].map(won));
    assert.equal(result.collectionIsAutomatic, !extra.hasDeposit);
    assert.equal(result.showReceivable, !!extra.hasDeposit);
    assert.equal(result.newPurchase, won(extra.hasBalance ? 0 : 300));
    assert.equal(result.excess, won(extra.hasBalance ? 296.08 : 7.08));
    assert.equal(values.collected, null);
    const partial = calculatePrepaid({ ...values, collected: '100' });
    assert.equal(partial.receivable, won(196.08));
    assert.equal(partial.showReceivable, !!extra.hasDeposit);
    const noReceipt = calculatePrepaid({ ...values, collected: '0' });
    assert.equal(noReceipt.receivable, won(296.08));
    assert.equal(noReceipt.remaining, 0);
  }
  const both = calculatePrepaid(input({ normalPrice: '341.2', hasDeposit: true, deposit: '11', hasBalance: true, balance: '11' }));
  assert.deepEqual([both.payable, both.collected, both.receivable, both.remaining], [285.08, 0, 285.08, 0].map(won));
  for (const extra of [{ hasDeposit: true, deposit: '' }, { hasBalance: true, balance: '.' }]) {
    const incomplete = calculatePrepaid(input(extra));
    assert.equal(incomplete.collectionIsAutomatic, false);
    assert.equal(incomplete.ready, false);
  }
});

test('reservation O defaults to 10% of normal price and keeps the rest unpaid until a real additional receipt', () => {
  const values = Object.freeze(input({ normalPrice: '350', hasDeposit: true }));
  const result = calculatePrepaid(values);
  assert.deepEqual([result.applied, result.deposit, result.payable, result.collected, result.receivable],
    [315, 35, 280, 0, 280].map(won));
  assert.equal(result.depositIsAutomatic, true);
  assert.equal(result.showReceivable, true);
  assert.equal(prepaidResultRows(result).some(row => row.key === 'collected'), false);
  assert.equal(prepaidResultRows(result).find(row => row.key === 'receivable').value, won(280));
  assert.equal(values.deposit, null);
  for (const [extra, deposit, outstanding] of [
    [{ normalPrice: '360' }, 36, 288],
    [{ tier: 400 }, 35, 365],
    [{ hasBalance: true, balance: '11' }, 35, 269],
    [{ deposit: '11' }, 11, 304],
    [{ collected: '100' }, 35, 180],
    [{ collected: '280' }, 35, 0],
  ]) {
    const changed = calculatePrepaid({ ...values, ...extra });
    assert.equal(changed.deposit, won(deposit));
    assert.equal(changed.receivable, won(outstanding));
  }
  const switchedOff = calculatePrepaid({ ...values, hasDeposit: false });
  assert.deepEqual([switchedOff.deposit, switchedOff.collected, switchedOff.receivable], [0, 315, 0].map(won));
  const roundToWon = calculatePrepaid({ ...values, normalPrice: '341.2345' });
  assert.equal(roundToWon.deposit, won(34.1235));
});

test('result rows distinguish new purchase and existing balance within the same card', () => {
  const r = calculatePrepaid(input({ collected: '307.89' }));
  assert.deepEqual(prepaidResultRows(r).map(row => [row.label, row.value]), [
    ['프로그램 정상가', won(342.1)], ['선불권 적용가', won(307.89)], ['선불권 금액', won(300)],
    ['차액 수납금액', won(7.89)], ['당일 수납금액', won(307.89)], ['남은 차액', null],
  ]);
  const existing = calculatePrepaid(input({ tier: 500, normalPrice: '157.1125', hasBalance: true, balance: '257.12' }));
  assert.deepEqual(prepaidResultRows(existing).map(row => row.label), [
    '프로그램 정상가', '선불권 적용가', '기존 선불권 잔액', '당일 수납금액', '남은 차액',
  ]);
});

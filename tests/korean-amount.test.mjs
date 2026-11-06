import assert from 'node:assert/strict';
import test from 'node:test';
import { readWon } from '../src/app/koreanAmount.ts';

test('amounts read in 만 units so nobody has to count digits', () => {
  assert.equal(readWon(1028500), '102만 8,500원');
  assert.equal(readWon(3000000), '300만원');
  assert.equal(readWon(152900), '15만 2,900원');
  assert.equal(readWon(1766900), '176만 6,900원');
  assert.equal(readWon(8500), '8,500원');
  assert.equal(readWon(0), '0원');
  assert.equal(readWon(150000000), '1억 5,000만원');
  assert.equal(readWon(123456789), '1억 2,345만 6,789원');
  assert.equal(readWon(NaN), '0원');
});

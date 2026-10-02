import { calculatorNumber } from './calculatorInput.ts';

export type PrepaidTier = 300 | 400 | 500;
export const prepaidDiscountRates: Record<PrepaidTier, number> = { 300: 10, 400: 15, 500: 20 };

export interface PrepaidInput {
  tier: PrepaidTier;
  normalPrice: string;
  hasDeposit: boolean;
  // null uses 10% of the normal program price; a string is a manual override.
  deposit: string | null;
  hasBalance: boolean;
  balance: string;
  // null: full settlement without a deposit, no extra receipt with a deposit.
  // A string preserves the staff's actual receipt, including zero.
  collected: string | null;
}

export const emptyPrepaidInput: PrepaidInput = {
  tier: 300, normalPrice: '', hasDeposit: false, deposit: null,
  hasBalance: false, balance: '', collected: null,
};

// Preserve whole-won rounding without changing the user's input text.
const toWon = (value: string) => Math.round(calculatorNumber(value) * 10000);

export function enteredPrepaidAmount(value: string): number | null {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
  const won = Math.round(Number(value) * 10000);
  return Number.isSafeInteger(won) && won >= 0 ? won : null;
}

// Later collections settle only an existing receivable, never the original deposit.
export function settlePrepaidReceivable(outstandingWon: number, newlyReceivedWon: number) {
  return Math.max(0, outstandingWon - newlyReceivedWon);
}

export function calculatePrepaid(input: PrepaidInput) {
  const hasProgramAmount = enteredPrepaidAmount(input.normalPrice) !== null;
  const normal = toWon(input.normalPrice);
  const basisAmount = input.tier * 10000;
  const discountRate = prepaidDiscountRates[input.tier];
  const applied = Math.round(normal * (100 - discountRate) / 100);

  // No existing voucher: purchase the selected voucher today.
  // Existing voucher: only the entered balance is available; never add the tier.
  const startingBalance = input.hasBalance ? toWon(input.balance) : 0;
  const newPurchase = input.hasBalance || !hasProgramAmount ? 0 : basisAmount;
  const available = input.hasBalance ? startingBalance : newPurchase;
  const used = Math.min(available, applied);
  const excess = Math.max(0, applied - available);
  const depositIsAutomatic = input.hasDeposit && input.deposit === null && hasProgramAmount;
  const deposit = input.hasDeposit
    ? input.deposit === null ? Math.round(normal / 10) : toWon(input.deposit)
    : 0;
  const payable = Math.max(0, newPurchase + excess - deposit);
  const fundingReady = hasProgramAmount
    && (!input.hasDeposit || depositIsAutomatic || (input.deposit !== null && enteredPrepaidAmount(input.deposit) !== null))
    && (!input.hasBalance || enteredPrepaidAmount(input.balance) !== null);
  // Reservation O means only the deposit has been received. Its outstanding
  // payment stays unpaid until staff explicitly enter an additional receipt.
  const collectionIsAutomatic = input.collected === null && !input.hasDeposit && fundingReady;
  const collected = collectionIsAutomatic ? payable
    : input.collected == null || input.collected === '' ? 0 : enteredPrepaidAmount(input.collected);
  const receivable = collected === null ? null : settlePrepaidReceivable(payable, collected);
  // Only funds actually held or received can remain after this program.
  // A planned new purchase does not create a paid balance by itself.
  const remaining = collected === null ? null : Math.max(0, startingBalance + deposit + collected - applied);
  const ready = fundingReady && collected !== null;
  // Clinic chart convention: only a received deposit can open a receivable entry.
  // Keep settlement arithmetic separate so hiding this entry never implies payment.
  const showReceivable = ready && input.hasDeposit && deposit > 0 && receivable !== null && receivable > 0;
  const isUsageComplete = ready && applied > 0 && remaining === 0 && receivable === 0;
  return { basisAmount, normal, applied, deposit, payable, collected, receivable, startingBalance,
    isExisting: input.hasBalance, hasDeposit: input.hasDeposit, newPurchase, used, excess, remaining,
    ready, showReceivable, collectionIsAutomatic, depositIsAutomatic, isUsageComplete };
}

export type PrepaidResult = ReturnType<typeof calculatePrepaid>;
export const formatPrepaidAmount = (won: number | null) => won === null ? '—' : (won / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 4 });

export interface PrepaidResultRow {
  key: string;
  label: string;
  value: number | null;
  text?: string;
  tone?: 'red' | 'blue';
}

export function prepaidResultRows(result: PrepaidResult): PrepaidResultRow[] {
  return [
    { key: 'normal', label: '프로그램 정상가', value: result.normal },
    { key: 'applied', label: '선불권 적용가', value: result.applied },
    { key: 'funding', label: result.isExisting ? '기존 선불권 잔액' : '선불권 금액', value: result.isExisting ? result.startingBalance : result.newPurchase },
    ...(result.excess > 0 ? [{ key: 'excess', label: '차액 수납금액', value: result.excess }] : []),
    ...(result.deposit > 0 ? [{ key: 'deposit', label: '예약금 수납', value: result.deposit }] : []),
    ...(!result.hasDeposit || (result.collected !== null && result.collected > 0)
      ? [{ key: 'collected', label: result.hasDeposit ? '추가 수납금액' : '당일 수납금액', value: result.collected }]
      : []),
    ...(result.showReceivable ? [{ key: 'receivable', label: '미수금', value: result.receivable }] : []),
    { key: 'remaining', label: '남은 차액',
      value: result.ready && result.remaining !== null && result.remaining > 0 ? result.remaining : null,
      ...(result.isUsageComplete ? { text: '선불권제 사용완료', tone: 'red' as const }
        : result.remaining !== null && result.remaining > 0 ? { tone: 'blue' as const } : {}) },
  ];
}

import { calculatorNumber } from './calculatorInput.ts';

// 선불권 P — 병원 확정 규칙 (2026-11-06 「최종 수정 프롬프트」)
// 시술비 = 이번 시술 정상가 × (1 − 할인율), 원 단위 반올림, 부가세 없음.
// ① 기존 잔액만 사용   오늘 받을 금액 = MAX(0, 시술비 − 기존 잔액 − 예약금)
//                      남은잔액       = MAX(0, 기존 잔액 − 시술비)
// ② 선불권 추가 구매   오늘 받을 금액 = MAX(0, 구매금액 − 예약금)
//                      남은잔액       = MAX(0, 기존 잔액 + 구매금액 − 시술비)
// 두 방식의 결과는 섞지 않는다. 입력은 만 원, 결과는 원.
export type PrepaidTier = 300 | 400 | 500;
export type PrepaidMode = 'balance' | 'purchase';
export const prepaidDiscountRates: Record<PrepaidTier, number> = { 300: 10, 400: 15, 500: 20 };
export const prepaidModeLabels: Record<PrepaidMode, string> = { balance: '기존 잔액만 사용', purchase: '선불권 추가 구매' };

export interface PrepaidInput {
  mode: PrepaidMode;
  tier: PrepaidTier;
  balance: string;       // 기존 잔액 (만 원). 추가 구매에서는 비우면 0원
  normalPrice: string;   // 이번 시술 정상가 (만 원)
  hasDeposit: boolean;   // 예약금은 선택사항
  deposit: string | null; // null: 선불권 구매금액의 10% 제안값, 문자열: 실제 받은 금액
  collected: string | null; // null: 오늘 받을 금액을 그대로 받음, 문자열: 실제 받은 금액(0 포함)
}

export const emptyPrepaidInput: PrepaidInput = {
  mode: 'balance', tier: 300, balance: '', normalPrice: '', hasDeposit: false, deposit: null, collected: null,
};

const toWon = (value: string) => Math.round(calculatorNumber(value) * 10000);

// 숫자로 끝까지 입력된 값만 금액으로 인정한다 ('.', '' 는 미완성).
export function enteredPrepaidAmount(value: string): number | null {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
  const won = Math.round(Number(value) * 10000);
  return Number.isSafeInteger(won) && won >= 0 ? won : null;
}

// 나중에 받은 금액은 남은 미수금만 줄인다.
export function settlePrepaidReceivable(outstandingWon: number, newlyReceivedWon: number) {
  return Math.max(0, outstandingWon - newlyReceivedWon);
}

// 예약금 기본 제안값: 선불권 구매금액의 10%. 기존 잔액만 쓸 때는 구매가 없으므로 직접 입력한다.
export function suggestedDeposit(input: Pick<PrepaidInput, 'mode' | 'tier'>) {
  return input.mode === 'purchase' ? Math.round(input.tier * 10000 / 10) : 0;
}

export function calculatePrepaid(input: PrepaidInput) {
  const isPurchase = input.mode === 'purchase';
  const discountRate = prepaidDiscountRates[input.tier];
  const tierAmount = input.tier * 10000;
  const hasPrice = enteredPrepaidAmount(input.normalPrice) !== null;
  const normal = toWon(input.normalPrice);
  const fee = Math.round(normal * (100 - discountRate) / 100);           // 시술비

  const balanceText = input.balance.trim();
  const balanceValid = isPurchase && balanceText === '' ? true : enteredPrepaidAmount(balanceText) !== null;
  const balance = balanceValid ? toWon(balanceText) : 0;                  // 기존 잔액
  const purchase = isPurchase ? tierAmount : 0;                           // 구매금액

  const depositIsSuggested = input.hasDeposit && input.deposit === null;
  const depositValid = !input.hasDeposit || depositIsSuggested || enteredPrepaidAmount(input.deposit ?? '') !== null;
  const deposit = !input.hasDeposit ? 0 : depositIsSuggested ? suggestedDeposit(input) : depositValid ? toWon(input.deposit!) : 0;

  // 확정 계산식
  const today = isPurchase ? Math.max(0, purchase - deposit) : Math.max(0, fee - balance - deposit);
  const remaining = isPurchase ? Math.max(0, balance + purchase - fee) : Math.max(0, balance - fee);
  // 선불권에서 실제로 쓴 금액 (차트의 '차감')
  const deducted = Math.min(fee, balance + purchase);
  // 추가 구매 후에도 시술비가 남으면(정상가가 매우 큰 경우) 확정식에는 없는 부족분 — 따로 알린다.
  const shortfall = isPurchase ? Math.max(0, fee - balance - purchase) : 0;
  // 예약금이 받을 금액보다 많았던 경우
  const depositExcess = isPurchase ? Math.max(0, deposit - purchase) : Math.max(0, deposit - Math.max(0, fee - balance));

  const inputsReady = hasPrice && balanceValid && depositValid && (isPurchase || balanceText !== '');
  const collectedIsAutomatic = input.collected === null;
  const collectedValue = collectedIsAutomatic ? today : enteredPrepaidAmount(input.collected!);
  const ready = inputsReady && collectedValue !== null;
  const collected = collectedValue ?? 0;                                  // 오늘 실제로 받은 금액
  const receivable = ready ? Math.max(0, today - collected) : 0;          // 미수금
  const overpaid = ready ? Math.max(0, collected - today) + depositExcess : 0; // 초과 수납
  const isUsageComplete = ready && fee > 0 && remaining === 0 && receivable === 0 && shortfall === 0;

  return {
    mode: input.mode, tier: input.tier, discountRate, tierAmount, normal, fee, balance, purchase,
    deposit, depositIsSuggested, today, remaining, deducted, shortfall,
    collected, collectedIsAutomatic, receivable, overpaid, ready, isUsageComplete,
  };
}

export type PrepaidResult = ReturnType<typeof calculatePrepaid>;
export const formatWonAmount = (won: number) => `${Math.max(0, Math.round(won)).toLocaleString('ko-KR')}원`;
// 입력칸(만 원)에 다시 넣을 때 쓰는 표기
export const wonToManwonText = (won: number) => String(Math.round(won) / 10000);

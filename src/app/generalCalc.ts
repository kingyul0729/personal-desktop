import { calculatorNumber } from './calculatorInput.ts';

// 일반 금액 계산 — 병원 확정 규칙 (2026-11-06)
//   정상가 총액 = 1회 정상가 × 횟수
//   할인가 총액 = 1회 할인가 × 횟수
//   할인금액   = 정상가 총액 − 할인가 총액
//   할인율     = 할인금액 ÷ 정상가 총액 × 100
//   부가세 별도 입력이면 10%를 더하고, 포함 입력이면 더하지 않는다.
// 입력은 만 원, 결과는 원 단위로 반올림한다.
export type VatBasis = 'separate' | 'included';
export const quickDiscountRates = [0, 10, 15, 20] as const;

export interface GeneralInput {
  normalUnit: string;
  discountUnit: string; // 비우면 정가(할인 없음)
  count: string;
  vat: VatBasis;
}

export const emptyGeneralInput: GeneralInput = { normalUnit: '', discountUnit: '', count: '', vat: 'separate' };

const won = (manwon: number) => Math.round(manwon * 10000);

export function calculateGeneral(input: GeneralInput) {
  const normalUnit = calculatorNumber(input.normalUnit);
  const discountUnit = input.discountUnit.trim() === '' ? normalUnit : calculatorNumber(input.discountUnit);
  const count = calculatorNumber(input.count);
  const normalTotal = won(normalUnit * count);
  const discountTotal = won(discountUnit * count);
  const discountAmount = normalTotal - discountTotal;
  const rate = normalTotal > 0 ? discountAmount / normalTotal * 100 : null;
  const factor = input.vat === 'separate' ? 1.1 : 1;
  // 표시 금액은 모두 결제 기준(부가세 포함)으로 맞춘다.
  const normalPayment = Math.round(normalTotal * factor);
  const finalPayment = Math.round(discountTotal * factor);
  const discountPayment = normalPayment - finalPayment;
  const supply = input.vat === 'separate' ? discountTotal : Math.round(finalPayment / 1.1);
  return {
    count, normalTotal, discountTotal, discountAmount, rate,
    normalPayment, discountPayment, finalPayment, supply, vat: finalPayment - supply,
    ready: normalUnit > 0 && count > 0,
  };
}

// 할인율 버튼 → 1회 할인가 (만 원 입력칸에 넣을 문자열, 원 단위 반올림)
export function discountUnitForRate(normalUnit: string, rate: number): string {
  const unit = calculatorNumber(normalUnit);
  if (!(unit > 0)) return '';
  return String(Math.round(unit * (100 - rate) / 100 * 10000) / 10000);
}

// 지금 입력된 할인가가 빠른 선택 할인율 중 어느 것과 같은지 (없으면 null)
export function matchingQuickRate(input: Pick<GeneralInput, 'normalUnit' | 'discountUnit'>): number | null {
  if (input.discountUnit.trim() === '') return 0;
  for (const rate of quickDiscountRates) if (discountUnitForRate(input.normalUnit, rate) === String(calculatorNumber(input.discountUnit))) return rate;
  return null;
}

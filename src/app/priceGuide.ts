export type VatView = 'before' | 'after';

export interface PriceGuideValues {
  normalUnit: number;
  normalTotal: number;
  appliedUnit: number;
  appliedTotal: number;
}

export interface PriceGuideInput {
  normalUnit: number;
  discountUnit: number;
  count: number;
  vatSeparate: boolean;
}

// Input VAT basis and display VAT basis are independent. Return only the four prices.
export function calculatePriceGuide(input: PriceGuideInput, view: VatView): PriceGuideValues {
  const multiplier = input.vatSeparate
    ? (view === 'after' ? 1.1 : 1)
    : (view === 'before' ? 1 / 1.1 : 1);
  const normalUnit = input.normalUnit * multiplier;
  const appliedUnit = input.discountUnit * multiplier;
  return {
    normalUnit,
    normalTotal: normalUnit * input.count,
    appliedUnit,
    appliedTotal: appliedUnit * input.count,
  };
}

export const formatGuideAmount = (value: number) => Number.isFinite(value)
  ? value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '0';

export function createPriceGuideMessage(prices: PriceGuideValues, count: number): string {
  const rounds = formatGuideAmount(count);
  return `정상가는 1회 ${formatGuideAmount(prices.normalUnit)}만원으로 ${rounds}회 진행 시 ${formatGuideAmount(prices.normalTotal)}만원이고,\n${rounds}회로 진행하시면 1회 ${formatGuideAmount(prices.appliedUnit)}만원, 총 ${formatGuideAmount(prices.appliedTotal)}만원입니다.`;
}

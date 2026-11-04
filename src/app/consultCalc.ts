// Helpers for the consultation calculator. Amounts are entered in 만 원 and settled in whole won,
// so the screen can round to 만 원 (two decimals) without changing what is charged.
export const WON_PER_MANWON = 10000;

// Invalid, negative or non-finite input never becomes a charge.
export const toWon = (manwon: number) => Number.isFinite(manwon) && manwon > 0 ? Math.round(manwon * WON_PER_MANWON) : 0;
export const wonToManwon = (won: number) => won / WON_PER_MANWON;
export const formatWon = (won: number) => (Number.isFinite(won) ? Math.max(0, Math.round(won)) : 0).toLocaleString('ko-KR');

// A package total is spread over the shared count; no count means no per-session price yet.
export function unitFromPackage(total: number, count: number): number {
  return Number.isFinite(total) && total > 0 && Number.isFinite(count) && count > 0 ? total / count : 0;
}

export type VatInput = 'separate' | 'included';
export interface VatSplit { supply: number; vat: number; total: number }

// VAT 10%. A separate amount adds VAT once; an included amount is split once. Never both.
export function splitVat(amount: number, input: VatInput): VatSplit {
  const won = toWon(amount);
  if (input === 'separate') {
    const vat = Math.round(won / 10);
    return { supply: won, vat, total: won + vat };
  }
  const supply = Math.round(won / 1.1);
  return { supply, vat: won - supply, total: won };
}

// Supply and VAT of a payment already known in whole won (VAT included).
export function splitIncludedWon(totalWon: number, supplyWon?: number): VatSplit {
  const total = Number.isFinite(totalWon) && totalWon > 0 ? Math.round(totalWon) : 0;
  const supply = supplyWon !== undefined && Number.isFinite(supplyWon) && supplyWon >= 0 && supplyWon <= total
    ? Math.round(supplyWon) : Math.round(total / 1.1);
  return { supply, vat: total - supply, total };
}

export interface DiscountCompare { normal: number; discounted: number; difference: number; rate: number | null }

// Discount amount and rate between two amounts on the same VAT basis.
// A negative difference means the second amount is higher (no discount).
export function compareDiscount(normalManwon: number, discountedManwon: number): DiscountCompare {
  const normal = toWon(normalManwon);
  const discounted = toWon(discountedManwon);
  const difference = normal - discounted;
  return { normal, discounted, difference, rate: normal > 0 ? difference / normal * 100 : null };
}

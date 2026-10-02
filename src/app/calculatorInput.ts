// Keep editing text separate from the numeric value used for calculation.
export function normalizeCalculatorInput(value: string, whole = false): string | null {
  if (!(whole ? /^\d*$/ : /^\d*(?:\.\d*)?$/).test(value)) return null;
  return value.replace(/^0+(?=\d)/, '');
}

export function calculatorNumber(value: string): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export const emptyCalculatorInputs = {
  normalUnit: '', discountUnit: '', count: '', vatBase: '', discountBase: '',
};

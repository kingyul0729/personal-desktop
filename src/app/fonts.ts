// Fonts bundled in public/fonts (Korean, Latin and common symbols only). The ids match the
// server's list; null means the default font.
export const FONTS = [
  { id: 'bccard', label: 'BC카드체', family: 'PD BC Card' },
  { id: 'beomseok-neo', label: '휴먼범석네오', family: 'PD Beomseok Neo' },
  { id: 'adultkid', label: '어른아이', family: 'PD Adultkid' },
  { id: 'nanum-sinhonbubu', label: '나눔손글씨 신혼부부', family: 'PD Nanum SinHonBuBu' },
] as const;
export type FontId = typeof FONTS[number]['id'];
export const fontFamily = (id: string | null) => FONTS.find(font => font.id === id)?.family ?? null;

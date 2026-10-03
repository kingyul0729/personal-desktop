// Fonts bundled in public/fonts. The ids match the server's list; null means the default font.
// The first four are subset to Korean, Latin and common symbols; the Griun fonts are served as
// the original files because their license does not allow modifying them.
export const FONTS = [
  { id: 'bccard', label: 'BC카드체', family: 'PD BC Card' },
  { id: 'beomseok-neo', label: '휴먼범석네오', family: 'PD Beomseok Neo' },
  { id: 'adultkid', label: '어른아이', family: 'PD Adultkid' },
  { id: 'nanum-sinhonbubu', label: '나눔손글씨 신혼부부', family: 'PD Nanum SinHonBuBu' },
  { id: 'griun-everyday-jeong', label: '그리운 정매일체', family: 'PD Griun EverydayJeong' },
  { id: 'griun-myoeun-heullim', label: '그리운 묘은흘림체', family: 'PD Griun MyoeunHeullim' },
  { id: 'griun-bbangsim', label: '그리운X국한박 빵심', family: 'PD Griun Bbangsim' },
  { id: 'griun-mongtori', label: '그리운 몽토리체', family: 'PD Griun Mongtori' },
] as const;
export type FontId = typeof FONTS[number]['id'];
export const fontFamily = (id: string | null) => FONTS.find(font => font.id === id)?.family ?? null;

// 흑자 개별 제거 비교(2026-11-27 사용자): 색소 탭의 크기별 흑자 프로그램('흑자 제거 (1cm 이하)' 등, 1개당 금액)을
// 고르기 목록에서 '흑자 개별 제거' 하나로 묶고, 크기별 개수를 정하면 등록된 1개당 금액 × 개수의 합이 총액.
// 레이저 회차는 등록된 구성 그대로(개수만큼 곱하지 않음). PICO 532 흑자 제거는 'PICO 532 · 흑자 제거' 한 줄로 비교 —
// 스페셜 토닝 03·04 '추가 관리'(얼굴 전체 CO₂ 또는 흑자 PICO 532)는 흑자 비교일 때 이 줄에 '얼굴 전체'로.
// 금액은 모두 등록된 price_programs 값만 쓴다(고정 금액 없음).
export type LItem = { name: string; qty: number | null; label?: string };
export type LProgram = { id: string; category: string; name: string; price: number | null; items: LItem[]; line?: string; desc?: string; fit?: string };
export type LSize = { id: string; size: string; price: number; items: LItem[]; desc?: string };

export const LENTIGO_ID = 'lentigo';
export const LENTIGO_NAME = '흑자 개별 제거';
export const PICO_ROW = 'PICO 532 · 흑자 제거';
const SIZE_RE = /^흑자 제거\s*\((.+)\)$/;
const isPico = (name: string) => /532/.test(name) && !/\+/.test(name);

export const lentigoSizes = (list: LProgram[]): LSize[] => list
  .map(p => { const m = p.name.match(SIZE_RE); return m && p.price != null ? { id: p.id, size: m[1], price: p.price, items: p.items, desc: p.desc } : null; })
  .filter((x): x is LSize => !!x)
  .sort((x, y) => x.price - y.price);

export const lentigoCount = (counts: Record<string, number>) => Object.values(counts).reduce((s, n) => s + (n > 0 ? n : 0), 0);

// 크기별 개수 → 가상 프로그램(총액 = Σ 1개당 금액 × 개수, 구성은 가장 작은 크기 프로그램의 등록 구성)
export function lentigoProgram(sizes: LSize[], counts: Record<string, number>, category = '색소'): LProgram | null {
  if (!sizes.length) return null;
  const n = lentigoCount(counts);
  const price = sizes.reduce((s, z) => s + z.price * Math.max(0, counts[z.id] ?? 0), 0);
  const items = sizes[0].items.map(i => (isPico(i.name) ? { name: PICO_ROW, qty: null, label: `선택한 흑자 ${n}개` } : i));
  if (!items.some(i => i.name === PICO_ROW)) items.unshift({ name: PICO_ROW, qty: null, label: `선택한 흑자 ${n}개` });
  return { id: LENTIGO_ID, category, name: LENTIGO_NAME, price, items, desc: sizes[0].desc };
}

// '1cm 이하 · 33만원 × 3 + 1cm 초과 ~ 2cm 이하 · 44만원 × 1'용 줄
export const lentigoParts = (sizes: LSize[], counts: Record<string, number>) => sizes.filter(z => (counts[z.id] ?? 0) > 0).map(z => ({ size: z.size, price: z.price, n: counts[z.id] }));

// 흑자 비교일 때 상대 프로그램: 추가 관리(얼굴 전체 CO₂ / 흑자 PICO 532)는 PICO 532 줄에 '얼굴 전체', 단독 PICO 532 항목도 같은 줄로
export const withPicoRow = (p: LProgram): LProgram => ({
  ...p,
  items: p.items.map(i => (i.name === '추가 관리' || /흑자\s*PICO\s*532/.test(i.name) ? { name: PICO_ROW, qty: null, label: '얼굴 전체' } : isPico(i.name) ? { ...i, name: PICO_ROW } : i)),
});

// 추가 금액이 들어간 상품은 등록된 최종 금액 그대로 — 카드 아래 '기본 N + 추가 M' 풀이만(같은 이름의 기본 프로그램이 있을 때)
export function extraSplit(p: LProgram, list: LProgram[]): { base: number; extra: number } | null {
  const m = p.name.match(/^(.+?)\s+추가 관리/);
  const base = m ? list.find(x => x.name === m[1]) : undefined;
  return base?.price != null && p.price != null ? { base: base.price, extra: p.price - base.price } : null;
}

// 고르기 목록: 크기별 흑자 프로그램 자리에 '흑자 개별 제거' 하나
export function withLentigo<T extends LProgram>(list: T[], virtual: T | null): T[] {
  if (!virtual) return list;
  const first = list.findIndex(p => SIZE_RE.test(p.name));
  const rest = list.filter(p => !SIZE_RE.test(p.name));
  const at = list.slice(0, first).filter(p => !SIZE_RE.test(p.name)).length;
  return [...rest.slice(0, at), virtual, ...rest.slice(at)];
}

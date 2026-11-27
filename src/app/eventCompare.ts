// 이벤트 비교(2026-11-28 사용자 문서): 프로그램 비교에서 '이벤트' 탭을 고르면
// 왼쪽 = 이벤트 상품(등록 가격·구성 그대로, 옵션은 같은 이벤트의 다른 등록 줄),
// 오른쪽 = 전체 프로그램 중 하나 + 300·400·500만원권 할인(정가 × (1 − 할인율) 한 번, 원 단위 반올림).
// 이벤트 가격에는 선결제권 할인을 붙이지 않고, 두 쪽은 서로 따로 움직인다.
// 이벤트 옵션은 이름 끝 대괄호로 등록: '올리지오 600샷 패키지 [힐로웨이브 2cc]' · '… [리투오 5cc]' —
// 옵션마다 등록 금액·구성이 따로 있어 추가금을 한 번만 반영하고, 기본으로 돌아오면 기본 금액 그대로.
import { prepaidDiscountRates, type PrepaidTier } from './prepaid.ts';
import type { Cell, CompareRow } from './programCompare.ts';

export const EVENT_CAT = '이벤트';
export const TIERS: PrepaidTier[] = [300, 400, 500];
type P = { id: string; category: string; name: string; price: number | null };

export type EventGroup<T extends P> = { base: string; options: { label: string; program: T }[] };
export function eventGroups<T extends P>(programs: T[]): EventGroup<T>[] {
  const out: EventGroup<T>[] = [];
  for (const p of programs) {
    if (p.category !== EVENT_CAT) continue;
    const m = p.name.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
    const base = (m ? m[1] : p.name).trim(), label = m ? m[2].trim() : '';
    let g = out.find(x => x.base === base);
    if (!g) out.push(g = { base, options: [] });
    g.options.push({ label, program: p });
  }
  return out;
}

// 할인은 늘 등록 정가에서 한 번 — 권종을 바꿔도 쌓이지 않음
export const tierPrice = (price: number | null, tier: PrepaidTier) => (price == null ? null : Math.round(price * (1 - prepaidDiscountRates[tier] / 100)));

// '포함'과 '1회', '600샷'과 '1회'처럼 단위가 다르거나 횟수가 안 적힌 칸은 차이로 단정하지 않음 — 한쪽에 아예 없거나(—) 같은 단위로 수가 다를 때만
const unit = (c: string) => { const m = c.match(/^(\d+(?:\.\d+)?)\s*(\D*)$/); return m ? { n: Number(m[1]), u: m[2].trim() } : null; };
export function cellDiff(c: Cell | null, o: Cell | null): boolean {
  if (!c || !o) return !!c !== !!o;
  if (c.count === o.count) return false;
  const x = unit(c.count), y = unit(o.count);
  return !!x && !!y && x.u === y.u && x.n !== y.n;
}
export const sameAll = (rows: CompareRow[]) => rows.length > 0 && rows.every(r => r.same);

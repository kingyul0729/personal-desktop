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
type P = { id: string; category: string; name: string; price: number | null; line?: string; fit?: string };

export type EventGroup<T extends P> = { base: string; sub: string; options: { label: string; program: T }[] };
export function eventGroups<T extends P>(programs: T[]): EventGroup<T>[] {
  const out: EventGroup<T>[] = [];
  for (const p of programs) {
    if (p.category !== EVENT_CAT) continue;
    const m = p.name.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
    const base = (m ? m[1] : p.name).trim(), label = m ? m[2].trim() : '';
    let g = out.find(x => x.base === base);
    if (!g) out.push(g = { base, sub: p.fit?.trim() ?? '', options: [] });
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
export const sameAll = (rows: CompareRow[]) => rows.length > 0 && rows.every(r => !rowDiff(r));

// 만원 단위 표시(2026-11-28 사용자 '양쪽 가격은 모두 만원, 반올림·자릿수 버리기 없이'): 원 계산값 그대로 ÷ 10000 — 93.5만원 · 123.45만원
export const manwon = (n: number | null) => (n == null ? '—' : `${(n / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 4 })}만원`);

// 차이로 볼 줄: 횟수가 같은 단위로 다르거나 한쪽에만 있거나 작은 줄(+ 추가 시술 등)이 다를 때 — '포함'·'1회'처럼 상세 정도만 다른 줄은 아님
export const rowDiff = (r: CompareRow) => !r.same && (cellDiff(r.a, r.b) || (r.a?.subs ?? []).join('|') !== (r.b?.subs ?? []).join('|'));

// 리프팅(이벤트 포함)의 LDM 트리플·스킨보톡스·스킨부스터는 횟수 대신 '포함'(없으면 —) — 2026-11-28 사용자
export const INCLUDE_ONLY = /LDM\s*트리플|스킨\s*보톡스|스킨\s*부스터/;
export function includeOnly(rows: CompareRow[]): CompareRow[] {
  return rows.map(r => {
    if (!INCLUDE_ONLY.test(r.name)) return r;
    const a = r.a ? { count: '포함', subs: [] } : null, b = r.b ? { count: '포함', subs: [] } : null;
    return { ...r, a, b, same: !!a === !!b };
  });
}

// 달 이벤트 묶음·숨김(2026-11-28 사용자 '삭제보다는 숨김, 달 이벤트로 묶어서' · '너 맘대로 하지 말고 내가 할 수 있게'): 이벤트 프로그램의 line = 달 묶음('11월 EVENT'),
// 그 라인의 feature = 기간 글자(표시용, 저절로 숨기지 않음), fit = '숨김'이면 사용자가 숨긴 달 — 자료는 그대로. 프로그램 fit = 'EVENT 01 …' 소제목(고르기 묶음)
type L = { category: string; name: string; feature: string; fit: string };
export const HIDDEN = '숨김';
export function liveEvents<T extends P>(programs: T[], lines: L[]): { months: string[]; hidden: string[]; list: T[] } {
  const off = new Set(lines.filter(l => l.category === EVENT_CAT && l.fit === HIDDEN).map(l => l.name));
  const all = programs.filter(p => p.category === EVENT_CAT);
  const names = Array.from(new Set(all.map(p => p.line ?? '')));
  return { months: names.filter(m => !off.has(m)), hidden: names.filter(m => off.has(m)), list: all };
}

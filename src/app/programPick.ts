// 프로그램 고르기 팝업 묶기(2026-11-29 사용자 — 기본 드롭다운 대신 흰 선택 팝업): 이름만 보고 나눔, 등록된 프로그램만
// ① 묶음(cat, 예: 탭·이벤트 소제목 — 둘 이상일 때만) ② 시술 종류(이름에서 첫 '숫자회·샷·cc' 앞) ③ 일반 / 리프팅 고객(이름 끝 '· 리프팅 고객 …') ④ 나머지 글자
export type PickOption = { id: string; name: string; cat?: string };
export type PickItem = PickOption & { cat: string; kind: string; lift: boolean; doc: string; label: string };

const LIFT = /\s*·\s*리프팅 고객.*$/;
const DOC = /\s*\(([^()]*원장님)\)\s*$/; // 원장님별 가격은 '대표 원장님 / 부원장님' 고르기로
// 종류 = 첫 '숫자회·샷·cc·개' 앞(리바이브 | 1회 + LDM 트리플 1회), '스페셜 토닝 | 03 …'처럼 두 자리 번호 앞, 'LDM 트리플 관리 | (10회)'처럼 괄호 횟수 앞
const KIND = [/^(.+?)\s+(\d+(?:\.\d+)?\s?(?:회|샷|cc|개)(?=$|[\s+·(]).*)$/, /^(.+?)\s+(\d{2}(?=$|\s).*)$/, /^(.+?)\s+(\(\d+회\).*)$/];

export function pickItems(options: PickOption[]): PickItem[] {
  const raw = options.map(o => {
    const lift = LIFT.test(o.name), n0 = o.name.replace(LIFT, '').trim();
    const dm = n0.match(DOC), n = n0.replace(DOC, '').trim();
    const m = KIND.map(r => n.match(r)).find(Boolean);
    return { ...o, cat: o.cat ?? '', kind: m ? m[1].trim() : n, lift, doc: dm ? dm[1] : '', full: n, label: m ? m[2].trim() : '' };
  });
  // 종류마다 하나뿐이면 종류로 나누지 않음(그냥 목록), 종류 안 하나뿐인 것은 종류 이름을 글자로
  const count = new Map<string, number>();
  raw.forEach(r => count.set(`${r.cat}\u0000${r.kind}`, (count.get(`${r.cat}\u0000${r.kind}`) ?? 0) + 1));
  const grouped = [...count.values()].some(v => v > 1);
  return raw.map(r => {
    const solo = count.get(`${r.cat}\u0000${r.kind}`) === 1;
    const { full, ...x } = r;
    if (!grouped) return { ...x, kind: '', label: full };
    return { ...x, label: r.label && !solo ? r.label : full, kind: solo ? '' : r.kind };
  });
}

export const uniq = <T,>(xs: T[]) => Array.from(new Set(xs));

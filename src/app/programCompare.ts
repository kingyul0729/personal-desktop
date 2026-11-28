// 프로그램 비교 줄 만들기(2026-11-26 밤 사용자 공통 기준, 저장 자료는 그대로 — 화면 표시만):
// ① 같은 시술·관리 조합은 한 줄, 두 프로그램이 같이 하는 조합은 가운데 이름에 묶어 적음
// ② 한쪽에만 더해지는 레이저·관리는 그쪽 횟수 아래 '+ 이름'
// ③ 관리(LDM 트리플·비타민 관리)는 레이저에서 떼어 맨 아래 따로 한 줄(총횟수), 단독·병행이 함께면 아래 세부('○○ 병행 5 · 단독 5')
// ④ 서비스(이름 끝 'S.V'·'S/V')는 같은 시술 줄에서 'N회' 아래 '서비스'(2026-11-28 사용자 'S/V·S.V·서비스 → 서비스 통일')
// ⑤ 시술 이름 끝 '(부분)'·'(전체)'는 횟수 아래 작은 줄('카프리 레이저 2회 / 부분') — 2026-11-28 사용자
// 특정 프로그램 이름을 보지 않고 시술 이름만으로 정함 — 어떤 두 프로그램이든 같은 규칙.
export type CompareItem = { name: string; qty: number | null; label?: string };
type Entry = { note?: string; tokens: string[]; qty: number | null; label?: string; service: boolean; sv: string[]; solo: boolean; detail?: string };
export type Cell = { count: string; subs: string[] };
export type CompareRow = { name: string; a: Cell | null; b: Cell | null; same: boolean };

const CARE = new Set(['LDM 트리플', '비타민 관리']); // 레이저와 함께 하는 관리
// 관리·기본 시술(압출·스케일링·진정관리)만 겹치는 조합끼리는 한 줄로 묶지 않음 — 2026-11-28 사용자 '압출 + 스케일링 / 압출 + 카프리 레이저 + 스케일링은 따로'
const SUPPORT = new Set([...CARE, '압출', '스케일링', '진정관리']);
const SV = /\s+S\s?[./]?\s?V\.?$/i;
const NOTE = /\s*\((부분|전체|얼굴 전체)\)\s*$/;
const norm = (t: string) => (t === '비타민' ? '비타민 관리' : /^LDM 트리플( 단독)?( 관리)?$/.test(t) ? 'LDM 트리플' : t);
const countText = (e: { qty: number | null; label?: string }) => (e.qty != null ? `${e.qty}회` : e.label || '포함');
const svOwn = (e: Entry, extra: string[]) => e.service && e.sv.some(t => !extra.includes(t));
const countOf = (e: Entry) => countText(e);
const sumInto = (to: Entry, x: { qty: number | null; label?: string }) => {
  if (to.qty != null && x.qty != null) to.qty += x.qty;
  else if (to.qty == null && x.qty != null) { to.qty = x.qty; delete to.label; }
};

export function entriesOf(items: CompareItem[] = []): Entry[] {
  const raw: Entry[] = [];
  for (const it of items) {
    let service = false;
    const sv: string[] = [];
    const nm = it.name.match(NOTE);
    const note = nm ? (nm[1] === '얼굴 전체' ? '전체' : nm[1]) : undefined;
    const tokens = it.name.replace(NOTE, '').split(/\s*\+\s*/).map(t => t.trim()).filter(Boolean).map(t => {
      const s = SV.test(t);
      if (s) { service = true; t = t.replace(SV, ''); }
      t = norm(t);
      if (s) sv.push(t);
      return t;
    });
    if (!tokens.length) continue;
    raw.push({ ...(note ? { note } : {}), tokens, qty: it.qty, ...(it.qty == null ? { label: it.label || '포함' } : {}), service, sv, solo: !service && tokens.length === 1 && CARE.has(tokens[0]) }); // 서비스(S.V) 관리는 '단독' 아님 — 리프팅 'LDM 트리플 S.V'
  }
  // ③ 관리(LDM 트리플·비타민 관리)는 함께 하는 레이저에서 떼어 따로 한 줄(총횟수) — 2026-11-26 밤 사용자 그림('시술구성 표 방식'),
  //    단독과 병행이 같이 있으면 아래 세부('○○ 병행 5 · 단독 5'), 단독만이면 '단독'
  const careRows: Entry[] = [];
  for (const care of CARE) {
    const solo = raw.filter(e => e.solo && e.tokens[0] === care);
    const paired = raw.filter(e => !e.solo && e.tokens.length > 1 && e.tokens.includes(care));
    if (!paired.length) continue;
    const all = [...solo, ...paired];
    const total = all.every(e => e.qty != null) ? all.reduce((s, e) => s + (e.qty ?? 0), 0) : null;
    const soloQty = solo.reduce((s, e) => s + (e.qty ?? 0), 0);
    const detail = solo.length && total != null ? [...paired.map(e => `${e.tokens.filter(t => t !== care).join(' + ')} 병행 ${e.qty}`), `단독 ${soloQty}`].join(' · ') : undefined;
    careRows.push({ tokens: [care], qty: total, ...(total == null ? { label: '포함' } : {}), service: false, sv: [], solo: false, ...(detail ? { detail } : {}) });
    for (const e of paired) e.tokens = e.tokens.filter(t => t !== care);
    for (const e of solo) raw.splice(raw.indexOf(e), 1);
  }
  raw.push(...careRows);
  // 같은 조합(+서비스 여부)은 한 줄로, 횟수 더함
  const out: Entry[] = [];
  for (const e of raw) {
    const key = [...e.tokens].sort().join('|');
    const has = out.find(o => !o.detail && !e.detail && o.service === e.service && o.solo === e.solo && o.note === e.note && [...o.tokens].sort().join('|') === key);
    if (has) sumInto(has, e); else out.push({ ...e, tokens: [...e.tokens] });
  }
  return out;
}

const subsOf = (e: Entry, extra: string[]) => [
  ...extra.map(t => `+ ${t}${e.sv.includes(t) ? ' 서비스' : ''}`), // 한쪽에만 더해진 시술의 S.V는 이름 옆 '서비스'(2026-11-28 사용자 통일)
  ...(svOwn(e, extra) ? ['서비스'] : []),
  ...(e.note ? [e.note] : []), // 관리의 병행·단독 세부 줄은 없앰(2026-11-28 사용자 그림 — 총횟수만)
];
const cellText = (c: Cell | null) => (c ? [c.count, ...c.subs].join('/') : '—');

// 두 프로그램 줄 맞추기: 같은 조합 먼저, 그다음 레이저·시술이 가장 많이 겹치는 것끼리(관리만 겹치는 것은 묶지 않음)
export function compareRows(aItems?: CompareItem[], bItems?: CompareItem[], opts: { split?: boolean } = {}): CompareRow[] {
  const A = entriesOf(aItems), B = entriesOf(bItems);
  const pairOf = new Map<number, number>(), usedB = new Set<number>();
  const keyOf = (e: Entry) => `${[...e.tokens].sort().join('|')}#${e.solo ? 's' : ''}${e.detail ? 'd' : ''}`;
  A.forEach((e, i) => { const j = B.findIndex((x, k) => !usedB.has(k) && keyOf(x) === keyOf(e) && x.service === e.service); if (j >= 0) { pairOf.set(i, j); usedB.add(j); } });
  A.forEach((e, i) => { const j = B.findIndex((x, k) => !usedB.has(k) && keyOf(x) === keyOf(e)); if (!pairOf.has(i) && j >= 0) { pairOf.set(i, j); usedB.add(j); } });
  const cands: { i: number; j: number; score: number }[] = [];
  A.forEach((e, i) => { if (pairOf.has(i)) return; B.forEach((x, j) => {
    if (usedB.has(j) || !!e.note !== !!x.note) return; // '(부분)'·'(전체)'가 붙은 추가 시술은 같은 이름끼리만 한 줄
    const common = e.tokens.filter(t => x.tokens.includes(t));
    const core = common.filter(t => !SUPPORT.has(t));
    const careOnly = common.length > 0 && core.length === 0 && e.tokens.every(t => SUPPORT.has(t)) && x.tokens.every(t => SUPPORT.has(t));
    if (core.length || careOnly) cands.push({ i, j, score: common.length * 10 - (e.tokens.length + x.tokens.length - 2 * common.length) });
  }); });
  cands.sort((p, q) => q.score - p.score || p.i - q.i || p.j - q.j);
  for (const c of cands) if (!pairOf.has(c.i) && !usedB.has(c.j)) { pairOf.set(c.i, c.j); usedB.add(c.j); }

  type R = { name: string; a: Cell | null; b: Cell | null };
  const rows: (R & { bi?: number })[] = A.flatMap((e, i): (R & { bi?: number })[] => {
    const j = pairOf.get(i);
    // split(흉터 탭, 2026-11-27 사용자 '각각 따로'): 한쪽에만 더해진 시술이나 S.V가 있으면 시술마다 한 줄, S.V는 횟수 아래 '(S.V)'
    if (opts.split && j != null) {
      const x = B[j];
      if (e.tokens.join('|') !== x.tokens.join('|') || e.sv.length || x.sv.length) {
        const all = [...e.tokens, ...x.tokens.filter(t => !e.tokens.includes(t))];
        const cell = (en: Entry, t: string): Cell | null => (en.tokens.includes(t) ? { count: countText(en), subs: en.sv.includes(t) ? ['서비스'] : [] } : null);
        return all.map((t, k) => ({ name: t, a: cell(e, t), b: cell(x, t), bi: j }));
      }
    }
    if (j == null) return [{ name: e.tokens.join(' + '), a: { count: countOf(e), subs: subsOf(e, []) }, b: null }];
    const x = B[j], common = e.tokens.filter(t => x.tokens.includes(t));
    return [{ name: common.join(' + '), a: { count: countOf(e), subs: subsOf(e, e.tokens.filter(t => !common.includes(t))) },
      b: { count: countOf(x), subs: subsOf(x, x.tokens.filter(t => !common.includes(t))) }, bi: j }];
  });
  // B에만 있는 줄은 B에서 바로 앞 줄 다음에 — 두 프로그램 순서를 모두 지킴
  B.forEach((x, j) => {
    if (usedB.has(j)) return;
    let at = 0; for (let k = j - 1; k >= 0; k--) { let r = -1; rows.forEach((row, n) => { if (row.bi === k) r = n; }); if (r >= 0) { at = r + 1; break; } }
    if (at === 0) { const n = rows.findIndex(row => row.bi != null && row.bi > j); at = n < 0 ? rows.length : n; } // 앞에 B 줄이 없으면 다음 B 줄 바로 앞(A에만 있는 윗줄 아래)
    rows.splice(at, 0, { name: x.tokens.join(' + '), a: null, b: { count: countOf(x), subs: subsOf(x, []) }, bi: j });
  });
  // 관리 줄은 늘 맨 아래(사용자 그림)
  const isCare = (r: R) => CARE.has(r.name);
  const ordered = [...rows.filter(r => !isCare(r)), ...rows.filter(isCare)];
  return ordered.map(({ name, a, b }) => ({ name, a, b, same: cellText(a) === cellText(b) }));
}

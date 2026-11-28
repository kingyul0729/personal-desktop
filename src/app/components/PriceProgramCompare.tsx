import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Minus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { KittyDialog } from './KittyDialog';
import { askConfirm } from './AlertDialog';
import { SavingMark } from './Feedback';
import { compareRows, type Cell } from '../programCompare';
import { EVENT_CAT, PREPAID_CAT, HIDDEN, TIERS, cellDiff, eventGroups, includeOnly, liveEvents, manwon, rowDiff, sameAll, tierPrice } from '../eventCompare';
import { prepaidDiscountRates, type PrepaidTier } from '../prepaid';
import { LENTIGO_ID, PICO_ROW, addonPair, lentigoCount, lentigoProgram, lentigoSizes, lentigoTotal, picoQty, withLentigo, withPicoRow } from '../lentigoCompare';

// 프로그램 비교(2026-11-26 사용자 그림·밤 공통 기준, 상담용): 탭 고르기 → 가운데 제목 → 프로그램 카드 둘(이름 = 고르기, 가격 알약, 라인이 다르면 라인 이름표 —
// 두 카드 같은 층 높이·같은 색) → 시술 구성(A 횟수 | 시술 항목 | B 횟수, 줄 만들기는 programCompare.ts) → 안내 한 줄 → 맨 아래 '프로그램 특징'(desc) 좌우.
// 가격 차이 상자·추천 순위·우수 표시·할인율은 넣지 않는다.
// 숫자는 가격표 그림이 아니라 price_programs(앱에서 적거나 파일로 넣음).
export type ProgramItem = { name: string; qty: number | null; label?: string };
export type Program = { id: string; category: string; name: string; price: number | null; items: ProgramItem[]; line?: string; desc?: string; fit?: string };
export type ProgramLine = { id: string; category: string; name: string; feature: string; fit: string };
export type ProgramData = { programs: Program[]; lines: ProgramLine[] };
export const emptyPrograms: ProgramData = { programs: [], lines: [] };

const asData = (d: Partial<ProgramData> | null): ProgramData => ({ programs: d?.programs ?? [], lines: d?.lines ?? [] });
export async function loadPrograms(): Promise<ProgramData> {
  const r = await fetch('/api/price-programs', { cache: 'no-store' });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d) throw new Error(d?.error || '프로그램을 불러오지 못했어요.');
  return asData(d);
}
export async function sendPrograms(body: unknown): Promise<ProgramData> {
  const r = await fetch('/api/price-programs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d) throw new Error(d?.error || '저장하지 못했어요.');
  return asData(d);
}
export const won = manwon; // 비교 화면 금액은 모두 만원 단위(2026-11-28 사용자)
export function ProgramCompare() {
  const [data, setData] = useState<ProgramData | null>(null);
  const programs = data?.programs ?? null;
  const [error, setError] = useState('');
  const [cat, setCat] = useState(() => { try { return localStorage.getItem('price-compare-cat') || ''; } catch { return ''; } });
  const [pick, setPick] = useState<[string, string]>(['', '']);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [setting, setSetting] = useState(false);
  useEffect(() => { loadPrograms().then(setData).catch(e => setError((e as Error).message)); }, []);
  const cats = useMemo(() => { const c = Array.from(new Set((programs ?? []).map(p => p.category))); return c.length ? [...c, PREPAID_CAT] : c; }, [programs]); // '선결제' = 정가 | 선결제권 할인 비교(2026-11-28 사용자 '선결제 비교 탭 추가')
  const category = cats.includes(cat) ? cat : cats[0] ?? '';
  useEffect(() => { if (category) { try { localStorage.setItem('price-compare-cat', category); } catch { /* 이 기기 편의 */ } } }, [category]);
  const raw = (programs ?? []).filter(p => p.category === category);
  // 흑자 제거(2026-11-27 사용자): 크기별 흑자 프로그램을 '흑자 제거' 하나로 — 크기별 개수 × 등록된 1개당 금액
  const sizes = lentigoSizes(raw);
  const cnt = sizes.length && !lentigoCount(counts) ? { [sizes[0].id]: 1 } : counts;
  const lentigo = lentigoProgram(sizes, cnt, category) as Program | null;
  const list = withLentigo(raw, lentigo);
  // 리프팅도 왼쪽·오른쪽 모두 전체 프로그램에서 고름(2026-11-28 사용자 '다 보여주는 걸로' — 11-27의 단독 | 조합 나누기 대체)
  // 국산·수입 라인이 둘 다 있는 탭(보톡스·필러, 2026-11-28 사용자 '고정으로 각각 국산 수입'): 왼쪽은 국산, 오른쪽은 수입 — 왼쪽을 바꾸면 오른쪽은 같은 시술의 수입 제품으로
  const kr = (p: Program) => /국산/.test(p.line ?? ''), im = (p: Program) => /수입/.test(p.line ?? '');
  const origin = list.some(kr) && list.some(im);
  const baseOf = (p?: Program) => (p?.name ?? '').replace(/\s*\([^()]*\)$/, '');
  const listA = origin ? list.filter(kr) : list;
  const listB = origin ? list.filter(im) : list;
  const a = listA.find(p => p.id === pick[0]) ?? listA[0];
  const b = listB.find(p => p.id === pick[1]) ?? (origin ? listB.find(p => baseOf(p) === baseOf(a)) ?? listB[0] : listB === list ? list[1] ?? list[0] : listB[0]);
  // 라인 요약은 서로 다른 라인끼리 비교할 때만(2026-11-26 사용자 '다른 라인끼리면 라인 요약도')
  const lineDiff = !!a?.line && !!b?.line && a.line !== b.line;
  // 구성 없는 프로그램끼리(보톡스, 2026-11-27 사용자 그림): 시술 구성 상자·카드 라인 이름표 없이, 설명 제목 = 시술 이름 + 라인 이름, 마지막 설명 묶음(톡신 설명)에 밑줄
  const noItems = !a?.items?.length && !b?.items?.length && a?.id !== LENTIGO_ID && b?.id !== LENTIGO_ID;
  const choose = (i: 0 | 1, id: string) => setPick(() => { const n: [string, string] = [a?.id ?? '', b?.id ?? '']; n[i] = id; if (origin && i === 0) n[1] = ''; return n; });

  if (error) return <div className="pb-empty">{error}</div>;
  if (!programs) return <div className="pb-empty"><SavingMark /></div>;
  if (category === PREPAID_CAT) return <PrepaidCompare programs={programs} cats={cats} onCat={c => { setCat(c); setPick(['', '']); }} />;
  if (category === EVENT_CAT) return <EventCompare programs={programs} lines={data?.lines ?? []} onData={setData} cats={cats} onCat={c => { setCat(c); setPick(['', '']); }} />;
  if (!list.length) return <div className="pb-empty">기록 없음</div>;
  const lmode = a?.id === LENTIGO_ID || b?.id === LENTIGO_ID;
  // 흑자 비교에서 스페셜 토닝 기본형을 고르면 등록된 '추가 관리(1개)'(PICO 532 흑자 제거 추가) 상품으로 보여 줌 — 금액을 따로 더하지 않음
  const eff = (p?: Program) => { if (!p || !lmode || p.id === LENTIGO_ID) return p; const ap = addonPair(p, raw); return ap && p.id === ap.base.id ? ap.plus as Program : p; };
  const view = (p?: Program) => (p && lmode && p.id !== LENTIGO_ID ? withPicoRow(p) as Program : p);
  const sel = [a?.id ?? '', b?.id ?? ''];
  const pair = [eff(a), eff(b)] as const;
  const rows0 = compareRows(view(pair[0])?.items, view(pair[1])?.items, { split: category === '흉터' });
  const allRows = lmode ? [...rows0.filter(r => r.name === PICO_ROW), ...rows0.filter(r => r.name !== PICO_ROW)] : rows0; // 흑자 비교는 PICO 532 줄을 맨 위로
  const step = (id: string, d: number) => setCounts(() => { const n = { ...cnt, [id]: Math.max(0, (cnt[id] ?? 0) + d) }; return lentigoCount(n) ? n : cnt; });
  // 흑자 비교 제목: 이름 + 작은 줄(카드 = 'PICO 532 · 흑자 N개' / 'PICO 532 흑자 제거 추가', 표 머리 = '선택한 흑자 N개' / 'PICO 532 추가')
  const addN = (p?: Program) => { const m = p?.name.match(/추가 관리\((\d+)개\)/); return m ? Number(m[1]) : 0; };
  const title = (p?: Program, card = false) => {
    if (p?.id === LENTIGO_ID) return (card ? <>{p.name}</> : <>{p.name}<small className="pc-sub">선택한 흑자 {lentigoCount(cnt)}개</small></>);
    const n = lmode ? addN(p) : 0;
    if (n) return <>{nameParts(p!.name.replace(/\s+추가 관리.*$/, ''))}<small className="pc-sub">{card ? `PICO 532 흑자 제거${n > 1 ? ` ${n}개` : ''} 추가` : `PICO 532${n > 1 ? ` ${n}개` : ''} 추가`}</small></>;
    return nameView(p?.name);
  };
  const lt = lentigoTotal(sizes, cnt); // 정상 총액 · 할인율 · 할인 금액 · 최종(5개 이상은 null)
  // 총액 차이 = 두 최종 금액(둘 다 부가세 포함 등록 금액 기준), 흑자 할인 기준이 없으면(5개 이상) 숨김
  const gap = lmode && pair[0]?.price != null && pair[1]?.price != null ? Math.abs(pair[0].price - pair[1].price) : null;
  // PICO 532 줄: 흑자 쪽 'N개' 아래 'N회', 토닝 쪽 '얼굴 전체' 아래 '추가 금액 반영'
  const pq = picoQty(sizes);
  const fixPico = (c: Cell | null, p?: Program) => (!c ? c : p?.id === LENTIGO_ID ? { count: pq != null ? `${pq}회` : c.count, subs: [`(${lentigoCount(cnt)}개)`] } : { count: `${addN(p) || 1}회`, subs: [`(${c.count})`] });
  const allRows2 = lmode ? allRows.map(r => (r.name === PICO_ROW ? { ...r, a: fixPico(r.a, pair[0]), b: fixPico(r.b, pair[1]) } : r)) : allRows;
  const allRows3 = category === '리프팅' ? includeOnly(allRows2) : allRows2;
  const rows = onlyDiff ? allRows3.filter(rowDiff) : allRows3;
  // 다른 것만 강조: 횟수는 상대 칸과 다를 때만, 작은 줄(+ 추가 시술 등)은 상대 칸에 없을 때만 — 좌우 같은 색
  // 다른 것만 강조(2026-11-27 사용자 그림): 횟수가 다르면 양쪽 칸 모두('—' 포함) 같은 연한 바탕, 같은 횟수는 기본 — 한쪽에만 있는 작은 줄(+ 추가 시술 등)만 작은 연한 바탕
  const tcell = (c: Cell | null, o: Cell | null) => { const diff = cellDiff(c, o); /* '포함'·'1회'처럼 상세 정도만 다른 칸은 차이 아님 */ return <td><div className={diff ? 'pct-v is-d' : 'pct-v'}>{c ? <><b>{c.count}</b>{c.subs.map((t, k) => <small key={k} className={o?.subs.includes(t) ? undefined : 'is-d'}>{t}</small>)}</> : <b className="is-none">—</b>}</div></td>; };
  const eng = CAT_EN[category];
  return <div className="pc-wrap">
    <div className="pcz">
      <div className="pcz-top">
        <label className="pc-cat"><select value={category} aria-label="탭" onChange={e => { setCat(e.target.value); setPick(['', '']); }}>{cats.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
      </div>
      <header className="pcz-title">{eng && <small>{eng} PROGRAM</small>}<h3><i />{category} 프로그램 비교<i /></h3></header>
      <div className="pcz-two">
        {pair.map((p, i) => <div key={i} className={`pcz-card ${i ? "is-b" : "is-a"}`}>
          <label className="pcz-pick"><b>{title(p, true)}</b><ChevronDown size={18} /><select value={sel[i]} aria-label={`프로그램 ${i + 1}`} onChange={e => choose(i as 0 | 1, e.target.value)}>{(i ? listB : listA).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <div className="pcz-price">{p?.id === LENTIGO_ID && lt.final == null ? <strong className="is-check">할인 기준 확인 필요</strong> : <><strong>{won(p?.price ?? null)}</strong><small>부가세 포함</small></>}</div>
          {p?.id === LENTIGO_ID ? <div className="pcz-note">
            {lt.off ? <span>할인 {Math.round((lt.rate ?? 0) * 100)}% −{won(lt.off)}</span> : null}
            <button type="button" className="pcz-set" aria-expanded={setting} onClick={() => setSetting(v => !v)}>개수·크기 설정</button>
          </div> : null}
          <div className="pcz-feat">{lineDiff && p?.line && !noItems ? <span className="pcz-tag">{p.line}</span> : null}</div>
        </div>)}
      </div>
      {lmode && setting && <section className="pcz-box pcz-cnt">
        <div className="pcz-head"><h4>크기별 흑자 개수</h4><button type="button" className="pcz-done" onClick={() => setSetting(false)}>완료</button></div>
        {sizes.map(z => <div key={z.id} className="pcz-cnt-row">
          <span>{z.size}</span><em>{won(z.price)}</em>
          <button type="button" aria-label={`${z.size} 빼기`} onClick={() => step(z.id, -1)}><Minus size={15} /></button>
          <b>{cnt[z.id] ?? 0}</b>
          <button type="button" aria-label={`${z.size} 더하기`} onClick={() => step(z.id, 1)}><Plus size={15} /></button></div>)}
        <p className="pcz-cnt-sum">전체 {lt.n}개 · {lt.rate == null ? '할인 기준 확인 필요' : lt.rate ? `할인 ${Math.round(lt.rate * 100)}%` : '할인 없음'}</p>
      </section>}
      {gap != null && <p className="pcz-gap">{gap ? <><b>{won(gap)}</b> 추가 수납</> : '추가 수납 없음'}</p>}
      {/* 구성이 없는 프로그램끼리(보톡스: 제품 차이 설명만, 2026-11-27 사용자)는 시술 구성 상자를 안 보임 */}
      {(pair[0]?.items?.length || pair[1]?.items?.length) ? <section className="pcz-box">
        <div className="pcz-head"><h4>시술 구성</h4>
          <label className="pc-only"><input type="checkbox" checked={onlyDiff} onChange={e => setOnlyDiff(e.target.checked)} /> 차이만 보기</label></div>
        <table className="pct">
          <colgroup><col className="pct-n" /><col /><col className="pct-n" /></colgroup>
          <thead><tr><th className="is-a">{title(pair[0])}</th><th>시술 항목</th><th className="is-b">{title(pair[1])}</th></tr></thead>
          <tbody>
            {rows.map((r, k) => <tr key={k} className={rowDiff(r) ? "is-d" : undefined}>{tcell(r.a, r.b)}<th scope="row">{lmode && r.name === PICO_ROW ? `${r.name} (흑자 제거)` : r.name}</th>{tcell(r.b, r.a)}</tr>)}
            {!rows.length && <tr><td colSpan={3} className="is-empty">구성 같음</td></tr>}
          </tbody>
        </table>
      </section> : null}
      {pair.some(p => p?.desc) && <section className="pcz-box pcz-desc pcz-desc2">
        {pair.map((p, i) => <div key={i} className={i ? "is-b" : "is-a"}><h5>{noItems && p?.line ? <>{nameParts(p.name.replace(/\s*\([^()]*\)$/, ''))} <span className="pc-nw">{p.line}</span></> : title(p)}</h5>{p?.desc ? descView(p.desc, noItems) : <p className="is-empty">—</p>}</div>)}
      </section>}
    </div>
  </div>;
}
// 이벤트 비교(2026-11-28 사용자 문서 · 그림): '이벤트' 탭을 고르면 왼쪽 이벤트 상품(등록 가격·구성·옵션 그대로) | 오른쪽 전체 프로그램 + 300·400·500만원권 할인 가격
// 두 쪽은 따로 — 권종만 바꾸면 가격만, 상품을 바꾸면 구성표도. 할인율·할인 금액·계산식은 화면에 안 보임. 계산은 eventCompare.ts
function EventCompare({ programs, lines, onData, cats, onCat }: { programs: Program[]; lines: ProgramLine[]; onData: (d: ProgramData) => void; cats: string[]; onCat: (c: string) => void }) {
  const live = useMemo(() => liveEvents(programs, lines), [programs, lines]); // 숨긴 달은 사용자가 [숨기기]로만(자료는 그대로)
  const [month, setMonth] = useState(''); const [busy, setBusy] = useState(false);
  const mon = [...live.months, ...live.hidden].includes(month) ? month : live.months[live.months.length - 1] ?? '';
  const monLine = lines.find(l => l.category === EVENT_CAT && l.name === mon);
  const isHidden = live.hidden.includes(mon);
  const toggleHide = async () => {
    if (!mon || busy) return;
    setBusy(true);
    try {
      onData(await sendPrograms({ action: 'save-line', id: monLine?.id, category: EVENT_CAT, name: mon, feature: monLine?.feature ?? '', fit: isHidden ? '' : HIDDEN }));
      if (!isHidden) setMonth('');
    } catch (e) { void askConfirm({ title: (e as Error).message, ok: '확인' }); } finally { setBusy(false); }
  };
  const groups = useMemo(() => eventGroups(live.list.filter(p => (p.line ?? '') === mon)), [live, mon]);
  const subs = Array.from(new Set(groups.map(x => x.sub)));
  const others = useMemo(() => programs.filter(p => p.category !== EVENT_CAT), [programs]);
  const otherCats = Array.from(new Set(others.map(p => p.category)));
  const [ev, setEv] = useState(''); const [opt, setOpt] = useState(0);
  const [pid, setPid] = useState(''); const [tier, setTier] = useState<PrepaidTier | 0>(300); // 0 = 정가(2026-11-28 사용자 시안 2 — 할인 없는 일반 가격)
  const [onlyDiff, setOnlyDiff] = useState(false);
  const g = groups.find(x => x.base === ev) ?? groups[0];
  const o = g?.options[opt] ?? g?.options[0];
  const a = o?.program, b = others.find(p => p.id === pid) ?? others[0];
  const base0 = g?.options[0]?.program.price ?? null;
  const optText = (x: { label: string; program: Program }, k: number) => `${x.label || '기본'}${k === 0 ? (g!.options.some(y => y.program.price !== base0) ? ' · 기본' : '') : x.program.price != null && base0 != null && x.program.price !== base0 ? ` · ${x.program.price > base0 ? '+' : '−'}${won(Math.abs(x.program.price - base0))}` : ''}`;
  const rows0 = compareRows(a?.items, b?.items).map(r => ({ ...r, a: r.a && { ...r.a, subs: r.a.subs.filter(t => t !== '단독') }, b: r.b && { ...r.b, subs: r.b.subs.filter(t => t !== '단독') } })); // 이벤트 비교는 '단독' 글자 없이(2026-11-28 사용자)
  const allRows = b?.category === '리프팅' ? includeOnly(rows0) : rows0; // 리프팅과 비교할 때 LDM 트리플·스킨보톡스·스킨부스터는 '포함'
  const same = sameAll(allRows);
  const rows = onlyDiff ? allRows.filter(rowDiff) : allRows;
  const cell = (c: Cell | null, x: Cell | null) => <td><div className={cellDiff(c, x) ? 'pct-v is-d' : 'pct-v'}>{c ? <><b>{c.count}</b>{c.subs.map((t, k) => <small key={k} className={x?.subs.includes(t) ? undefined : 'is-d'}>{t}</small>)}</> : <b className="is-none">—</b>}</div></td>;
  return <div className="pc-wrap">
    <div className="pcz pcz-ev">
      <div className="pcz-top">
        <label className="pc-cat"><select value={EVENT_CAT} aria-label="탭" onChange={e => onCat(e.target.value)}>{cats.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
        {mon || live.hidden.length ? <label className="pc-cat"><select value={mon} aria-label="달" onChange={e => { setMonth(e.target.value); setEv(''); setOpt(0); }}>
          {!mon && <option value="">—</option>}
          {live.months.map(m => <option key={m} value={m}>{m || '이벤트'}</option>)}
          {live.hidden.length ? <optgroup label="숨긴 달">{live.hidden.map(m => <option key={m} value={m}>{m}</option>)}</optgroup> : null}
        </select></label> : null}
        {mon ? <button type="button" className="pcz-hide" disabled={busy} onClick={() => void toggleHide()}>{isHidden ? '보이기' : '숨기기'}</button> : null}
      </div>
      <header className="pcz-title"><small>EVENT PROGRAM</small><h3><i />이벤트 프로그램 비교<i /></h3></header>
      {!groups.length ? <div className="pb-empty">기록 없음</div> : <>
      <div className="pcz-two">
        <div className="pcz-card is-a">
          <span className="pcz-kind">{mon || '이벤트'}</span>
          <label className="pcz-pick"><b>{nameView(g?.base)}</b><ChevronDown size={18} /><select value={g?.base ?? ''} aria-label="이벤트" onChange={e => { setEv(e.target.value); setOpt(0); }}>{subs.map(sb => { const os = groups.filter(x => x.sub === sb).map(x => <option key={x.base} value={x.base}>{x.base}</option>); return sb ? <optgroup key={sb} label={sb}>{os}</optgroup> : os; })}</select></label>
          {g && g.options.length > 1 ? <label className="pcz-opt"><span>{optText(o!, g.options.indexOf(o!))}</span><ChevronDown size={16} /><select value={g.options.indexOf(o!)} aria-label="이벤트 옵션" onChange={e => setOpt(Number(e.target.value))}>{g.options.map((x, k) => <option key={k} value={k}>{optText(x, k)}</option>)}</select></label> : <div className="pcz-opt is-empty" />}
          <div className="pcz-price"><strong>{won(a?.price ?? null)}</strong><small>부가세 포함</small></div>
        </div>
        <div className="pcz-card is-b">
          <span className="pcz-kind">선결제권 · 전체 프로그램</span>
          <label className="pcz-pick"><b>{nameView(b?.name)}</b><ChevronDown size={18} /><select value={b?.id ?? ''} aria-label="프로그램" onChange={e => setPid(e.target.value)}>{otherCats.map(c => <optgroup key={c} label={c}>{others.filter(p => p.category === c).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}</select></label>
          <div className="pcz-tiers" role="group" aria-label="선결제권">{([0, ...TIERS] as (PrepaidTier | 0)[]).map(t => <button key={t} type="button" aria-pressed={tier === t} className={tier === t ? 'is-on' : undefined} onClick={() => setTier(t)}>{t ? `${t}만원권` : '정가'}</button>)}</div>
          <div className="pcz-price"><strong>{won(tier ? tierPrice(b?.price ?? null, tier) : b?.price ?? null)}</strong><small>{tier && b?.price != null ? `정가 ${won(b.price)} · ` : ''}부가세 포함</small></div>
        </div>
      </div>
      {(a?.items?.length || b?.items?.length) ? <section className="pcz-box">
        {same ? <>
          <div className="pcz-head"><h4>시술 구성 동일</h4></div>
          <table className="pct pct-one"><tbody>{allRows.map((r, k) => <tr key={k}><th scope="row">{r.name}</th><td><div className="pct-v"><b>{r.a?.count}</b>{r.a?.subs.map((t, j) => <small key={j}>{t}</small>)}</div></td></tr>)}</tbody></table>
        </> : <>
          <div className="pcz-head"><h4>시술 구성</h4>
            <label className="pc-only"><input type="checkbox" checked={onlyDiff} onChange={e => setOnlyDiff(e.target.checked)} /> 차이만 보기</label></div>
          <table className="pct">
            <colgroup><col className="pct-n" /><col /><col className="pct-n" /></colgroup>
            <thead><tr><th className="is-a">이벤트</th><th>시술 항목</th><th className="is-b">{tier ? `${tier}만원권` : '정가'}</th></tr></thead>
            <tbody>{rows.map((r, k) => <tr key={k} className={rowDiff(r) ? 'is-d' : undefined}>{cell(r.a, r.b)}<th scope="row">{r.name}</th>{cell(r.b, r.a)}</tr>)}</tbody>
          </table>
        </>}
      </section> : null}
      </>}
    </div>
  </div>;
}
// 선결제 비교(2026-11-28 사용자 그림 '선결제 비교 탭 추가'): 왼쪽 '전체 프로그램' 정가 | 오른쪽 '선결제권' 300·400·500만원권 할인 — 시술 구성 표 없음
function PrepaidCompare({ programs, cats, onCat }: { programs: Program[]; cats: string[]; onCat: (c: string) => void }) {
  const list = useMemo(() => programs.filter(p => p.category !== EVENT_CAT), [programs]);
  const groups = Array.from(new Set(list.map(p => p.category)));
  const [pick, setPick] = useState<[string, string]>(['', '']); const [tier, setTier] = useState<PrepaidTier>(300);
  const a = list.find(p => p.id === pick[0]) ?? list[0];
  const b = list.find(p => p.id === pick[1]) ?? a; // 처음엔 오른쪽도 같은 프로그램
  const opts = () => groups.map(c => <optgroup key={c} label={c}>{list.filter(p => p.category === c).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>);
  return <div className="pc-wrap">
    <div className="pcz pcz-ev">
      <div className="pcz-top">
        <label className="pc-cat"><select value={PREPAID_CAT} aria-label="탭" onChange={e => onCat(e.target.value)}>{cats.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
      </div>
      <header className="pcz-title"><small>PREPAID</small><h3><i />선결제권 비교<i /></h3></header>
      {!list.length ? <div className="pb-empty">기록 없음</div> : <div className="pcz-two">
        <div className="pcz-card is-a">
          <span className="pcz-kind">전체 프로그램</span>
          <label className="pcz-pick"><b>{nameView(a?.name)}</b><ChevronDown size={18} /><select value={a?.id ?? ''} aria-label="프로그램 1" onChange={e => setPick(p => [e.target.value, p[1]])}>{opts()}</select></label>
          <div className="pcz-opt is-empty" />
          <div className="pcz-price"><strong>{won(a?.price ?? null)}</strong><small>부가세 포함</small></div>
        </div>
        <div className="pcz-card is-b">
          <span className="pcz-kind">선결제권</span>
          <label className="pcz-pick"><b>{nameView(b?.name)}</b><ChevronDown size={18} /><select value={b?.id ?? ''} aria-label="프로그램 2" onChange={e => setPick(p => [p[0] || (a?.id ?? ''), e.target.value])}>{opts()}</select></label>
          <div className="pcz-tiers" role="group" aria-label="선결제권">{TIERS.map(t => <button key={t} type="button" aria-pressed={tier === t} className={tier === t ? 'is-on' : undefined} onClick={() => setTier(t)}>{t}만원권</button>)}</div>
          <div className="pcz-price"><strong>{won(tierPrice(b?.price ?? null, tier))}</strong><small>부가세 포함</small></div>
        </div>
        <div className="pcz-pre-note" />
        <div className="pcz-pre-note"><b>{tier}만원 선결제 시</b> : {won(tierPrice(b?.price ?? null, tier))} ({prepaidDiscountRates[tier]}% 할인)</div>
      </div>}
    </div>
  </div>;
}
// 설명은 원문 그대로, 문장마다 문단으로 나눔(2026-11-26 밤 사용자 그림)
// 줄바꿈도 문단으로(2026-11-27 사용자 보톡스 설명 — 줄마다 그대로)
const sentences = (t: string) => t.split(/\n+|(?<=[.。])\s+/).map(x => x.trim()).filter(Boolean);
// 빈 줄로 나눈 묶음은 묶음끼리만 띄우고 묶음 안 줄은 붙여서(2026-11-27 사용자 그림 — 보톡스 설명 두 줄씩)
// '▸ 제목'으로 시작하는 묶음은 눌러서 펼쳐 보는 칸(2026-11-28 사용자 '수입 필러를 권유하는 이유 펼쳐 볼 수 있게' · '환자 눈에 대놓고 보이면 안 돼' → 제목 글자 없이 작은 연회색 점 세 개만, 펼쳐도 제목 없이 내용만), 형광펜은 펼침 칸 말고 마지막 묶음에
const MORE = /^\s*▸\s*/;
const descView = (t: string, under = false) => {
  if (!/\n/.test(t)) return sentences(t).map((x, k) => <p key={k}>{x}</p>);
  const gs = t.split(/\n\s*\n/), plain = gs.map((g, k) => (MORE.test(g) ? -1 : k)).filter(k => k >= 0);
  const last = plain.length > 1 ? plain[plain.length - 1] : -1;
  return gs.map((g, k) => {
    if (MORE.test(g)) { const [head, ...rest] = g.replace(MORE, '').split('\n'); return <details key={k} className="pcz-more"><summary aria-label={head.trim()} title="" /><div className="pcz-dg">{sentences(rest.join('\n')).map((x, j) => <p key={j}><span>{x}</span></p>)}</div></details>; }
    return <div key={k} className={under && k === last ? 'pcz-dg is-u' : 'pcz-dg'}>{sentences(g).map((x, j) => <p key={j}><span>{x}</span></p>)}</div>;
  });
};
// 편집 목록의 횟수 글자(숫자면 N회, 아니면 적은 글자) — 2026-11-27 빠져서 [편집]이 흰 화면이 되던 것 되살림
// 이름은 '+ 시술'·'(대표 원장님)' 묶음 사이에서만 줄바꿈(2026-11-27 사용자 '문장 띄어쓰기' — '(대표 / 원장님)'처럼 끊기지 않게)
// '추가 관리'·흑자 크기 '(1cm 이하)'는 이름 아래 작은 연회색 줄로(2026-11-27 사용자 — 오른쪽 제목이 길어지지 않게)
const nameView = (n?: string) => { if (!n) return null; const m = n.match(/^(.+?)\s+(추가 관리.*|\([^()]*\dcm[^()]*\))$/); return m ? <>{nameParts(m[1])}<small className="pc-sub">{m[2]}</small></> : nameParts(n); };
const nameParts = (n?: string) => (n ? n.split(/\s+(?=\+\s|\()/).map((t, k) => <Fragment key={k}>{k ? ' ' : ''}<span className="pc-nw">{t}</span></Fragment>) : null);
const itemText = (i: { qty: number | null; label?: string }) => (i.qty != null ? `${i.qty}회` : i.label || '포함');
const CAT_EN: Record<string, string> = { 색소: 'PIGMENT', 홍조: 'REDNESS', 여드름: 'ACNE', 흉터: 'SCAR', 모공: 'PORE', 리프팅: 'LIFTING', 스킨부스터: 'SKIN BOOSTER', 보톡스: 'BOTOX', 필러: 'FILLER', 이벤트: 'EVENT' };

// 가격표 [편집] 아래: 고른 탭(이름 = category)의 라인 · 프로그램 자료 — 추가·수정·삭제
type Draft = { id?: string; name: string; price: string; line: string; desc: string; fit: string; items: { name: string; count: string }[] };
const toDraft = (p?: Program): Draft => ({ id: p?.id, name: p?.name ?? '', price: p?.price == null ? '' : String(p.price), line: p?.line ?? '', desc: p?.desc ?? '', fit: p?.fit ?? '', items: p?.items.length ? p.items.map(i => ({ name: i.name, count: i.qty != null ? String(i.qty) : i.label ?? '' })) : [{ name: '', count: '' }] });
type LineDraft = { id?: string; name: string; feature: string; fit: string };
export function ProgramEditor({ category, data, onChange }: { category: string; data: ProgramData; onChange: (d: ProgramData) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [lineDraft, setLineDraft] = useState<LineDraft | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const list = data.programs.filter(p => p.category === category), lines = data.lines.filter(l => l.category === category);
  const run = async (job: () => Promise<ProgramData>, done: () => void) => { setBusy(true); setError(''); try { onChange(await job()); done(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const save = () => draft && run(() => {
    const items = draft.items.filter(i => i.name.trim()).map(i => { const n = Number(i.count.replace(/회$/, '').trim()); return i.count.trim() && Number.isFinite(n) ? { name: i.name, qty: n } : { name: i.name, qty: null, label: i.count.trim() || '포함' }; });
    return sendPrograms({ action: 'save', id: draft.id, category, name: draft.name, price: draft.price.replace(/[^\d]/g, ''), items, line: draft.line, desc: draft.desc, fit: draft.fit });
  }, () => setDraft(null));
  const saveLine = () => lineDraft && run(() => sendPrograms({ action: 'save-line', id: lineDraft.id, category, ...lineDraft }), () => setLineDraft(null));
  const remove = async (p: Program) => { if (await askConfirm({ title: '삭제하시겠습니까?', message: p.name, kind: 'delete' })) void run(() => sendPrograms({ action: 'delete', id: p.id }), () => undefined); };
  const removeLine = async (l: ProgramLine) => { if (await askConfirm({ title: '삭제하시겠습니까?', message: l.name, kind: 'delete' })) void run(() => sendPrograms({ action: 'delete-line', id: l.id }), () => undefined); };
  const setItem = (k: number, f: 'name' | 'count', v: string) => setDraft(d => d && { ...d, items: d.items.map((x, i) => (i === k ? { ...x, [f]: v } : x)) });
  const foot = (ok: boolean, close: () => void) => <footer className="kitty-dialog-actions"><button type="button" onClick={close} disabled={busy}>취소</button><button type="submit" className="kitty-primary" disabled={busy || !ok}>{busy ? <><SavingMark />저장 중…</> : '저장'}</button></footer>;
  return <section className="pc-edit">
    <h3>프로그램 비교 · {category}</h3>
    <p className="pc-edit-cap">라인</p>
    {lines.map(l => <div key={l.id} className="pc-edit-row">
      <div><b>{l.name}</b><small>{l.feature || '—'}</small></div>
      <button type="button" aria-label="수정" onClick={() => setLineDraft({ id: l.id, name: l.name, feature: l.feature, fit: l.fit })}><Pencil size={16} /></button>
      <button type="button" aria-label="삭제" onClick={() => void removeLine(l)}><Trash2 size={16} /></button>
    </div>)}
    <button type="button" className="pb-add" onClick={() => setLineDraft({ name: '', feature: '', fit: '' })}><Plus size={16} />라인 추가</button>
    <p className="pc-edit-cap">프로그램</p>
    {list.map(p => <div key={p.id} className="pc-edit-row">
      <div><b>{p.name}</b><small>{won(p.price)}{p.line ? ` · ${p.line}` : ''} · {p.items.map(i => `${i.name} ${itemText(i)}`).join(' · ') || '—'}</small></div>
      <button type="button" aria-label="수정" onClick={() => setDraft(toDraft(p))}><Pencil size={16} /></button>
      <button type="button" aria-label="삭제" onClick={() => void remove(p)}><Trash2 size={16} /></button>
    </div>)}
    <button type="button" className="pb-add" onClick={() => setDraft(toDraft())}><Plus size={16} />프로그램 추가</button>
    {error && !draft && !lineDraft && <p className="pb-msg is-error">{error}</p>}
    {lineDraft && <KittyDialog title={lineDraft.id ? '라인 수정' : '라인 추가'} onClose={() => !busy && setLineDraft(null)} busy={busy}>
      <form className="pc-form" onSubmit={e => { e.preventDefault(); void saveLine(); }}>
        <label className="kitty-field">라인 이름<input required maxLength={100} value={lineDraft.name} onChange={e => setLineDraft({ ...lineDraft, name: e.target.value })} /></label>
        <label className="kitty-field">특징<textarea className="pc-form-note" rows={3} maxLength={400} value={lineDraft.feature} onChange={e => setLineDraft({ ...lineDraft, feature: e.target.value })} /></label>
        <label className="kitty-field">맞춤 피부<textarea className="pc-form-note" rows={2} maxLength={400} value={lineDraft.fit} onChange={e => setLineDraft({ ...lineDraft, fit: e.target.value })} /></label>
        {error && <p className="kitty-error" role="alert">{error}</p>}
        {foot(!!lineDraft.name.trim(), () => setLineDraft(null))}
      </form>
    </KittyDialog>}
    {draft && <KittyDialog title={draft.id ? '프로그램 수정' : '프로그램 추가'} onClose={() => !busy && setDraft(null)} busy={busy}>
      <form className="pc-form" onSubmit={e => { e.preventDefault(); void save(); }}>
        <div className="pc-form-two">
          <label className="kitty-field">프로그램 이름<input required maxLength={100} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
          <label className="kitty-field">총금액(원)<input inputMode="numeric" value={draft.price} onChange={e => setDraft({ ...draft, price: e.target.value })} placeholder="1320000" /></label>
        </div>
        <label className="kitty-field">라인<select value={draft.line} onChange={e => setDraft({ ...draft, line: e.target.value })}><option value="">—</option>{lines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}{draft.line && !lines.some(l => l.name === draft.line) && <option value={draft.line}>{draft.line}</option>}</select></label>
        <div className="pc-form-items"><span>시술 · 횟수</span>
          {draft.items.map((it, k) => <div key={k} className="pc-form-item">
            <input value={it.name} aria-label="시술" placeholder="시술" onChange={e => setItem(k, 'name', e.target.value)} />
            <input value={it.count} aria-label="횟수" placeholder="5" onChange={e => setItem(k, 'count', e.target.value)} />
            <button type="button" aria-label="줄 빼기" onClick={() => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== k) })}><X size={14} /></button>
          </div>)}
          <button type="button" className="pc-form-add" onClick={() => setDraft({ ...draft, items: [...draft.items, { name: '', count: '' }] })}><Plus size={14} />줄 추가</button>
        </div>
        <label className="kitty-field">프로그램 특징<textarea className="pc-form-note" rows={3} maxLength={400} value={draft.desc} onChange={e => setDraft({ ...draft, desc: e.target.value })} /></label>
        {error && <p className="kitty-error" role="alert">{error}</p>}
        {foot(!!draft.name.trim(), () => setDraft(null))}
      </form>
    </KittyDialog>}
  </section>;
}

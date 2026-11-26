import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Pencil, Plus, Trash2, X } from 'lucide-react';
import { KittyDialog } from './KittyDialog';
import { askConfirm } from './AlertDialog';
import { SavingMark } from './Feedback';
import { readWon } from '../koreanAmount';

// 프로그램 비교(2026-11-26 사용자 설계 기준, 상담용): 고르기 두 개 → 카드(이름·총금액·부가세 포함, 라인이 다르면 라인 이름표 + 한 줄 요약)
// → 시술 구성 표(A 횟수 | 시술 항목 | B 횟수, 다른 줄은 양쪽 강조, '차이만 보기'는 같은 줄 숨김) → 안내 한 줄 → 설명 불릿 2개(맞춤 피부 · 설명). 가격 차이 상자·추천 순위·우수 표시·할인율은 넣지 않는다.
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
export const won = (n: number | null) => (n == null ? '—' : readWon(n));
const itemText = (it?: ProgramItem) => (!it ? '—' : it.qty != null ? `${it.qty}회` : it.label || '포함');

// 같은 시술 이름끼리 한 줄: A 순서대로, B에만 있는 것은 B 순서 자리에 끼워 넣음
export function alignRows(a: Program | undefined, b: Program | undefined) {
  const names: string[] = [];
  for (const it of a?.items ?? []) if (!names.includes(it.name)) names.push(it.name);
  const bi = b?.items ?? [];
  bi.forEach((it, j) => { // B에만 있는 시술은 B에서 바로 앞에 있던 시술 다음 줄에 — 두 프로그램 순서를 모두 지킴
    if (names.includes(it.name)) return;
    let at = 0; for (let k = j - 1; k >= 0; k--) { const i = names.indexOf(bi[k].name); if (i >= 0) { at = i + 1; break; } }
    names.splice(at, 0, it.name);
  });
  return names.map(name => {
    const x = a?.items.find(i => i.name === name), y = b?.items.find(i => i.name === name);
    const same = itemText(x) === itemText(y);
    return { name, x, y, same };
  });
}

export function ProgramCompare() {
  const [data, setData] = useState<ProgramData | null>(null);
  const programs = data?.programs ?? null;
  const [error, setError] = useState('');
  const [cat, setCat] = useState(() => { try { return localStorage.getItem('price-compare-cat') || ''; } catch { return ''; } });
  const [pick, setPick] = useState<[string, string]>(['', '']);
  const [onlyDiff, setOnlyDiff] = useState(false);
  useEffect(() => { loadPrograms().then(setData).catch(e => setError((e as Error).message)); }, []);
  const cats = useMemo(() => Array.from(new Set((programs ?? []).map(p => p.category))), [programs]);
  const category = cats.includes(cat) ? cat : cats[0] ?? '';
  useEffect(() => { if (category) { try { localStorage.setItem('price-compare-cat', category); } catch { /* 이 기기 편의 */ } } }, [category]);
  const list = (programs ?? []).filter(p => p.category === category);
  const a = list.find(p => p.id === pick[0]) ?? list[0];
  const b = list.find(p => p.id === pick[1]) ?? list[1] ?? list[0];
  // 라인 요약은 서로 다른 라인끼리 비교할 때만(2026-11-26 사용자 '다른 라인끼리면 라인 요약도')
  const lineOf = (p?: Program) => (p?.line ? data?.lines.find(l => l.category === category && l.name === p.line) : undefined);
  const lineDiff = !!a?.line && !!b?.line && a.line !== b.line;
  const choose = (i: 0 | 1, id: string) => setPick(p => { const n: [string, string] = [a?.id ?? '', b?.id ?? '']; n[i] = id; return n; });

  if (error) return <div className="pb-empty">{error}</div>;
  if (!programs) return <div className="pb-empty"><SavingMark /></div>;
  if (!list.length) return <div className="pb-empty">기록 없음</div>;
  const pair = [a, b] as const;
  const rows = alignRows(a, b);
  const shown = onlyDiff ? rows.filter(r => !r.same) : rows;
  return <div className="pc-wrap">
    <div className="pcx">
      <div className="pc-head">
        <label className="pc-cat"><select value={category} aria-label="탭" onChange={e => { setCat(e.target.value); setPick(['', '']); }}>{cats.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
        <h3>프로그램 비교</h3>
        <button type="button" className="pc-swap" aria-label="자리 바꾸기" title="자리 바꾸기" onClick={() => setPick([b?.id ?? '', a?.id ?? ''])}><ArrowLeftRight size={20} /></button>
      </div>
      <div className="pc-two">
        {pair.map((p, i) => <select key={i} className="pc-pick" value={p?.id ?? ''} aria-label={`프로그램 ${i + 1}`} onChange={e => choose(i as 0 | 1, e.target.value)}>{list.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>)}
      </div>
      <div className="pc-two">
        {pair.map((p, i) => { const l = lineDiff ? lineOf(p) : undefined; return <div key={i} className="pc-card"><b>{p?.name}</b><strong>{won(p?.price ?? null)}</strong><small>부가세 포함</small>
          {lineDiff && <><span className="pcx-tag">{p?.line}</span>{l?.feature ? <p className="pcx-sum">{l.feature}</p> : null}</>}</div>; })}
      </div>
      <div className="pc-sec"><h4>시술 구성</h4>
        <label className="pc-only"><input type="checkbox" checked={onlyDiff} onChange={e => setOnlyDiff(e.target.checked)} /> 차이만 보기</label></div>
      <div className="pc-table" role="table">
        <div className="pc-row is-head" role="row"><span>{a?.name}</span><span>시술 항목</span><span>{b?.name}</span></div>
        {shown.map(r => <div key={r.name} className="pc-row" role="row">
          <span className={r.same ? '' : 'is-diff'}>{itemText(r.x)}</span>
          <span className="pc-name">{r.name}</span>
          <span className={r.same ? '' : 'is-diff'}>{itemText(r.y)}</span>
        </div>)}
        {!shown.length && <div className="pc-row is-empty"><span>구성 같음</span></div>}
      </div>
      <p className="pc-note">매 회차 원장님이 피부 상태를 확인한 후 시술을 결정합니다.</p>
      {pair.some(p => p?.fit || p?.desc) && <div className="pc-two">
        {pair.map((p, i) => <div key={i} className="pcx-c is-top is-bottom"><ul className="pcx-desc">{[p?.fit, p?.desc].filter(t => t?.trim()).map((t, k) => <li key={k}>{t}</li>)}</ul></div>)}
      </div>}
    </div>
  </div>;
}

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
        <label className="kitty-field">설명<textarea className="pc-form-note" rows={3} maxLength={400} value={draft.desc} onChange={e => setDraft({ ...draft, desc: e.target.value })} /></label>
        <label className="kitty-field">맞춤 피부<textarea className="pc-form-note" rows={2} maxLength={400} value={draft.fit} onChange={e => setDraft({ ...draft, fit: e.target.value })} /></label>
        {error && <p className="kitty-error" role="alert">{error}</p>}
        {foot(!!draft.name.trim(), () => setDraft(null))}
      </form>
    </KittyDialog>}
  </section>;
}

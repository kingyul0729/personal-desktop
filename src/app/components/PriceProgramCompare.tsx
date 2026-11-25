import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Pencil, Plus, Trash2, X } from 'lucide-react';
import { KittyDialog } from './KittyDialog';
import { askConfirm } from './AlertDialog';
import { SavingMark } from './Feedback';
import { readWon } from '../koreanAmount';

// 프로그램 비교(2026-11-26 사용자 설계 기준, 상담용): 위 = 두 프로그램 이름과 총금액, 가운데 = 같은 시술을 같은 줄에,
// 아래 = 가격 차이 · 구성 차이 · 안내 한 줄. 서로 다른 구성만 연한 색으로 강조, '차이만 보기'는 같은 줄을 숨김.
// 추천 순위·우수 표시·할인율은 넣지 않는다. 숫자는 가격표 그림이 아니라 price_programs(앱에서 적거나 파일로 넣음).
export type ProgramItem = { name: string; qty: number | null; label?: string };
export type Program = { id: string; category: string; name: string; price: number | null; items: ProgramItem[] };

export async function loadPrograms(): Promise<Program[]> {
  const r = await fetch('/api/price-programs', { cache: 'no-store' });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d) throw new Error(d?.error || '프로그램을 불러오지 못했어요.');
  return d.programs as Program[];
}
export async function sendPrograms(body: unknown): Promise<Program[]> {
  const r = await fetch('/api/price-programs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d) throw new Error(d?.error || '저장하지 못했어요.');
  return d.programs as Program[];
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
    // 강조는 더 많이 들어간 쪽(없음 vs 있음이면 있는 쪽, 횟수가 다르면 큰 쪽, 글자만 다르면 둘 다)
    const more = same ? null : !x ? 'b' : !y ? 'a' : x.qty != null && y.qty != null ? (x.qty > y.qty ? 'a' : 'b') : 'both';
    return { name, x, y, same, more };
  });
}

export function ProgramCompare() {
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [error, setError] = useState('');
  const [cat, setCat] = useState(() => { try { return localStorage.getItem('price-compare-cat') || ''; } catch { return ''; } });
  const [pick, setPick] = useState<[string, string]>(['', '']);
  const [onlyDiff, setOnlyDiff] = useState(false);
  useEffect(() => { loadPrograms().then(setPrograms).catch(e => setError((e as Error).message)); }, []);
  const cats = useMemo(() => Array.from(new Set((programs ?? []).map(p => p.category))), [programs]);
  const category = cats.includes(cat) ? cat : cats[0] ?? '';
  useEffect(() => { if (category) { try { localStorage.setItem('price-compare-cat', category); } catch { /* 이 기기 편의 */ } } }, [category]);
  const list = (programs ?? []).filter(p => p.category === category);
  const a = list.find(p => p.id === pick[0]) ?? list[0];
  const b = list.find(p => p.id === pick[1]) ?? list[1] ?? list[0];
  const rows = alignRows(a, b);
  const shown = onlyDiff ? rows.filter(r => !r.same) : rows;
  const diffs = rows.filter(r => !r.same);
  const gap = a?.price != null && b?.price != null ? Math.abs(a.price - b.price) : null;
  const choose = (i: 0 | 1, id: string) => setPick(p => { const n: [string, string] = [a?.id ?? '', b?.id ?? '']; n[i] = id; return n; });

  if (error) return <div className="pb-empty">{error}</div>;
  if (!programs) return <div className="pb-empty"><SavingMark /></div>;
  if (!list.length) return <div className="pb-empty">기록 없음</div>;
  const diffLine = (r: typeof rows[number]) => {
    const an = a?.name ?? '', bn = b?.name ?? '';
    if (!r.x) return `${r.name} · ${bn} ${itemText(r.y)} 더 포함`;
    if (!r.y) return `${r.name} · ${an} ${itemText(r.x)} 더 포함`;
    if (r.x.qty != null && r.y.qty != null) { const d = Math.round(Math.abs(r.x.qty - r.y.qty) * 100) / 100; return `${r.name} · ${r.x.qty > r.y.qty ? an : bn} ${d}회 더 포함`; }
    return `${r.name} · ${an} ${itemText(r.x)} / ${bn} ${itemText(r.y)}`;
  };
  return <div className="pc-wrap">
    <div className="pc-inner">
      <div className="pc-head">
        <label className="pc-cat"><select value={category} aria-label="탭" onChange={e => { setCat(e.target.value); setPick(['', '']); }}>{cats.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
        <h3>프로그램 비교</h3>
        <button type="button" className="pc-swap" aria-label="자리 바꾸기" title="자리 바꾸기" onClick={() => setPick([b?.id ?? '', a?.id ?? ''])}><ArrowLeftRight size={20} /></button>
      </div>
      <div className="pc-two">
        {([a, b] as const).map((p, i) => <select key={i} className="pc-pick" value={p?.id ?? ''} aria-label={`프로그램 ${i + 1}`} onChange={e => choose(i as 0 | 1, e.target.value)}>{list.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>)}
      </div>
      <div className="pc-two">
        {([a, b] as const).map((p, i) => <div key={i} className="pc-card"><b>{p?.name}</b><strong>{won(p?.price ?? null)}</strong><small>부가세 포함</small></div>)}
      </div>
      <div className="pc-sec"><h4>시술 구성</h4>
        <label className="pc-only"><input type="checkbox" checked={onlyDiff} onChange={e => setOnlyDiff(e.target.checked)} /> 차이만 보기</label></div>
      <div className="pc-table" role="table">
        <div className="pc-row is-head" role="row"><span>{a?.name}</span><span>시술 항목</span><span>{b?.name}</span></div>
        {shown.map(r => <div key={r.name} className="pc-row" role="row">
          <span className={r.more === 'a' || r.more === 'both' ? 'is-more' : ''}>{itemText(r.x)}</span>
          <span className="pc-name">{r.name}</span>
          <span className={r.more === 'b' || r.more === 'both' ? 'is-more' : ''}>{itemText(r.y)}</span>
        </div>)}
        {!shown.length && <div className="pc-row is-empty"><span>구성 같음</span></div>}
      </div>
      {(gap != null || diffs.length > 0) && <div className="pc-foot">
        {gap != null && <div className="pc-gap"><span>프로그램 가격 차이</span><b>{gap ? won(gap) : '같음'}</b></div>}
        {diffs.length > 0 && <div className="pc-diff"><b>구성 차이</b>{diffs.map(r => <span key={r.name}>{diffLine(r)}</span>)}</div>}
      </div>}
      <p className="pc-note">매 회차 원장님이 피부 상태를 확인한 후 시술을 결정합니다.</p>
    </div>
  </div>;
}

// 가격표 [편집] 아래: 고른 탭(이름 = category)의 프로그램 자료 — 추가·수정·삭제
type Draft = { id?: string; name: string; price: string; items: { name: string; count: string }[] };
const toDraft = (p?: Program): Draft => ({ id: p?.id, name: p?.name ?? '', price: p?.price == null ? '' : String(p.price), items: p?.items.length ? p.items.map(i => ({ name: i.name, count: i.qty != null ? String(i.qty) : i.label ?? '' })) : [{ name: '', count: '' }] });
export function ProgramEditor({ category, programs, onChange }: { category: string; programs: Program[]; onChange: (p: Program[]) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const list = programs.filter(p => p.category === category);
  const save = async () => {
    if (!draft) return; setBusy(true); setError('');
    try {
      const items = draft.items.filter(i => i.name.trim()).map(i => { const n = Number(i.count.replace(/회$/, '').trim()); return i.count.trim() && Number.isFinite(n) ? { name: i.name, qty: n } : { name: i.name, qty: null, label: i.count.trim() || '포함' }; });
      onChange(await sendPrograms({ action: 'save', id: draft.id, category, name: draft.name, price: draft.price.replace(/[^\d]/g, ''), items })); setDraft(null);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async (p: Program) => {
    if (!await askConfirm({ title: '삭제하시겠습니까?', message: p.name, kind: 'delete' })) return;
    try { onChange(await sendPrograms({ action: 'delete', id: p.id })); } catch (e) { setError((e as Error).message); }
  };
  const setItem = (k: number, f: 'name' | 'count', v: string) => setDraft(d => d && { ...d, items: d.items.map((x, i) => (i === k ? { ...x, [f]: v } : x)) });
  return <section className="pc-edit">
    <h3>프로그램 비교 · {category}</h3>
    {list.map(p => <div key={p.id} className="pc-edit-row">
      <div><b>{p.name}</b><small>{won(p.price)} · {p.items.map(i => `${i.name} ${itemText(i)}`).join(' · ') || '—'}</small></div>
      <button type="button" aria-label="수정" onClick={() => setDraft(toDraft(p))}><Pencil size={16} /></button>
      <button type="button" aria-label="삭제" onClick={() => void remove(p)}><Trash2 size={16} /></button>
    </div>)}
    <button type="button" className="pb-add" onClick={() => setDraft(toDraft())}><Plus size={16} />프로그램 추가</button>
    {error && !draft && <p className="pb-msg is-error">{error}</p>}
    {draft && <KittyDialog title={draft.id ? '프로그램 수정' : '프로그램 추가'} onClose={() => !busy && setDraft(null)} busy={busy}>
      <form className="pc-form" onSubmit={e => { e.preventDefault(); void save(); }}>
        <div className="pc-form-two">
          <label className="kitty-field">프로그램 이름<input required maxLength={100} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
          <label className="kitty-field">총금액(원)<input inputMode="numeric" value={draft.price} onChange={e => setDraft({ ...draft, price: e.target.value })} placeholder="1320000" /></label>
        </div>
        <div className="pc-form-items"><span>시술 · 횟수</span>
          {draft.items.map((it, k) => <div key={k} className="pc-form-item">
            <input value={it.name} aria-label="시술" placeholder="시술" onChange={e => setItem(k, 'name', e.target.value)} />
            <input value={it.count} aria-label="횟수" placeholder="5" onChange={e => setItem(k, 'count', e.target.value)} />
            <button type="button" aria-label="줄 빼기" onClick={() => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== k) })}><X size={14} /></button>
          </div>)}
          <button type="button" className="pc-form-add" onClick={() => setDraft({ ...draft, items: [...draft.items, { name: '', count: '' }] })}><Plus size={14} />줄 추가</button>
        </div>
        {error && <p className="kitty-error" role="alert">{error}</p>}
        <footer className="kitty-dialog-actions"><button type="button" onClick={() => setDraft(null)} disabled={busy}>취소</button><button type="submit" className="kitty-primary" disabled={busy || !draft.name.trim()}>{busy ? <><SavingMark />저장 중…</> : '저장'}</button></footer>
      </form>
    </KittyDialog>}
  </section>;
}

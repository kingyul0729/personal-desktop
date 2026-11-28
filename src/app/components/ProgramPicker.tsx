import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, X } from 'lucide-react';
import { pickItems, uniq, type PickOption } from '../programPick';

// 프로그램 이름을 누르면 뜨는 흰 선택 팝업(2026-11-29 사용자 — 검은 기본 드롭다운 대신): 묶음 → 시술 종류 → 일반/리프팅 고객 → 목록, 고르면 닫힘
// 카드 바로 아래(화면 밖으로 안 나가게 자리 맞춤), 목록만 팝업 안에서 스크롤
const ETC = '그 외';
export function ProgramPicker({ options, value, onChange, label, children, show = (n: string) => n }: { options: PickOption[]; value: string; onChange: (id: string) => void; label: string; children: ReactNode; show?: (name: string) => string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const items = useMemo(() => pickItems(options), [options]);
  const cur = items.find(x => x.id === value) ?? items[0];
  const [cat, setCat] = useState(''); const [kind, setKind] = useState(''); const [lift, setLift] = useState(false); const [doc, setDoc] = useState('');
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number } | null>(null);
  const kindOf = (k: string) => k || ETC;
  const openIt = () => { if (!cur) return; setCat(cur.cat); setKind(kindOf(cur.kind)); setLift(cur.lift); setDoc(cur.doc); setOpen(true); };
  const place = () => {
    const r = btn.current?.closest('.pcz-card')?.getBoundingClientRect() ?? btn.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth, vh = window.innerHeight, width = Math.min(Math.max(r.width, 340), 460, vw - 24);
    const left = Math.min(Math.max(12, r.left), vw - width - 12);
    const b = btn.current!.getBoundingClientRect();
    let top = b.bottom + 8, maxH = vh - top - 16;
    if (maxH < 280 && b.top > vh - b.bottom) { maxH = Math.min(520, b.top - 24); top = Math.max(12, b.top - 8 - maxH); }
    setPos({ left, top, width, maxH: Math.min(maxH, 520) });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const re = () => place();
    window.addEventListener('keydown', key); window.addEventListener('resize', re);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('resize', re); };
  }, [open]);
  const cats = uniq(items.map(x => x.cat));
  const inCat = items.filter(x => x.cat === cat);
  const kinds = uniq(inCat.map(x => kindOf(x.kind)));
  const k = kinds.includes(kind) ? kind : kinds[0];
  const inKind = inCat.filter(x => kindOf(x.kind) === k);
  const hasLift = inKind.some(x => x.lift) && inKind.some(x => !x.lift);
  const byLift = hasLift ? inKind.filter(x => x.lift === lift) : inKind;
  const docs = uniq(byLift.map(x => x.doc)); // 원장님별(대표 원장님 / 부원장님)은 둘 이상일 때만
  const d = docs.includes(doc) ? doc : docs[0];
  const list = docs.length > 1 ? byLift.filter(x => x.doc === d) : byLift;
  const pick = (id: string) => { setOpen(false); if (id !== value) onChange(id); };
  return <>
    <button ref={btn} type="button" className="pcz-pick" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={openIt}>{children}<ChevronDown size={18} /></button>
    {open && pos ? createPortal(<>
      <div className="pp-scrim" onClick={() => setOpen(false)} />
      <div className="pp-pop" role="dialog" aria-label={label} style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxH }}>
        <div className="pp-head"><b>프로그램 선택</b><button type="button" aria-label="닫기" onClick={() => setOpen(false)}><X size={18} /></button></div>
        {cats.length > 1 ? <div className="pp-row pp-cats">{cats.map(c => <button key={c} type="button" className={c === cat ? 'is-on' : undefined} onClick={() => { setCat(c); setKind(''); }}>{c || ETC}</button>)}</div> : null}
        {kinds.length > 1 ? <div className="pp-row">{kinds.map(x => <button key={x} type="button" className={x === k ? 'is-on' : undefined} onClick={() => setKind(x)}>{x}</button>)}</div> : null}
        {hasLift ? <div className="pp-row pp-two">{[false, true].map(v => <button key={String(v)} type="button" className={v === lift ? 'is-on' : undefined} onClick={() => setLift(v)}>{v ? '리프팅 고객' : '일반'}</button>)}</div> : null}
        {docs.length > 1 ? <div className="pp-row pp-two">{docs.map(v => <button key={v} type="button" className={v === d ? 'is-on' : undefined} onClick={() => setDoc(v)}>{v || '기본'}</button>)}</div> : null}
        <ul className="pp-list">{list.map(x => <li key={x.id}><button type="button" className={x.id === value ? 'is-on' : undefined} onClick={() => pick(x.id)}><span>{show(x.label)}</span>{x.id === value ? <Check size={18} /> : null}</button></li>)}</ul>
      </div>
    </>, document.body) : null}
  </>;
}

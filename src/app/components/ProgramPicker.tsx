import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, X } from 'lucide-react';
import { pickItems, uniq, type PickOption } from '../programPick';

// 프로그램 이름을 누르면 뜨는 흰 선택 팝업(2026-11-29 사용자 — 검은 기본 드롭다운 대신): 묶음 → 시술 종류 → 일반/리프팅 고객 → 목록, 고르면 닫힘
// 카드 바로 아래(화면 밖으로 안 나가게 자리 맞춤), 목록만 팝업 안에서 스크롤
const ETC = '그 외';
type Pos = { left: number; top: number; width: number; maxH: number };
// 팝업 자리: 기준(카드 또는 버튼) 바로 아래, 화면 밖이면 안으로, 아래 자리가 모자라면 위에 · Esc 닫힘
function usePop(btn: RefObject<HTMLButtonElement | null>, open: boolean, setOpen: (v: boolean) => void, anchor?: string, minW = 340, maxW = 460): Pos | null {
  const [pos, setPos] = useState<Pos | null>(null);
  const place = () => {
    const b = btn.current?.getBoundingClientRect();
    if (!b) return;
    const r = (anchor ? btn.current?.closest(anchor)?.getBoundingClientRect() : null) ?? b;
    const vw = window.innerWidth, vh = window.innerHeight, width = Math.min(Math.max(r.width, minW), maxW, vw - 24);
    const left = Math.min(Math.max(12, r.left), vw - width - 12);
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
  return open ? pos : null;
}
export type PickExtra = { title: string; none: string; value: string; onChange: (id: string) => void; options: { id: string; label: string; note?: string }[]; when?: (cat: string) => boolean };
export function ProgramPicker({ options, value, onChange, label, children, show = (n: string) => n, extra }: { options: PickOption[]; value: string; onChange: (id: string) => void; label: string; children: ReactNode; show?: (name: string) => string; extra?: PickExtra }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const items = useMemo(() => pickItems(options), [options]);
  const cur = items.find(x => x.id === value) ?? items[0];
  const [cat, setCat] = useState(''); const [kind, setKind] = useState(''); const [lift, setLift] = useState(false); const [doc, setDoc] = useState('');
  const [more, setMore] = useState(false); // 아래 접힘 칸(스킨부스터 더하기)
  const kindOf = (k: string) => k || ETC;
  const openIt = () => { if (!cur) return; setCat(cur.cat); setKind(kindOf(cur.kind)); setLift(cur.lift); setDoc(cur.doc); setMore(false); setOpen(true); };
  const pos = usePop(btn, open, setOpen, '.pcz-card');
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
        {!more && cats.length > 1 ? <div className="pp-row pp-cats">{cats.map(c => <button key={c} type="button" className={c === cat ? 'is-on' : undefined} onClick={() => { setCat(c); setKind(''); }}>{c || ETC}</button>)}</div> : null}
        {!more && kinds.length > 1 ? <div className="pp-row">{kinds.map(x => <button key={x} type="button" className={x === k ? 'is-on' : undefined} onClick={() => setKind(x)}>{x}</button>)}</div> : null}
        {!more && hasLift ? <div className="pp-row pp-two">{[false, true].map(v => <button key={String(v)} type="button" className={v === lift ? 'is-on' : undefined} onClick={() => setLift(v)}>{v ? '리프팅 고객' : '일반'}</button>)}</div> : null}
        {!more && docs.length > 1 ? <div className="pp-row pp-two">{docs.map(v => <button key={v} type="button" className={v === d ? 'is-on' : undefined} onClick={() => setDoc(v)}>{v || '기본'}</button>)}</div> : null}
        {more ? null : <ul className="pp-list">{list.map(x => <li key={x.id}><button type="button" className={x.id === value ? 'is-on' : undefined} onClick={() => pick(x.id)}><span>{show(x.label)}</span>{x.id === value ? <Check size={18} /> : null}</button></li>)}</ul>}
        {extra && (!extra.when || extra.when(cat)) ? (() => { const on = extra.options.find(o => o.id === extra.value); return <div className={more ? 'pp-more is-open' : 'pp-more'}>
          <button type="button" className="pp-more-head" aria-expanded={more} onClick={() => setMore(v => !v)}><b>{extra.title}</b><span className={on ? 'is-on' : undefined}>{on ? on.label : extra.none}</span><ChevronDown size={18} /></button>
          {more ? <ul className="pp-list pp-more-list">{[{ id: '', label: extra.none, note: '' }, ...extra.options].map(o => <li key={o.id || '-'}><button type="button" className={o.id === extra.value ? 'is-on' : undefined} onClick={() => { extra.onChange(o.id); setMore(false); }}><span>{o.label}{o.note ? <small> {o.note}</small> : null}</span>{o.id === extra.value ? <Check size={18} /> : null}</button></li>)}</ul> : null}
        </div>; })() : null}
      </div>
    </>, document.body) : null}
  </>;
}

// 탭▾·달▾·이벤트 옵션도 같은 흰 팝업(2026-11-29 사용자 'ㅇㅇ' — 기본 드롭다운 안 씀): 제목 + 목록(묶음 이름은 작은 회색 머리), 고르면 닫힘
export type ListOption = { value: string; label: string; group?: string };
export function ListPicker({ options, value, onChange, label, title, className, children, anchor }: { options: ListOption[]; value: string; onChange: (v: string) => void; label: string; title: string; className: string; children: ReactNode; anchor?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pos = usePop(btn, open, setOpen, anchor, anchor ? 340 : 260, anchor ? 460 : 360);
  const groups = uniq(options.map(o => o.group ?? ''));
  return <>
    <button ref={btn} type="button" className={className} aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>{children}</button>
    {open && pos ? createPortal(<>
      <div className="pp-scrim" onClick={() => setOpen(false)} />
      <div className="pp-pop" role="dialog" aria-label={label} style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxH }}>
        <div className="pp-head"><b>{title}</b><button type="button" aria-label="닫기" onClick={() => setOpen(false)}><X size={18} /></button></div>
        <ul className="pp-list">{groups.map(g => <Fragment key={g || '-'}>
          {g ? <li className="pp-group">{g}</li> : null}
          {options.filter(o => (o.group ?? '') === g).map(o => <li key={o.value}><button type="button" className={o.value === value ? 'is-on' : undefined} onClick={() => { setOpen(false); if (o.value !== value) onChange(o.value); }}><span>{o.label}</span>{o.value === value ? <Check size={18} /> : null}</button></li>)}
        </Fragment>)}</ul>
      </div>
    </>, document.body) : null}
  </>;
}

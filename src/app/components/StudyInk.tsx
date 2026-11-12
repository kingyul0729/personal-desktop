import { useEffect, useRef, useState } from 'react';

// 공부 노트 위 펜 덧쓰기. 선은 노트 종이 좌표(종이 폭 NOTE_W 기준)로 저장해서 어느 기기에서 열어도 같은 자리에 보인다.
export type Stroke = { c: string; w: number; p: number[] };
export type InkTool = { kind: 'pen'; color: string } | { kind: 'erase' };
export const NOTE_W = 900;
export const INK_COLORS: [string, string][] = [['#222222', '검정'], ['#2b46c8', '파랑'], ['#d0342c', '빨강']];

export const parseInk = (text: string | null | undefined): Stroke[] => {
  if (!text) return [];
  try { const list = JSON.parse(text); return Array.isArray(list) ? list.filter(s => s && Array.isArray(s.p) && s.p.length >= 2) : []; } catch { return []; }
};
const pathOf = (p: number[]) => {
  let d = `M${p[0]} ${p[1]}`;
  if (p.length === 2) return d + 'l0 0';
  for (let i = 2; i < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
  return d;
};
const near = (s: Stroke, x: number, y: number, r: number) => {
  for (let i = 0; i < s.p.length; i += 2) if (Math.abs(s.p[i] - x) <= r && Math.abs(s.p[i + 1] - y) <= r) return true;
  return false;
};

// tool이 없으면 보기만(눌러도 아래 글·버튼이 그대로 눌린다). 펜·마우스로 쓰고, 손가락은 화면을 민다.
export function InkLayer({ strokes, tool, onChange, scroller }: { strokes: Stroke[]; tool: InkTool | null; onChange: (next: Stroke[]) => void; scroller: () => HTMLElement | null }) {
  const svg = useRef<SVGSVGElement>(null);
  const [live, setLive] = useState<Stroke | null>(null);
  const liveRef = useRef<Stroke | null>(null), latest = useRef(strokes), touch = useRef<{ x: number; y: number } | null>(null), frame = useRef(0);
  latest.current = strokes;
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const at = (event: React.PointerEvent) => {
    const box = svg.current!.getBoundingClientRect(), k = NOTE_W / box.width;
    return [Math.round((event.clientX - box.left) * k * 2) / 2, Math.round((event.clientY - box.top) * k * 2) / 2];
  };
  const erase = (x: number, y: number) => { const next = latest.current.filter(s => !near(s, x, y, 10)); if (next.length !== latest.current.length) { latest.current = next; onChange(next); } };
  const down = (event: React.PointerEvent) => {
    if (!tool) return;
    if (event.pointerType === 'touch') { touch.current = { x: event.clientX, y: event.clientY }; return; }
    event.preventDefault(); svg.current?.setPointerCapture(event.pointerId);
    const [x, y] = at(event);
    if (tool.kind === 'erase') { liveRef.current = { c: '', w: 0, p: [] }; erase(x, y); return; }
    liveRef.current = { c: tool.color, w: 2, p: [x, y] }; setLive({ ...liveRef.current });
  };
  const move = (event: React.PointerEvent) => {
    if (!tool) return;
    if (event.pointerType === 'touch') {
      if (touch.current) { const box = scroller(); box?.scrollBy(touch.current.x - event.clientX, touch.current.y - event.clientY); touch.current = { x: event.clientX, y: event.clientY }; }
      return;
    }
    const current = liveRef.current; if (!current) return;
    const [x, y] = at(event);
    if (tool.kind === 'erase') { erase(x, y); return; }
    const n = current.p.length; if (current.p[n - 2] === x && current.p[n - 1] === y) return;
    current.p.push(x, y);
    cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(() => liveRef.current && setLive({ ...liveRef.current, p: liveRef.current.p.slice() }));
  };
  const up = (event: React.PointerEvent) => {
    if (event.pointerType === 'touch') { touch.current = null; return; }
    const current = liveRef.current; liveRef.current = null; cancelAnimationFrame(frame.current); setLive(null);
    if (current && current.c && tool?.kind === 'pen') onChange([...latest.current, current]);
  };
  return <svg ref={svg} className={`note-ink${tool ? ' is-writing' : ''}${tool?.kind === 'erase' ? ' is-erasing' : ''}`} aria-hidden="true" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
    {[...strokes, ...(live ? [live] : [])].map((s, i) => <path key={i} d={pathOf(s.p)} stroke={s.c} strokeWidth={s.w} fill="none" strokeLinecap="round" strokeLinejoin="round" />)}
  </svg>;
}

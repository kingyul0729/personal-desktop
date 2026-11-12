import { useEffect, useState } from 'react';
import { CircleHelp, Save, Trash2 } from 'lucide-react';

// 확인 팝업(2026-11-12 사용자가 macOS 휴지통 비우기 알림을 보여 주며 지정): 묻기·삭제·마지막 저장 확인은 모두 이 모양 하나.
// 가운데 작은 카드 — 위 아이콘 · 굵은 제목 · 작은 설명 · 아래 [취소] [확인] 같은 폭 두 버튼.
export type AskKind = 'ask' | 'delete' | 'save';
export type AskOpts = { title: string; message?: string; ok?: string; cancel?: string; kind?: AskKind };
type Pending = AskOpts & { resolve: (v: boolean) => void };

let show: ((p: Pending) => void) | null = null;
const queue: Pending[] = [];

/** 확인 팝업을 띄우고 고른 결과(확인 true · 취소 false)를 돌려준다. */
export function askConfirm(opts: AskOpts): Promise<boolean> {
  return new Promise(resolve => {
    const p = { ...opts, resolve };
    if (show) show(p); else queue.push(p);
  });
}

const ICON = { ask: CircleHelp, delete: Trash2, save: Save } as const;

export function AlertHost() {
  const [cur, setCur] = useState<Pending | null>(null);
  useEffect(() => {
    show = p => setCur(c => { if (c) { queue.push(p); return c; } return p; });
    const first = queue.shift(); if (first) setCur(first);
    return () => { show = null; };
  }, []);
  const close = (v: boolean) => { if (!cur) return; cur.resolve(v); setCur(queue.shift() || null); };
  useEffect(() => {
    if (!cur) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(false); } else if (e.key === 'Enter') { e.preventDefault(); close(true); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  if (!cur) return null;
  const kind = cur.kind || 'ask';
  // 삭제는 제목 하나로(2026-11-12 사용자 '삭제하시겠습니까?'), 버튼은 기본 [아니요] [네]
  const title = kind === 'delete' ? '삭제하시겠습니까?' : cur.title;
  const Icon = ICON[kind];
  return <div className="mac-alert-back" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) close(false); }}>
    <div className="mac-alert" role="alertdialog" aria-modal="true" aria-labelledby="mac-alert-title">
      <span className={`mac-alert-icon is-${kind}`} aria-hidden="true"><Icon size={34} strokeWidth={1.6} /></span>
      <strong id="mac-alert-title">{title}</strong>
      {cur.message && <p>{cur.message}</p>}
      <div className="mac-alert-btns">
        <button type="button" onClick={() => close(false)}>{cur.cancel || '아니요'}</button>
        <button type="button" className={kind === 'delete' ? 'is-danger' : 'is-primary'} autoFocus onClick={() => close(true)}>{cur.ok || '네'}</button>
      </div>
    </div>
  </div>;
}

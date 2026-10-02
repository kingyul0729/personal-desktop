import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Heart, X } from 'lucide-react';

export function KittyDialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return createPortal(<dialog ref={ref} className="kitty-dialog" aria-label={title} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="kitty-dialog-shell">
      <img className="kitty-dialog-character" src="/theme/kitty-peek.png" alt="" draggable={false} />
      <header><h2><Heart size={21} />{title}</h2><button type="button" className="kitty-close" aria-label="닫기" disabled={busy} onClick={onClose}><X size={23} /></button></header>
      <div className="kitty-dialog-content">{children}</div>
    </div>
  </dialog>, document.body);
}

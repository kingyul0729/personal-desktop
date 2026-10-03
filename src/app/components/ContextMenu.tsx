import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem { label: string; onSelect: () => void; danger?: boolean }

export function ContextMenuList({ items, onClose }: { items: ContextMenuItem[]; onClose: () => void }) {
  // Lifting the finger after a long press sends a click to whatever is now under it, which can be
  // an item of the menu that just opened there. Only a press that starts on the menu (or a
  // keyboard activation, detail 0) selects an item.
  const pressed = useRef(false);
  return <>{items.map(item => <button key={item.label} type="button" role="menuitem" className={item.danger ? 'is-danger' : undefined}
    onPointerDown={() => { pressed.current = true; }}
    onClick={event => { if (event.detail !== 0 && !pressed.current) return; onClose(); item.onSelect(); }}>{item.label}</button>)}</>;
}

export function ContextMenu({ point, items, onClose }: { point: { x: number; y: number }; items: ContextMenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(point);
  // Keep the whole menu on screen, also near the right and bottom edges of an iPad.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({ x: Math.max(8, Math.min(point.x, window.innerWidth - box.width - 8)), y: Math.max(8, Math.min(point.y, window.innerHeight - box.height - 8)) });
  }, [point]);
  useEffect(() => {
    // preventScroll: focusing an item near the screen edge must not scroll the page, which a touch
    // browser reports as a resize and which used to close the menu right after it opened.
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    // Registered after the opening gesture so the touch that opened the menu does not close it.
    const timer = window.setTimeout(() => document.addEventListener('pointerdown', outside), 0);
    document.addEventListener('keydown', key);
    window.addEventListener('orientationchange', onClose);
    return () => { window.clearTimeout(timer); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); window.removeEventListener('orientationchange', onClose); };
  }, [onClose]);
  return createPortal(<div ref={ref} className="context-menu" role="menu" style={{ left: position.x, top: position.y }}
    onContextMenu={event => event.preventDefault()}>
    <ContextMenuList items={items} onClose={onClose} />
  </div>, document.body);
}

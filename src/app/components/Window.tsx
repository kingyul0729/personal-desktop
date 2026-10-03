import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { X, Minus, Square, Maximize2 } from 'lucide-react';
import { fitWindow, resizeWindow, type DesktopBounds, type WindowRect } from '../desktopState';

interface WindowProps {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  isOpen: boolean;
  isMinimized: boolean;
  isActive: boolean;
  bounds: DesktopBounds;
  onClose: () => void;
  onMinimize: () => void;
  defaultPosition?: { x: number; y: number };
  defaultSize?: DesktopBounds;
  zIndex: number;
  onFocus: () => void;
  className?: string;
  // A saved work layout to apply (a new nonce applies it again), and a report of the current one.
  layout?: { rect: WindowRect; maximized: boolean; nonce: number };
  onLayout?: (rect: WindowRect, maximized: boolean) => void;
}

export function Window({ title, icon, children, isOpen, isMinimized, isActive, bounds, onClose, onMinimize,
  defaultPosition = { x: 100, y: 100 }, defaultSize = { width: 600, height: 400 }, zIndex, onFocus, className = '', layout, onLayout }: WindowProps) {
  // Keep preferred geometry so rotating back can restore the larger layout.
  const [preferred, setPreferred] = useState<WindowRect>({ ...defaultPosition, ...defaultSize });
  const [maximized, setMaximized] = useState(false);
  const gesture = useRef<{ kind: 'move' | 'resize'; pointerId: number; x: number; y: number; rect: WindowRect } | null>(null);
  const rect = fitWindow(preferred, bounds, maximized);
  useEffect(() => { if (layout) { setPreferred(layout.rect); setMaximized(layout.maximized); } }, [layout?.nonce]);
  const reportRef = useRef(onLayout); reportRef.current = onLayout;
  useEffect(() => { reportRef.current?.(preferred, maximized); }, [preferred, maximized]);

  const startGesture = (event: PointerEvent<HTMLElement>, kind: 'move' | 'resize') => {
    if (maximized || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { kind, pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect };
  };
  const moveGesture = (event: PointerEvent<HTMLElement>) => {
    const start = gesture.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const delta = { x: event.clientX - start.x, y: event.clientY - start.y };
    setPreferred(start.kind === 'resize' ? resizeWindow(start.rect, delta, bounds)
      : fitWindow({ ...start.rect, x: start.rect.x + delta.x, y: start.rect.y + delta.y }, bounds));
  };
  const endGesture = () => { gesture.current = null; };
  const gestureEvents = { onPointerMove: moveGesture, onPointerUp: endGesture, onPointerCancel: endGesture, onLostPointerCapture: endGesture };

  if (!isOpen || !bounds.width || !bounds.height) return null;

  return <section
    className={`os-window${maximized ? ' is-maximized' : ''}${isActive ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
    aria-label={title}
    hidden={isMinimized}
    style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex }}
    onPointerDownCapture={onFocus}
    onFocusCapture={onFocus}
  >
    <div className="window-titlebar" onPointerDown={(event) => startGesture(event, 'move')}
      onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest('button')) setMaximized(!maximized); }} {...gestureEvents}>
      <div className="window-title">{icon}<span>{title}</span></div>
      <div className="window-controls">
        <img className="window-kitty" src="/theme/kitty-peek.png" alt="" aria-hidden="true" draggable={false} />
        <button type="button" aria-label={`${title} 최소화`} title="최소화" onClick={onMinimize}><Minus size={18} /></button>
        <button type="button" aria-label={`${title} ${maximized ? '이전 크기로' : '최대화'}`} title={maximized ? '이전 크기로' : '최대화'} onClick={() => setMaximized(!maximized)}>
          {maximized ? <Square size={15} /> : <Maximize2 size={16} />}
        </button>
        <button type="button" className="window-close" aria-label={`${title} 닫기`} title="닫기" onClick={onClose}><X size={20} /></button>
      </div>
    </div>
    <div className="os-window-content">{children}</div>
    {!maximized && <div className="window-resize-handle" aria-hidden="true" onPointerDown={(event) => startGesture(event, 'resize')} {...gestureEvents} />}
  </section>;
}

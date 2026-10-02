import { useEffect, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
import { activeWindow, type DesktopState, type WindowId } from '../desktopState';
import { programs } from '../programs';
import { PinkFolderIcon } from './PinkFolderIcon';

interface TaskbarProps {
  desktop: DesktopState;
  onOpenWindow: (windowId: WindowId) => void;
  onTaskClick: (windowId: WindowId) => void;
  currentTime: string;
}

export function Taskbar({ desktop, onOpenWindow, onTaskClick, currentTime }: TaskbarProps) {
  const [startOpen, setStartOpen] = useState(false);
  const startRef = useRef<HTMLDivElement>(null);
  const tasksRef = useRef<HTMLDivElement>(null);
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const active = activeWindow(desktop);

  useEffect(() => {
    if (!startOpen) return;
    const outside = (event: globalThis.PointerEvent) => {
      if (!startRef.current?.contains(event.target as Node)) setStartOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setStartOpen(false); startButtonRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [startOpen]);

  useEffect(() => {
    const selected = tasksRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (selected && tasksRef.current) {
      const area = tasksRef.current;
      if (selected.offsetLeft < area.scrollLeft) area.scrollLeft = selected.offsetLeft;
      else if (selected.offsetLeft + selected.offsetWidth > area.scrollLeft + area.clientWidth) area.scrollLeft = selected.offsetLeft + selected.offsetWidth - area.clientWidth;
    }
  }, [active]);

  return <footer className="os-taskbar" aria-label="작업 표시줄">
    <div className="start-area" ref={startRef}>
      <button type="button" className="start-button" ref={startButtonRef} aria-label="시작 메뉴" aria-expanded={startOpen} aria-controls="start-programs" onClick={() => setStartOpen(!startOpen)}>
        <Menu size={20} /><span>Start</span>
      </button>
      {startOpen && <nav id="start-programs" className="start-menu" aria-label="프로그램 실행">
        <strong>프로그램</strong>
        {programs.map((item) => <button type="button" key={item.id} onClick={() => { onOpenWindow(item.id); setStartOpen(false); }}><PinkFolderIcon variant={item.id === 'fileExplorer' || item.id === 'priceCalculator' ? 'kitty' : 'heart'} /><span>{item.label}</span></button>)}
      </nav>}
    </div>
    <div className="taskbar-divider" />
    <div className="taskbar-tasks" ref={tasksRef} role="group" aria-label="실행 중인 프로그램">
      {desktop.running.map((id) => {
        const item = programs.find((program) => program.id === id)!;
        const minimized = desktop.minimized.includes(id);
        return <button type="button" key={id} className={`taskbar-task${minimized ? ' is-minimized' : ''}`}
          aria-label={`${item.label}${minimized ? ' 복원' : ''}`} aria-pressed={active === id}
          title={`${item.label}${minimized ? ' — 최소화됨' : ''}`} onClick={() => onTaskClick(id)}>
          <PinkFolderIcon variant={id === 'fileExplorer' || id === 'priceCalculator' ? 'kitty' : 'heart'} /><span>{item.label}</span>
        </button>;
      })}
    </div>
    <time className="taskbar-clock">{currentTime}</time>
  </footer>;
}

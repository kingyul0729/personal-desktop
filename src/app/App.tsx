import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import {
  Calculator,
  FileText,
  Heart,
  Monitor,
  Settings,
  Terminal as TerminalIcon,
} from 'lucide-react';
import { DesktopIcon } from './components/DesktopIcon';
import { Taskbar } from './components/Taskbar';
import { Window } from './components/Window';
import { Terminal } from './components/Terminal';
import { FileExplorer } from './components/FileExplorer';
import { ControlPanel } from './components/ControlPanel';
import { ProgramManager } from './components/ProgramManager';
import { Notepad } from './components/Notepad';
import { PriceCalculator } from './components/PriceCalculator';
import { activeWindow, desktopReducer, initialDesktop, type WindowId } from './desktopState';
import { programs } from './programs';
import type { PinkFolderVariant } from './components/PinkFolderIcon';

const folderVariants: PinkFolderVariant[] = ['heart', 'kitty', 'flower', 'cherry', 'heart', 'kitty'];

export default function App() {
  const [desktop, dispatch] = useReducer(desktopReducer, initialDesktop);
  const workareaRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [currentTime, setCurrentTime] = useState('');
  const active = activeWindow(desktop);

  useLayoutEffect(() => {
    const element = workareaRef.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setBounds((previous) => previous.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  useEffect(() => {
    const update = () => setCurrentTime(new Date().toLocaleTimeString('ko-KR', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    }));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const openWindow = (id: WindowId) => dispatch({ type: 'open', id });

  const shared = (id: WindowId) => ({
    isOpen: desktop.running.includes(id),
    isMinimized: desktop.minimized.includes(id),
    isActive: active === id,
    bounds,
    onClose: () => dispatch({ type: 'close', id }),
    onMinimize: () => dispatch({ type: 'minimize', id }),
    zIndex: 10 + desktop.stack.indexOf(id),
    onFocus: () => dispatch({ type: 'focus', id }),
  });

  return (
    <main className="web-os">
      <div className="desktop-workarea" ref={workareaRef}>
      <section className="desktop-icon-column" aria-label="데스크톱 프로그램">
        {programs.map((item, index) => (
          <DesktopIcon key={item.id} variant={folderVariants[index]} icon={<item.icon size={48} strokeWidth={1.8} />} label={item.label} onClick={() => openWindow(item.id)} />
        ))}
      </section>
      <img className="desktop-kitty" src="/theme/kitty-peek.png" alt="" aria-hidden="true" draggable={false} />

      <Window title="Terminal" icon={<TerminalIcon size={18} />} defaultPosition={{ x: 255, y: 90 }} defaultSize={{ width: 720, height: 410 }} {...shared('terminal')}>
        <Terminal />
      </Window>
      <Window title="가격표 보관함" className="price-files-window" icon={<Heart size={22} />} defaultPosition={{ x: 240, y: 24 }} defaultSize={{ width: 920, height: 760 }} {...shared('fileExplorer')}>
        <FileExplorer />
      </Window>
      <Window title="Control Panel" icon={<Settings size={18} />} defaultPosition={{ x: 390, y: 190 }} defaultSize={{ width: 720, height: 500 }} {...shared('controlPanel')}>
        <ControlPanel />
      </Window>
      <Window title="Program Manager" icon={<Monitor size={18} />} defaultPosition={{ x: 440, y: 120 }} defaultSize={{ width: 680, height: 500 }} {...shared('programManager')}>
        <ProgramManager />
      </Window>
      <Window title="Notepad" icon={<FileText size={18} />} defaultPosition={{ x: 300, y: 135 }} defaultSize={{ width: 680, height: 480 }} {...shared('notepad')}>
        <Notepad />
      </Window>
      <Window title="금액 계산" icon={<Calculator size={18} />} defaultPosition={{ x: 250, y: 52 }} defaultSize={{ width: 980, height: 680 }} {...shared('priceCalculator')}>
        <PriceCalculator />
      </Window>

      </div>
      <Taskbar desktop={desktop} onOpenWindow={openWindow} onTaskClick={(id) => dispatch({ type: 'taskbar', id })} currentTime={currentTime} />
    </main>
  );
}

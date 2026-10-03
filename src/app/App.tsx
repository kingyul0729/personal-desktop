import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import {
  Calculator,
  FileText,
  FolderOpen,
  Heart,
  Monitor,
  Settings,
  Terminal as TerminalIcon,
  Trash2,
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
import { FileWindow } from './components/FileWindow';
import { TrashWindow } from './components/TrashWindow';
import { EntryBadge } from './components/EntryIcon';
import { activeWindow, desktopReducer, initialDesktop, type WindowId } from './desktopState';
import { createLongPress, desktopMenu, entryKind, iconArt, menuFor, type DesktopEntry } from './desktopModel';
import { DesktopProvider, useDesktop } from './useDesktop';
import { DEFAULT_ICONS, libraryIconSrc } from './iconLibrary';

export default function App() {
  const [desktop, dispatch] = useReducer(desktopReducer, initialDesktop);
  return <DesktopProvider openWindow={(id) => dispatch({ type: 'open', id })}>
    <DesktopShell desktop={desktop} dispatch={dispatch} />
  </DesktopProvider>;
}

function DesktopShell({ desktop, dispatch }: { desktop: typeof initialDesktop; dispatch: (action: Parameters<typeof desktopReducer>[1]) => void }) {
  const shell = useDesktop();
  const { data, act, notify } = shell;
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
  const report = (result: { ok: boolean; error?: string }, done = '') => notify(result.ok ? done : result.error ?? '');
  // Three different removals: programs are only hidden, shortcuts are removed from the desktop,
  // and real files move to the trash. None of them deletes data here.
  const runEntry = (entry: DesktopEntry, action: ReturnType<typeof menuFor>[number]['action']) => {
    const fileId = entry.target.startsWith('file:') ? entry.target.slice(5) : '';
    if (action === 'open') openEntry(entry);
    else if (action === 'rename') shell.setRenaming(entry.id);
    else if (action === 'icon') void shell.pickIcon(entry.icon).then(icon => { if (icon !== undefined) void act({ action: 'update-item', id: entry.id, icon }).then(result => report(result)); });
    else if (action === 'hide') void act({ action: 'update-item', id: entry.id, hidden: true }).then(result => report(result, '숨겼습니다. 환경설정 › 바탕화면에서 다시 표시할 수 있습니다.'));
    else if (action === 'remove') void act({ action: 'remove-shortcut', id: entry.id }).then(result => report(result, '바탕화면에서 제거했습니다. 연결된 원본은 그대로입니다.'));
    else if (action === 'security') shell.openSettings('security', fileId);
    else if (action === 'trash') void act({ action: 'trash-file', id: fileId }).then(result => report(result, '휴지통으로 이동했습니다.'));
  };
  const openEntry = (entry: DesktopEntry) => {
    if (entry.missing) { notify('연결된 항목이 휴지통에 있거나 삭제되었습니다.'); return; }
    shell.openTarget(entry.target);
  };
  const rename = (entry: DesktopEntry, name: string) => {
    shell.setRenaming(null);
    const body = entry.kind === 'file' ? { action: 'rename-file', id: entry.target.slice(5), name } : { action: 'update-item', id: entry.id, label: name };
    void act(body).then(result => report(result));
  };
  const runDesktop = async (action: ReturnType<typeof desktopMenu>[number]['action']) => {
    if (action === 'settings') shell.openSettings(shell.settingsTab);
    else if (action === 'wallpaper') shell.openSettings('wallpaper');
    else {
      const result = await act({ action: 'create-file', kind: action === 'new-file' ? 'file' : 'folder', name: action === 'new-file' ? '새 파일' : '새 폴더', parentId: null });
      if (!result.ok) { notify(result.error); return; }
      const created = result.data.items.find(item => item.target === `file:${result.data.created}`);
      if (created) shell.setRenaming(created.id);
    }
  };
  const blankMenu = (point: { x: number; y: number }) => shell.showMenu(point, desktopMenu(data.authenticated).map(({ action, label }) => ({ label, onSelect: () => void runDesktop(action) })));
  const blankPress = useRef(createLongPress(point => blankMenuRef.current(point)));
  const blankMenuRef = useRef(blankMenu); blankMenuRef.current = blankMenu;
  const onBlank = (target: EventTarget) => !(target as HTMLElement).closest('.os-window, .desktop-icon, .context-menu');
  const wallpaper = data.settings.wallpaper;

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
    <main className="web-os" style={{ backgroundImage: wallpaper ? `url(${wallpaper.src})` : undefined, backgroundSize: data.settings.fit }}>
      <div className="desktop-workarea" ref={workareaRef}
        onContextMenu={(event) => { if (!onBlank(event.target)) return; event.preventDefault(); blankPress.current.cancel(); blankMenu({ x: event.clientX, y: event.clientY }); }}
        onPointerDown={(event) => { if (event.pointerType !== 'mouse' && onBlank(event.target)) blankPress.current.down(event); }}
        onPointerMove={(event) => blankPress.current.move(event)}
        onPointerUp={() => blankPress.current.up()}
        onPointerCancel={() => blankPress.current.cancel()}>
      <section className="desktop-icon-column" aria-label="데스크톱 프로그램">
        {data.items.filter((item) => !item.hidden).map((item) => {
          const art = iconArt(item, data.assets, { trashFull: data.trash.length > 0 });
          return <DesktopIcon key={item.id} variant={art.variant} image={art.image} locked={item.locked} dimmed={item.missing}
            icon={<EntryBadge target={item.target} fileKind={item.fileKind} />} label={item.label}
            onClick={() => openEntry(item)}
            onMenu={(point) => shell.showMenu(point, menuFor(entryKind(item), data.authenticated).map(({ action, label }) => ({ label, onSelect: () => runEntry(item, action) })))}
            renaming={shell.renaming === item.id} onCancelRename={() => shell.setRenaming(null)} onRename={(name) => rename(item, name)} />;
        })}
      </section>
      {shell.notice && <p className="desktop-notice" role="status">{shell.notice}</p>}
      <img className="desktop-kitty" src="/theme/kitty-peek.png" alt="" aria-hidden="true" draggable={false} />

      <Window title="Terminal" icon={<TerminalIcon size={18} />} defaultPosition={{ x: 255, y: 90 }} defaultSize={{ width: 720, height: 410 }} {...shared('terminal')}>
        <Terminal />
      </Window>
      <Window title="가격표 보관함" className="price-files-window" icon={<Heart size={22} />} defaultPosition={{ x: 240, y: 24 }} defaultSize={{ width: 920, height: 760 }} {...shared('fileExplorer')}>
        <FileExplorer />
      </Window>
      <Window title="환경설정" className="settings-window" icon={<Settings size={18} />} defaultPosition={{ x: 390, y: 190 }} defaultSize={{ width: 720, height: 500 }} {...shared('controlPanel')}>
        <ControlPanel />
      </Window>
      <Window title="Program Manager" icon={<Monitor size={18} />} defaultPosition={{ x: 440, y: 120 }} defaultSize={{ width: 680, height: 500 }} {...shared('programManager')}>
        <ProgramManager />
      </Window>
      <Window title="메모장" icon={<FileText size={18} />} defaultPosition={{ x: 300, y: 135 }} defaultSize={{ width: 680, height: 480 }} {...shared('notepad')}>
        <Notepad />
      </Window>
      <Window title="휴지통" icon={<Trash2 size={18} />} defaultPosition={{ x: 330, y: 110 }} defaultSize={{ width: 640, height: 460 }} {...shared('trash')}>
        <TrashWindow />
      </Window>
      <Window title="파일" icon={<FolderOpen size={18} />} defaultPosition={{ x: 280, y: 70 }} defaultSize={{ width: 700, height: 500 }} {...shared('files')}>
        <FileWindow />
      </Window>
      <Window title="금액 계산" icon={<Calculator size={18} />} defaultPosition={{ x: 250, y: 52 }} defaultSize={{ width: 980, height: 680 }} {...shared('priceCalculator')}>
        <PriceCalculator />
      </Window>

      </div>
      <Taskbar desktop={desktop} onOpenWindow={openWindow} onTaskClick={(id) => dispatch({ type: 'taskbar', id })} currentTime={currentTime}
        iconFor={(id) => { const entry = data.items.find((item) => item.target === `program:${id}`); return iconArt(entry ?? { icon: null, target: `program:${id}` }, data.assets, { trashFull: data.trash.length > 0 }).image ?? (id === 'files' ? libraryIconSrc(DEFAULT_ICONS.folder) : undefined); }} />
    </main>
  );
}

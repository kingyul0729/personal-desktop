import { useEffect, useReducer, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { StudyArchive } from './components/StudyArchive';
import { WorkLibrary } from './components/WorkLibrary';
import { FileExplorer } from './components/FileExplorer';
import { ControlPanel } from './components/ControlPanel';
import { Notepad } from './components/Notepad';
import { PriceCalculator } from './components/PriceCalculator';
import { FileWindow } from './components/FileWindow';
import { TrashWindow } from './components/TrashWindow';
import { activeWindow, desktopReducer, initialDesktop, type WindowId } from './desktopState';
import { DesktopProvider, useDesktop } from './useDesktop';
import { DesktopNotice, LoadingBox } from './components/Feedback';

// 앱 화면: 왼쪽 고정 메뉴 + 오른쪽 선택한 화면. 떠다니는 창·작업표시줄은 쓰지 않는다.
// 한 번 연 화면은 숨겨 둘 뿐 닫지 않아서, 메뉴를 오가도 입력 중인 내용(계산기 등)이 남는다.
export const SIDEBAR_GROUPS: { title: string; items: { id: WindowId; label: string }[] }[] = [
  { title: '업무', items: [{ id: 'fileExplorer', label: '가격표' }, { id: 'priceCalculator', label: '금액 계산' }, { id: 'workLibrary', label: '업무 자료' }] },
  { title: '개인', items: [{ id: 'terminal', label: '공부 보관함' }, { id: 'notepad', label: '메모장' }] },
];
const HOME: WindowId = 'fileExplorer';
// 메뉴에 없는 화면(환경설정에서 여는 휴지통·파일)은 제목 줄과 닫기 버튼을 붙여 보여 준다.
const SECONDARY: Partial<Record<WindowId, string>> = { trash: '휴지통', files: '파일' };

export default function App() {
  const [desktop, dispatch] = useReducer(desktopReducer, initialDesktop, state => desktopReducer(state, { type: 'open', id: HOME }));
  return <DesktopProvider openWindow={(id) => dispatch({ type: 'open', id })}>
    <AppShell desktop={desktop} dispatch={dispatch} />
  </DesktopProvider>;
}

export function AppShell({ desktop, dispatch }: { desktop: typeof initialDesktop; dispatch: (action: Parameters<typeof desktopReducer>[1]) => void }) {
  const shell = useDesktop();
  const active = activeWindow(desktop) ?? HOME;
  const [studyDirty, setStudyDirty] = useState(false);
  const [workDirty, setWorkDirty] = useState(false);
  const open = (id: WindowId) => dispatch({ type: 'open', id });
  // 메뉴에 없는 화면을 보고 있으면 환경설정을 선택된 것으로 보여 준다.
  const selected = SECONDARY[active] ? 'controlPanel' : active;

  // 화면을 바꿔도 작성 중인 기록은 그대로 남는다. 페이지를 떠날 때만 저장 안 된 내용을 알린다.
  useEffect(() => {
    if (!studyDirty && !workDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [studyDirty, workDirty]);

  const pane = (id: WindowId, label: string, children: ReactNode) => desktop.running.includes(id)
    ? <section key={id} className={`app-pane app-pane-${id}`} aria-label={label} hidden={active !== id}>
      {SECONDARY[id] && <header className="app-pane-head"><h1>{label}</h1>
        <button type="button" aria-label={`${label} 닫기`} onClick={() => dispatch({ type: 'close', id })}><X size={16} />닫기</button></header>}
      <div className="app-pane-body">{children}</div>
    </section> : null;

  return <main className="web-os app-shell">
    <nav className="app-sidebar" aria-label="메뉴">
      <p className="app-brand">다채움</p>
      {SIDEBAR_GROUPS.map(group => <div key={group.title} className="app-nav-group">
        <p className="app-nav-title">{group.title}</p>
        <ul>{group.items.map(item => <li key={item.id}>
          <button type="button" aria-current={selected === item.id ? 'page' : undefined} onClick={() => open(item.id)}>{item.label}</button>
        </li>)}</ul>
      </div>)}
      <div className="app-nav-bottom">
        <button type="button" aria-current={selected === 'controlPanel' ? 'page' : undefined} onClick={() => open('controlPanel')}>환경설정</button>
      </div>
    </nav>
    <div className="app-content">
      {!shell.loaded && <div className="desktop-loading"><LoadingBox label="불러오는 중…" /></div>}
      {shell.notice && <DesktopNotice message={shell.notice} onClose={() => shell.notify('')} />}
      {pane('fileExplorer', '가격표 보관함', <FileExplorer />)}
      {pane('priceCalculator', '금액 계산', <PriceCalculator />)}
      {pane('workLibrary', '업무 자료', <WorkLibrary onDirtyChange={setWorkDirty} />)}
      {pane('terminal', '공부 보관함', <StudyArchive onDirtyChange={setStudyDirty} />)}
      {pane('notepad', '메모장', <Notepad />)}
      {pane('controlPanel', '환경설정', <ControlPanel />)}
      {pane('trash', '휴지통', <TrashWindow />)}
      {pane('files', '파일', <FileWindow />)}
    </div>
  </main>;
}

import { useEffect, useReducer, useState, type ReactNode } from 'react';
import { BookOpen, Calculator, FileText, FolderOpen, LayoutGrid, Presentation, Settings, Trash2, X, type LucideIcon } from 'lucide-react';
import { StudyArchive } from './components/StudyArchive';
import { WorkLibrary } from './components/WorkLibrary';
import { FileExplorer } from './components/FileExplorer';
import { ProgramGuide } from './components/ProgramGuide';
import { ControlPanel } from './components/ControlPanel';
import { Notepad } from './components/Notepad';
import { PriceCalculator } from './components/PriceCalculator';
import { FileWindow } from './components/FileWindow';
import { TrashWindow } from './components/TrashWindow';
import { FinderMain, FinderPath } from './components/FinderFrame';
import { activeWindow, desktopReducer, initialDesktop, type WindowId } from './desktopState';
import { DesktopProvider, useDesktop } from './useDesktop';
import { DesktopNotice, LoadingBox } from './components/Feedback';

// 앱 화면은 Finder 창 하나: 왼쪽 메뉴 + 오른쪽(도구 막대·내용·경로·상태). 떠다니는 창·작업표시줄은 없다.
// 한 번 연 화면은 숨겨 두기만 해서 메뉴를 오가도 입력 중인 내용(계산기 등)이 남는다.
type MenuItem = { id: WindowId; label: string; icon: LucideIcon };
export const SIDEBAR_GROUPS: { title: string; items: MenuItem[] }[] = [
  { title: '업무', items: [{ id: 'fileExplorer', label: '가격표', icon: FolderOpen }, { id: 'programGuide', label: '프로그램 안내', icon: LayoutGrid }, { id: 'priceCalculator', label: '금액 계산', icon: Calculator }, { id: 'workLibrary', label: '업무 자료', icon: Presentation }] },
  { title: '개인', items: [{ id: 'terminal', label: '공부 보관함', icon: BookOpen }, { id: 'notepad', label: '메모장', icon: FileText }] },
  { title: '설정', items: [{ id: 'controlPanel', label: '환경설정', icon: Settings }] },
];
const HOME: WindowId = 'fileExplorer';
// 메뉴에 없는 화면(환경설정에서 여는 휴지통·파일)은 환경설정 아래에 있는 것으로 보이고 닫기 버튼이 붙는다.
const SECONDARY: Partial<Record<WindowId, { label: string; icon: LucideIcon }>> = { trash: { label: '휴지통', icon: Trash2 }, files: { label: '파일', icon: FolderOpen } };
const menuOf = (id: WindowId) => SIDEBAR_GROUPS.flatMap(group => group.items.map(item => ({ ...item, group: group.title }))).find(item => item.id === id);

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
  const selected = SECONDARY[active] ? 'controlPanel' : active;

  // ‹ › 는 지나온 화면 순서대로 오간다(가격표 안에서는 폴더 단위로 따로 움직인다).
  const [history, setHistory] = useState<{ list: WindowId[]; at: number }>({ list: [active], at: 0 });
  useEffect(() => {
    setHistory(current => current.list[current.at] === active ? current : { list: [...current.list.slice(0, current.at + 1), active], at: current.at + 1 });
  }, [active]);
  const step = (delta: number) => {
    const at = history.at + delta;
    if (at < 0 || at >= history.list.length) return;
    setHistory({ ...history, at });
    open(history.list[at]);
  };
  const back = history.at > 0 ? () => step(-1) : undefined;
  const forward = history.at < history.list.length - 1 ? () => step(1) : undefined;

  // 화면을 바꿔도 작성 중인 기록은 그대로 남는다. 페이지를 떠날 때만 저장 안 된 내용을 알린다.
  useEffect(() => {
    if (!studyDirty && !workDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [studyDirty, workDirty]);

  const pathFor = (id: WindowId) => {
    const secondary = SECONDARY[id];
    if (secondary) return <FinderPath parts={[{ icon: <Settings size={14} strokeWidth={1.7} />, label: '환경설정', onClick: () => open('controlPanel') }, { icon: <secondary.icon size={14} strokeWidth={1.7} />, label: secondary.label }]} />;
    const item = menuOf(id)!;
    return <FinderPath parts={[{ icon: <FolderOpen size={14} strokeWidth={1.7} />, label: item.group }, { icon: <item.icon size={14} strokeWidth={1.7} />, label: item.label }]} />;
  };
  // 가격표는 폴더를 오가는 Finder 화면을 스스로 그리고, 나머지는 같은 틀 안에 내용을 넣는다.
  const pane = (id: WindowId, content: ReactNode) => {
    if (!desktop.running.includes(id)) return null;
    const label = SECONDARY[id]?.label ?? menuOf(id)!.label;
    return <section key={id} className={`app-pane app-pane-${id}`} aria-label={label} hidden={active !== id}>
      {id === 'fileExplorer' ? <FileExplorer /> : id === 'programGuide' ? <ProgramGuide />
        : <FinderMain title={label} onBack={back} onForward={forward} path={pathFor(id)}
          tools={SECONDARY[id] ? <button type="button" aria-label={`${label} 닫기`} title="닫기" onClick={() => dispatch({ type: 'close', id })}><X size={19} strokeWidth={1.6} /></button> : undefined}>
          {content}
        </FinderMain>}
    </section>;
  };

  return <main className="web-os app-shell">
    <section className="desktop-finder app-finder" aria-label="다채움">
      <nav className="finder-sidebar" aria-label="메뉴">
        <div className="finder-lights" aria-hidden="true"><i /><i /><i /></div>
        {SIDEBAR_GROUPS.map(group => <div key={group.title} className={`finder-group${group.title === '설정' ? ' finder-group-bottom' : ''}`}>
          <p>{group.title}</p>
          {group.items.map(item => <button key={item.id} type="button" aria-pressed={selected === item.id} aria-current={selected === item.id ? 'page' : undefined} onClick={() => open(item.id)}>
            <item.icon size={17} strokeWidth={1.7} /><span>{item.label}</span>
          </button>)}
        </div>)}
      </nav>
      <div className="app-content">
        {!shell.loaded && <div className="desktop-loading"><LoadingBox label="불러오는 중…" /></div>}
        {shell.notice && <DesktopNotice message={shell.notice} onClose={() => shell.notify('')} />}
        {pane('fileExplorer', null)}
        {pane('programGuide', null)}
        {pane('priceCalculator', <PriceCalculator />)}
        {pane('workLibrary', <WorkLibrary onDirtyChange={setWorkDirty} />)}
        {pane('terminal', <StudyArchive onDirtyChange={setStudyDirty} />)}
        {pane('notepad', <Notepad />)}
        {pane('controlPanel', <ControlPanel />)}
        {pane('trash', <TrashWindow />)}
        {pane('files', <FileWindow />)}
      </div>
    </section>
  </main>;
}

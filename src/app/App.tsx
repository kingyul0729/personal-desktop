import { Fragment, useEffect, useReducer, useState, type ReactNode } from 'react';
import { ToneDot } from './components/ToneFolder';
import { ArrowLeftRight, BookOpen, Calculator, CalendarCheck, CalendarDays, ChevronDown, ClipboardCheck, FileBarChart, GraduationCap, ShoppingCart, FileText, FolderOpen, Settings, Trash2, X, type LucideIcon } from 'lucide-react';
import { StudyArchive, STUDY_CATEGORIES } from './components/StudyArchive';
import { FileExplorer } from './components/FileExplorer';
import { ControlPanel } from './components/ControlPanel';
import { Notepad } from './components/Notepad';
import { PriceCalculator } from './components/PriceCalculator';
import { FileWindow } from './components/FileWindow';
import { TrashWindow } from './components/TrashWindow';
import { FinderMain, FinderPath } from './components/FinderFrame';
import StaffSchedule from './components/StaffSchedule';
import StaffLeave from './components/StaffLeave';
import { StockCheck, StockMove, StockOrder, StockReport } from './components/Inventory';
import { activeWindow, desktopReducer, initialDesktop, type WindowId } from './desktopState';
import { DesktopProvider, useDesktop } from './useDesktop';
import { DesktopNotice, LoadingBox } from './components/Feedback';

// 앱 화면은 Finder 창 하나: 왼쪽 메뉴 + 오른쪽(도구 막대·내용·경로·상태). 떠다니는 창·작업표시줄은 없다.
// 한 번 연 화면은 숨겨 두기만 해서 메뉴를 오가도 입력 중인 내용(계산기 등)이 남는다.
type MenuItem = { id: WindowId; label: string; icon: LucideIcon };
// 2026-11-07 사용자 지정 구성: 상담 / 재고 / 직원 / 개인 (+ 맨 아래 설정). 묶음 이름(▶)을 누르면 접고 펼친다.
export const SIDEBAR_GROUPS: { title: string; items: MenuItem[] }[] = [
  { title: '상담', items: [{ id: 'fileExplorer', label: '가격표', icon: FolderOpen }, { id: 'priceCalculator', label: '계산', icon: Calculator }] },
  { title: '재고', items: [{ id: 'stockCheck', label: '재고체크', icon: ClipboardCheck }, { id: 'stockOrder', label: '재고주문', icon: ShoppingCart }, { id: 'stockMove', label: '재고입출고', icon: ArrowLeftRight }, { id: 'stockReport', label: '월말/연말보고서', icon: FileBarChart }] },
  { title: '직원', items: [{ id: 'staffSchedule', label: '직원스케줄/성과표', icon: CalendarDays }, { id: 'staffLeave', label: '직원연차', icon: CalendarCheck }, { id: 'staffTraining', label: '신입교육', icon: GraduationCap }] },
  { title: '개인', items: [{ id: 'terminal', label: '공부', icon: BookOpen }, { id: 'notepad', label: '메모', icon: FileText }] },
  { title: '설정', items: [{ id: 'trash', label: '휴지통', icon: Trash2 }, { id: 'controlPanel', label: '환경설정', icon: Settings }] },
];
// 아직 기존 자료 파일을 옮겨 오기 전인 화면
const PENDING: Partial<Record<WindowId, string>> = {
  staffTraining: '신입 직원 교육 자료',
};
const HOME: WindowId = 'fileExplorer';
// 메뉴에 없는 화면(환경설정에서 여는 휴지통·파일)은 환경설정 아래에 있는 것으로 보이고 닫기 버튼이 붙는다.
const SECONDARY: Partial<Record<WindowId, { label: string; icon: LucideIcon }>> = { files: { label: '파일', icon: FolderOpen } };
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
  const open = (id: WindowId) => dispatch({ type: 'open', id });
  const selected = SECONDARY[active] ? 'controlPanel' : active;
  // 가격표 폴더: 왼쪽 메뉴 '가격표' 아래에 이름을 펼쳐 바로 이동
  // 왼쪽 메뉴 아코디언: 하위 항목(가격표 폴더·공부 주제·업무 자료 분류)이 있는 메뉴는 ˅ 로 접고 펼친다. 펼침 상태는 기기에 기억.
  type Sub = { id: string; name: string; count?: number };
  const ROOT: Partial<Record<WindowId, string>> = { fileExplorer: 'root', terminal: 'all' };
  // 화면을 아직 안 열었어도 메뉴에 보이도록 기본 목록(열면 실제 목록·개수로 바뀐다)
  const [subs, setSubs] = useState<Partial<Record<WindowId, Sub[]>>>({
    terminal: STUDY_CATEGORIES.map(name => ({ id: `cat:${name}`, name })),
  });
  const [gotos, setGotos] = useState<Partial<Record<WindowId, { id: string; n: number }>>>({});
  const [ats, setAts] = useState<Partial<Record<WindowId, string>>>({});
  // 처음엔 모두 접힌 상태. 메뉴 이름을 누르면 그 화면이 열리면서 하위 목록이 펼쳐지고, 다시 누르면 접힌다.
  const [expanded, setExpanded] = useState<Partial<Record<WindowId, boolean>>>({});
  // 묶음(상담·재고·직원·개인): 처음엔 지금 보고 있는 화면의 묶음만 펼친다.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => ({ [SIDEBAR_GROUPS.find(group => group.items.some(item => item.id === HOME))?.title ?? '']: true }));
  const goSub = (id: WindowId, sub: string) => { open(id); setGotos(current => ({ ...current, [id]: { id: sub, n: (current[id]?.n ?? 0) + 1 } })); };
  const sub = (id: WindowId) => ({
    onSubs: (list: Sub[]) => setSubs(current => ({ ...current, [id]: list })),
    goto: gotos[id],
    onLocation: (at: string) => setAts(current => ({ ...current, [id]: at })),
  });

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
    if (!studyDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [studyDirty]);

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
      {id === 'terminal' ? content : id === 'fileExplorer' ? <FileExplorer onFolders={sub('fileExplorer').onSubs} goto={gotos.fileExplorer} onLocation={sub('fileExplorer').onLocation} />
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
        {SIDEBAR_GROUPS.map(group => { const fixed = group.title === '설정'; const groupOpen = fixed || !!openGroups[group.title]; return <div key={group.title} className={`finder-group${fixed ? ' finder-group-bottom' : ''}${groupOpen ? '' : ' is-closed'}`}>
          {fixed ? <p>{group.title}</p> : <button type="button" className="finder-group-head" aria-expanded={groupOpen} onClick={() => setOpenGroups(groupOpen ? {} : { [group.title]: true })}><ChevronDown size={13} strokeWidth={2} aria-hidden="true" />{group.title}</button>}
          {groupOpen && <>
          {group.items.map(item => { const children = subs[item.id] ?? []; const root = ROOT[item.id]; const at = ats[item.id] ?? root; const isOpen = !!expanded[item.id] && children.length > 0;
            return <Fragment key={item.id}>
            <div className="finder-item">
              <button type="button" aria-pressed={selected === item.id && (!root || at === root || !children.some(child => child.id === at))} aria-current={selected === item.id ? 'page' : undefined} aria-expanded={children.length ? isOpen : undefined}
                onClick={() => { if (root) goSub(item.id, root); else open(item.id); if (children.length) setExpanded(current => ({ ...current, [item.id]: !isOpen })); }}>
                <item.icon size={17} strokeWidth={1.7} /><span>{item.label}</span>
                {children.length > 0 && <ChevronDown className="finder-chevron" size={15} strokeWidth={1.8} aria-hidden="true" />}
              </button>
            </div>
            {isOpen && <div className="finder-sub" role="group" aria-label={`${item.label} 하위 목록`}>
              {children.map(child => <button key={child.id} type="button" aria-pressed={selected === item.id && at === child.id} onClick={() => goSub(item.id, child.id)}>
                <ToneDot name={child.name} /><span>{child.name}</span>{child.count !== undefined && <small>{child.count}</small>}
              </button>)}
            </div>}
          </Fragment>; })}
          </>}
        </div>; })}
      </nav>
      <div className="app-content">
        {!shell.loaded && <div className="desktop-loading"><LoadingBox label="불러오는 중…" /></div>}
        {shell.notice && <DesktopNotice message={shell.notice} onClose={() => shell.notify('')} />}
        {pane('fileExplorer', null)}
        {pane('priceCalculator', <PriceCalculator />)}
                {pane('terminal', <StudyArchive onDirtyChange={setStudyDirty} {...sub('terminal')} />)}
        {pane('notepad', <Notepad />)}
        {pane('staffSchedule', <StaffSchedule />)}
        {pane('staffLeave', <StaffLeave />)}
        {pane('stockCheck', <StockCheck />)}
        {pane('stockOrder', <StockOrder />)}
        {pane('stockMove', <StockMove />)}
        {pane('stockReport', <StockReport />)}
        {(Object.keys(PENDING) as WindowId[]).map(id => pane(id, <div className="pending-screen"><strong>{menuOf(id)!.label}</strong><p>{PENDING[id]}</p><small>준비 중이에요.</small></div>))}
        {pane('controlPanel', <ControlPanel />)}
        {pane('trash', <TrashWindow />)}
        {pane('files', <FileWindow />)}
      </div>
    </section>
  </main>;
}

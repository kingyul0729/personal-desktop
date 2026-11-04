import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Briefcase, ChevronLeft, ChevronRight, FolderOpen, LayoutGrid, List, Monitor, Search, User, Wrench, X } from 'lucide-react';
import { programs, type Space } from '../programs';
import type { DesktopEntry } from '../desktopModel';

// The desktop as a file-explorer window: spaces on the left, the chosen space's programs,
// shortcuts and files on the right. It only arranges what the desktop already shows;
// opening, renaming and the context menus stay with the icons themselves.
export type FinderSection = 'all' | Space | 'files';

export const finderSections: { id: FinderSection; label: string; group: '공간' | '보관' }[] = [
  { id: 'all', label: '전체', group: '공간' },
  { id: 'A', label: 'A · 개인 공간', group: '공간' },
  { id: 'B', label: 'B · 업무 공간', group: '공간' },
  { id: 'common', label: '공통 도구', group: '공간' },
  { id: 'files', label: '바탕화면 파일', group: '보관' },
];
const sectionIcon: Record<FinderSection, typeof User> = { all: Monitor, A: User, B: Briefcase, common: Wrench, files: FolderOpen };
const STORAGE_KEY = 'desktop-finder';

// A program belongs to its space; a shortcut to a program follows that program; anything else is a desktop file.
export function finderSectionOf(item: Pick<DesktopEntry, 'kind' | 'target'>): Exclude<FinderSection, 'all'> {
  const program = item.target.startsWith('program:') ? programs.find(entry => item.target === `program:${entry.id}`) : undefined;
  return program && item.kind !== 'file' ? program.space : 'files';
}

export function finderItems<T extends Pick<DesktopEntry, 'kind' | 'target' | 'label' | 'hidden'>>(items: T[], section: FinderSection, query = '') {
  const q = query.trim().toLocaleLowerCase('ko');
  return items.filter(item => !item.hidden && (section === 'all' || finderSectionOf(item) === section)
    && (!q || item.label.toLocaleLowerCase('ko').includes(q)));
}

type Saved = { section: FinderSection; view: 'grid' | 'list'; size: number };
function loadSaved(): Saved {
  const fallback: Saved = { section: 'all', view: 'grid', size: 100 };
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return {
      section: finderSections.some(entry => entry.id === value?.section) ? value.section : fallback.section,
      view: value?.view === 'list' ? 'list' : 'grid',
      size: Number.isFinite(value?.size) ? Math.min(130, Math.max(80, value.size)) : fallback.size,
    };
  } catch { return fallback; }
}

export function DesktopFinder({ items, renderItem, loading, focusId }: { items: DesktopEntry[]; renderItem: (item: DesktopEntry) => ReactNode; loading?: boolean; focusId?: string | null }) {
  const [saved] = useState(loadSaved);
  const [history, setHistory] = useState<{ list: FinderSection[]; at: number }>({ list: [saved.section], at: 0 });
  const [view, setView] = useState(saved.view), [size, setSize] = useState(saved.size);
  const [query, setQuery] = useState(''), [searching, setSearching] = useState(false);
  const section = history.list[history.at];
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ section, view, size })); } catch { /* per-viewer convenience only */ } }, [section, view, size]);

  const go = (next: FinderSection) => {
    setQuery(''); setSearching(false);
    if (next !== section) setHistory(({ list, at }) => ({ list: [...list.slice(0, at + 1), next], at: at + 1 }));
  };
  const step = (delta: number) => setHistory(({ list, at }) => ({ list, at: Math.min(list.length - 1, Math.max(0, at + delta)) }));
  // An item being renamed (for example a file just created) must be on screen: show its section.
  useEffect(() => {
    const item = focusId ? items.find(entry => entry.id === focusId) : undefined;
    if (item && section !== 'all' && finderSectionOf(item) !== section) go(finderSectionOf(item));
  }, [focusId, items]);

  const visible = finderItems(items, section, query);
  const current = finderSections.find(entry => entry.id === section)!;
  const CurrentIcon = sectionIcon[section];

  return <section className="desktop-finder" aria-label="바탕화면">
    <aside className="finder-sidebar" aria-label="바탕화면 공간">
      <div className="finder-lights" aria-hidden="true"><i /><i /><i /></div>
      {(['공간', '보관'] as const).map(group => <div key={group} className="finder-group">
        <p>{group}</p>
        {finderSections.filter(entry => entry.group === group).map(entry => {
          const Icon = sectionIcon[entry.id];
          return <button key={entry.id} type="button" aria-pressed={section === entry.id} onClick={() => go(entry.id)}><Icon size={17} strokeWidth={1.7} /><span>{entry.label}</span></button>;
        })}
      </div>)}
    </aside>
    <div className="finder-main">
      <header className="finder-toolbar">
        <div className="finder-history">
          <button type="button" aria-label="뒤로" disabled={history.at === 0} onClick={() => step(-1)}><ChevronLeft size={22} strokeWidth={1.6} /></button>
          <button type="button" aria-label="앞으로" disabled={history.at >= history.list.length - 1} onClick={() => step(1)}><ChevronRight size={22} strokeWidth={1.6} /></button>
        </div>
        <h1>{current.label}</h1>
        <div className="finder-tools">
          <div className="finder-view" role="group" aria-label="보기 방식">
            <button type="button" aria-label="아이콘 보기" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid size={18} strokeWidth={1.6} /></button>
            <button type="button" aria-label="목록 보기" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={18} strokeWidth={1.6} /></button>
          </div>
          {searching || query ? <label className="finder-search"><Search size={15} /><input autoFocus type="search" aria-label="바탕화면 항목 검색" placeholder="검색" value={query}
            onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setQuery(''); setSearching(false); } }} onBlur={() => { if (!query) setSearching(false); }} />
            {query && <button type="button" aria-label="검색어 지우기" onClick={() => { setQuery(''); setSearching(false); }}><X size={14} /></button>}</label>
            : <button type="button" className="finder-search-button" aria-label="검색" onClick={() => setSearching(true)}><Search size={19} strokeWidth={1.6} /></button>}
        </div>
      </header>
      <div className={`finder-grid${view === 'list' ? ' is-list' : ''}`} style={{ ['--finder-scale' as string]: size / 100 } as CSSProperties}>
        {visible.map(renderItem)}
        {!visible.length && !loading && <p className="finder-empty">{query ? '검색한 항목이 없습니다.' : section === 'files' ? '빈 곳을 오른쪽 클릭하거나 길게 눌러 새 파일·폴더를 만들 수 있습니다.' : '표시할 항목이 없습니다.'}</p>}
      </div>
      <footer className="finder-path"><Monitor size={14} strokeWidth={1.7} /><span>바탕화면</span><ChevronRight size={12} /><CurrentIcon size={14} strokeWidth={1.7} /><span>{current.label}</span></footer>
      <footer className="finder-status">
        <span>{visible.length}개 항목{query ? ` · ‘${query.trim()}’ 검색` : ''}</span>
        {view === 'grid' && <input type="range" min={80} max={130} step={5} value={size} aria-label="아이콘 크기" onChange={event => setSize(Number(event.target.value))} />}
      </footer>
    </div>
  </section>;
}

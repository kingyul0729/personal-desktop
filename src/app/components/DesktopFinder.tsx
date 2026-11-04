import { useEffect, useState, type ReactNode } from 'react';
import { Briefcase, ChevronRight, FolderOpen, LayoutGrid, Search, User, Wrench, X } from 'lucide-react';
import { programs, type Space } from '../programs';
import type { DesktopEntry } from '../desktopModel';

// The desktop as a file-explorer workspace: spaces on the left, the chosen space's programs,
// shortcuts and files as a grid on the right. It only arranges what the desktop already shows;
// opening, renaming and the context menus stay with the icons themselves.
export type FinderSection = 'all' | Space | 'files';

export const finderSections: { id: FinderSection; label: string; group: '공간' | '보관' }[] = [
  { id: 'all', label: '전체', group: '공간' },
  { id: 'A', label: 'A · 개인 공간', group: '공간' },
  { id: 'B', label: 'B · 업무 공간', group: '공간' },
  { id: 'common', label: '공통 도구', group: '공간' },
  { id: 'files', label: '바탕화면 파일', group: '보관' },
];
const sectionIcon: Record<FinderSection, typeof User> = { all: LayoutGrid, A: User, B: Briefcase, common: Wrench, files: FolderOpen };
const STORAGE_KEY = 'desktop-finder-section';

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

export function DesktopFinder({ items, renderItem, loading, focusId }: { items: DesktopEntry[]; renderItem: (item: DesktopEntry) => ReactNode; loading?: boolean; focusId?: string | null }) {
  const [section, setSection] = useState<FinderSection>(() => {
    try { const saved = localStorage.getItem(STORAGE_KEY); return finderSections.some(entry => entry.id === saved) ? saved as FinderSection : 'all'; } catch { return 'all'; }
  });
  const [query, setQuery] = useState('');
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, section); } catch { /* per-viewer convenience only */ } }, [section]);
  // An item being renamed (for example a file just created) must be on screen: show its section.
  useEffect(() => {
    const item = focusId ? items.find(entry => entry.id === focusId) : undefined;
    if (item && section !== 'all' && finderSectionOf(item) !== section) { setSection(finderSectionOf(item)); setQuery(''); }
  }, [focusId, items]);
  const visible = finderItems(items, section, query);
  const current = finderSections.find(entry => entry.id === section)!;
  const count = (id: FinderSection) => finderItems(items, id).length;

  return <section className="desktop-finder" aria-label="바탕화면">
    <aside className="finder-sidebar" aria-label="바탕화면 공간">
      {(['공간', '보관'] as const).map(group => <div key={group} className="finder-group">
        <p>{group}</p>
        {finderSections.filter(entry => entry.group === group).map(entry => {
          const Icon = sectionIcon[entry.id];
          return <button key={entry.id} type="button" aria-pressed={section === entry.id} onClick={() => { setSection(entry.id); setQuery(''); }}>
            <Icon size={16} /><span>{entry.label}</span><small>{count(entry.id)}</small>
          </button>;
        })}
      </div>)}
    </aside>
    <div className="finder-main">
      <header className="finder-toolbar">
        <h1>{current.label}</h1>
        <label className="finder-search"><Search size={15} /><input type="search" aria-label="바탕화면 항목 검색" placeholder="항목 검색" value={query} onChange={event => setQuery(event.target.value)} />
          {query && <button type="button" aria-label="검색어 지우기" onClick={() => setQuery('')}><X size={14} /></button>}</label>
      </header>
      <div className="finder-grid">
        {visible.map(renderItem)}
        {!visible.length && !loading && <p className="finder-empty">{query ? '검색한 항목이 없습니다.' : section === 'files' ? '바탕화면 빈 곳을 오른쪽 클릭하거나 길게 눌러 새 파일·폴더를 만들 수 있습니다.' : '표시할 항목이 없습니다.'}</p>}
      </div>
      <footer className="finder-path"><span>바탕화면</span><ChevronRight size={13} /><strong>{current.label}</strong></footer>
      <footer className="finder-status">{visible.length}개 항목</footer>
    </div>
  </section>;
}

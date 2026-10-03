import { programs } from './programs';
import { DEFAULT_ICONS, TRASH_FULL_ICON, isLibraryIcon, libraryIconSrc } from './iconLibrary';
import type { PinkFolderVariant } from './components/PinkFolderIcon';

export interface DesktopEntry {
  id: string; kind: 'program' | 'shortcut' | 'file'; target: string; label: string; defaultLabel?: string;
  icon: string | null; hidden: boolean; sort: number; fileKind?: 'file' | 'folder'; locked?: boolean; missing?: boolean;
}
export interface UserFile { id: string; parentId: string | null; kind: 'file' | 'folder'; name: string; updatedAt: number; locked: boolean; unlocked: boolean; }
export interface TrashEntry { type: 'file' | 'memo' | 'price' | 'capsule'; id: string; kind: 'file' | 'folder' | 'memo' | 'price' | 'capsule'; name: string; trashedAt: number; locked: boolean; location: string; }
export interface DesktopAsset { id: string; kind: 'wallpaper' | 'icon'; src: string; }
export interface DesktopData {
  authenticated: boolean; items: DesktopEntry[]; files: UserFile[]; trash: TrashEntry[]; assets: DesktopAsset[];
  settings: { wallpaper: { assetId: string; src: string } | null; fit: 'cover' | 'contain'; font: string | null };
}

// Mirrors the server's signed-out answer so the desktop looks the same before it loads.
export const defaultDesktop: DesktopData = {
  authenticated: false, files: [], trash: [], assets: [], settings: { wallpaper: null, fit: 'cover', font: null },
  items: programs.map((program, sort) => ({ id: `program:${program.id}`, kind: 'program', target: `program:${program.id}`, label: program.label, defaultLabel: program.label, icon: null, hidden: false, sort })),
};

export type ItemKind = 'program' | 'shortcut' | 'file' | 'folder';
export type MenuAction = 'open' | 'rename' | 'icon' | 'hide' | 'remove' | 'security' | 'trash';
// Programs and shortcuts only change how the desktop shows them; real files are renamed,
// locked or moved to the trash. Nothing here deletes a program or a shortcut's target.
export function menuFor(kind: ItemKind, signedIn: boolean): { action: MenuAction; label: string }[] {
  if (!signedIn) return [{ action: 'open', label: '열기' }];
  if (kind === 'program') return [{ action: 'open', label: '열기' }, { action: 'rename', label: '표시 이름 변경' }, { action: 'icon', label: '아이콘 변경' }, { action: 'hide', label: '바탕화면에서 숨기기' }];
  if (kind === 'shortcut') return [{ action: 'open', label: '열기' }, { action: 'rename', label: '표시 이름 변경' }, { action: 'icon', label: '아이콘 변경' }, { action: 'hide', label: '바탕화면에서 숨기기' }, { action: 'remove', label: '바탕화면에서 제거' }];
  return [{ action: 'open', label: '열기' }, { action: 'rename', label: '이름 변경' }, { action: 'security', label: '보안 설정' }, { action: 'trash', label: '휴지통으로 이동' }];
}
export const entryKind = (entry: DesktopEntry): ItemKind => entry.kind === 'file' ? entry.fileKind ?? 'file' : entry.kind;

export type DesktopMenuAction = 'new-file' | 'new-folder' | 'save-layout' | 'wallpaper' | 'settings';
export function desktopMenu(signedIn: boolean): { action: DesktopMenuAction; label: string }[] {
  const settings = { action: 'settings' as const, label: '환경설정' };
  return signedIn ? [{ action: 'new-file', label: '새 파일' }, { action: 'new-folder', label: '새 폴더' }, { action: 'save-layout', label: '현재 화면 저장' }, { action: 'wallpaper', label: '배경화면 변경' }, settings] : [settings];
}

export interface IconArt { variant: PinkFolderVariant; image?: string }
// Icon values: null = the item's default, `builtin:<id>` = an icon from the library,
// `asset:<id>` = an uploaded image, `folder:<variant>` = the original pink folder art.
// The icon only changes the picture; what the item opens is decided by its target.
export function iconArt(entry: { icon: string | null; target: string; fileKind?: 'file' | 'folder' }, assets: DesktopAsset[], { trashFull = false } = {}): IconArt {
  const program = programs.find(item => entry.target === `program:${item.id}`);
  const variant: PinkFolderVariant = program?.variant ?? (entry.fileKind === 'folder' ? 'heart' : 'flower');
  if (entry.icon?.startsWith('folder:')) return { variant: entry.icon.slice(7) as PinkFolderVariant };
  if (entry.icon?.startsWith('builtin:') && isLibraryIcon(entry.icon.slice(8))) return { variant, image: libraryIconSrc(entry.icon.slice(8)) };
  const asset = entry.icon?.startsWith('asset:') && assets.find(item => item.id === entry.icon!.slice(6));
  if (asset) return { variant, image: asset.src };
  const fallback = entry.target === 'program:trash' && trashFull ? TRASH_FULL_ICON
    : DEFAULT_ICONS[entry.target] ?? DEFAULT_ICONS[entry.fileKind === 'folder' ? 'folder' : 'file'];
  return { variant, image: libraryIconSrc(fallback) };
}

// Long press opens the same menu as a right click (iPad has no right click). A move beyond the
// tolerance or an early release cancels it, and the click that follows a long press is ignored.
export function createLongPress(onLongPress: (point: { x: number; y: number }) => void,
  { delay = 550, tolerance = 10, timer = { set: (fn: () => void, ms: number) => setTimeout(fn, ms), clear: (id: ReturnType<typeof setTimeout>) => clearTimeout(id) } } = {}) {
  let pending: ReturnType<typeof setTimeout> | null = null;
  let start = { x: 0, y: 0 };
  let fired = false;
  const cancel = () => { if (pending !== null) timer.clear(pending); pending = null; };
  return {
    down(event: { clientX: number; clientY: number; button?: number }) {
      cancel(); fired = false;
      if (event.button && event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY };
      pending = timer.set(() => { pending = null; fired = true; onLongPress(start); }, delay);
    },
    move(event: { clientX: number; clientY: number }) {
      if (pending !== null && Math.hypot(event.clientX - start.x, event.clientY - start.y) > tolerance) cancel();
    },
    up: cancel,
    cancel,
    consumeClick() { const was = fired; fired = false; return was; },
  };
}

export const parentChain = (files: UserFile[], id: string | null) => {
  const chain: UserFile[] = [];
  for (let current = files.find(file => file.id === id); current && chain.length < 50; current = files.find(file => file.id === current!.parentId)) chain.unshift(current);
  return chain;
};

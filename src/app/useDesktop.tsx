import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { defaultDesktop, type DesktopAsset, type DesktopData } from './desktopModel';
import type { WindowId } from './desktopState';
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu';
import { PasswordDialog } from './components/PasswordDialog';
import { IconPicker } from './components/IconPicker';
import { useTrashChange } from './trash';

export type SettingsTab = 'wallpaper' | 'desktop' | 'files' | 'security';
type Result<T = DesktopData & Record<string, unknown>> = { ok: true; data: T } | { ok: false; error: string };
export interface OpenedFile { id: string; kind: 'file' | 'folder'; name: string; content: string; updatedAt: number }

interface DesktopApi {
  data: DesktopData; loaded: boolean; loadError: string;
  refresh(): Promise<void>;
  act(body: Record<string, unknown>): Promise<Result>;
  upload(file: File, kind: DesktopAsset['kind']): Promise<Result<DesktopAsset>>;
  readFile(id: string): Promise<Result<OpenedFile>>;
  unlock(id: string): Promise<boolean>;
  pickIcon(current: string | null): Promise<string | null | undefined>;
  openTarget(target: string): void;
  viewing: string | null; setViewing(id: string | null): void;
  settingsTab: SettingsTab; securityId: string | null; openSettings(tab: SettingsTab, securityId?: string): void; setSettingsTab(tab: SettingsTab): void; setSecurityId(id: string | null): void;
  renaming: string | null; setRenaming(id: string | null): void;
  showMenu(point: { x: number; y: number }, items: ContextMenuItem[]): void;
  notice: string; notify(message: string): void;
}
const DesktopContext = createContext<DesktopApi | null>(null);
export function useDesktop() {
  const api = useContext(DesktopContext);
  if (!api) throw new Error('useDesktop must be used inside DesktopProvider');
  return api;
}
const OFFLINE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';

export function DesktopProvider({ openWindow, children }: { openWindow: (id: WindowId) => void; children: ReactNode }) {
  const [data, setData] = useState<DesktopData>(defaultDesktop);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  // Unlock tokens stay in memory only; a reload asks for the password again.
  const tokens = useRef(new Map<string, string>());
  const [prompt, setPrompt] = useState<{ id: string; name: string; resolve: (ok: boolean) => void } | null>(null);
  const [picker, setPicker] = useState<{ current: string | null; resolve: (icon: string | null | undefined) => void } | null>(null);
  const [menu, setMenu] = useState<{ point: { x: number; y: number }; items: ContextMenuItem[] } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('wallpaper');
  const [securityId, setSecurityId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const dataRef = useRef(data); dataRef.current = data;

  const headers = useCallback((extra: Record<string, string> = {}) => {
    const list = [...tokens.current.values()];
    return list.length ? { ...extra, 'X-Unlock-Tokens': list.join(',') } : extra;
  }, []);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/desktop', { headers: headers(), cache: 'no-store' });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json) throw new Error(json?.error || OFFLINE);
      setData(json); setLoadError('');
    } catch (error) { setLoadError((error as Error).message || OFFLINE); }
    finally { setLoaded(true); }
  }, [headers]);
  useEffect(() => { void refresh(); }, [refresh]);
  // A memo, price image or work capsule moved to the trash fills the trash icon and list.
  useTrashChange(null, () => { void refresh(); });

  const unlock = useCallback((id: string) => new Promise<boolean>(resolve => {
    const name = dataRef.current.files.find(file => file.id === id)?.name ?? dataRef.current.trash.find(file => file.id === id)?.name ?? '잠긴 항목';
    setPrompt({ id, name, resolve });
  }), []);
  const post = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch('/api/desktop', { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
    return { response, json: await response.json().catch(() => null) };
  }, [headers]);
  const act = useCallback(async (body: Record<string, unknown>, retry = true): Promise<Result> => {
    try {
      const { response, json } = await post(body);
      if (response.status === 423 && json?.lockedId && retry) {
        return await unlock(json.lockedId) ? act(body, false) : { ok: false, error: '비밀번호를 입력하지 않아 취소했습니다.' };
      }
      if (!response.ok || !json) return { ok: false, error: json?.error || OFFLINE };
      setData(json);
      return { ok: true, data: json };
    } catch { return { ok: false, error: OFFLINE }; }
  }, [post, unlock]);
  const upload = useCallback(async (file: File, kind: DesktopAsset['kind']): Promise<Result<DesktopAsset>> => {
    if (file.size > 10 * 1024 * 1024) return { ok: false, error: '10MB 이하 이미지를 선택해 주세요.' };
    try {
      const form = new FormData(); form.set('file', file); form.set('kind', kind);
      const response = await fetch('/api/desktop-assets', { method: 'POST', headers: headers(), body: form });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json) return { ok: false, error: json?.error || OFFLINE };
      setData(json);
      return { ok: true, data: json.asset };
    } catch { return { ok: false, error: OFFLINE }; }
  }, [headers]);
  const readFile = useCallback(async (id: string, retry = true): Promise<Result<OpenedFile>> => {
    try {
      const response = await fetch(`/api/files/${encodeURIComponent(id)}`, { headers: headers(), cache: 'no-store' });
      const json = await response.json().catch(() => null);
      if (response.status === 423 && json?.lockedId && retry) {
        return await unlock(json.lockedId) ? readFile(id, false) : { ok: false, error: '잠긴 항목입니다.' };
      }
      if (!response.ok || !json) return { ok: false, error: json?.error || OFFLINE };
      return { ok: true, data: json };
    } catch { return { ok: false, error: OFFLINE }; }
  }, [headers, unlock]);

  const submitPassword = async (password: string) => {
    if (!prompt) return '';
    try {
      const { response, json } = await post({ action: 'unlock', id: prompt.id, password });
      if (!response.ok || !json?.token) return json?.error || OFFLINE;
      tokens.current.set(prompt.id, json.token);
      setData(json); prompt.resolve(true); setPrompt(null);
      return '';
    } catch { return OFFLINE; }
  };

  const api: DesktopApi = {
    data, loaded, loadError, refresh, act, upload, readFile, unlock,
    pickIcon: current => new Promise(resolve => setPicker({ current, resolve })),
    openTarget(target) {
      if (target.startsWith('program:')) openWindow(target.slice(8) as WindowId);
      else if (target.startsWith('file:')) { setViewing(target.slice(5)); openWindow('files'); }
    },
    viewing, setViewing,
    settingsTab, securityId, setSettingsTab, setSecurityId,
    openSettings(tab, id) { setSettingsTab(tab); if (id) setSecurityId(id); openWindow('controlPanel'); },
    renaming, setRenaming,
    showMenu: (point, items) => setMenu({ point, items }),
    notice, notify: setNotice,
  };
  const closeMenu = useCallback(() => setMenu(null), []);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 3500); return () => window.clearTimeout(timer); }, [notice]);

  return <DesktopContext.Provider value={api}>
    {children}
    {menu && <ContextMenu point={menu.point} items={menu.items} onClose={closeMenu} />}
    {prompt && <PasswordDialog name={prompt.name} onSubmit={submitPassword} onCancel={() => { prompt.resolve(false); setPrompt(null); }} />}
    {picker && <IconPicker current={picker.current} onPick={icon => { picker.resolve(icon); setPicker(null); }} />}
  </DesktopContext.Provider>;
}

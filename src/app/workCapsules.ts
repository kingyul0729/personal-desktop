import type { WindowId } from './desktopState';
import type { SettingsTab } from './useDesktop';
import { windowLabel } from './programs';

// A work capsule is only a window arrangement; it never carries memo, file or price data.
export interface CapsuleWindow { id: WindowId; x: number; y: number; width: number; height: number; minimized: boolean; maximized: boolean }
export interface CapsuleLayout { windows: CapsuleWindow[]; active: WindowId | null; view: { settingsTab?: SettingsTab; filesViewing?: string | null } }
export interface Capsule { id: string; name: string; layout: CapsuleLayout; createdAt: number }

// The capsule window itself is the tool, not part of the work being saved.
export const CAPSULE_WINDOW: WindowId = 'programManager';

const pad = (value: number) => String(value).padStart(2, '0');
export const defaultCapsuleName = (now: Date) => `${now.getMonth() + 1}월 ${now.getDate()}일 ${pad(now.getHours())}:${pad(now.getMinutes())}`;
export const capsuleSummary = (layout: CapsuleLayout) => ({ names: layout.windows.map(window => windowLabel(window.id)), count: layout.windows.length });

const OFFLINE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
// One request path for every capsule change, used by the 작업 캡슐 window and the desktop menu.
export async function capsuleRequest(body?: Record<string, unknown>): Promise<{ ok: true; capsules: Capsule[]; authenticated: boolean } | { ok: false; error: string }> {
  try {
    const response = await fetch('/api/capsules', body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) return { ok: false, error: data?.error || OFFLINE };
    return { ok: true, capsules: data.capsules, authenticated: data.authenticated };
  } catch { return { ok: false, error: OFFLINE }; }
}

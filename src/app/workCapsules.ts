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

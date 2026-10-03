export const WINDOW_IDS = ['terminal', 'fileExplorer', 'controlPanel', 'programManager', 'notepad', 'priceCalculator', 'trash', 'files'] as const;
export type WindowId = typeof WINDOW_IDS[number];

export interface DesktopState {
  running: WindowId[];
  minimized: WindowId[];
  stack: WindowId[];
}
export const initialDesktop: DesktopState = {
  running: [],
  minimized: [],
  stack: [],
};
export type DesktopAction = { type: 'open' | 'focus' | 'minimize' | 'close' | 'taskbar'; id: WindowId }
  | { type: 'layout'; windows: WindowId[]; minimized: WindowId[]; active?: WindowId };

export function activeWindow(state: DesktopState): WindowId | undefined {
  return [...state.stack].reverse().find((id) => !state.minimized.includes(id));
}
export function desktopReducer(state: DesktopState, action: DesktopAction): DesktopState {
  if (action.type === 'layout') return applyLayout(state, action);
  const { id } = action;
  const running = state.running.includes(id);
  const type = action.type === 'taskbar' ? (activeWindow(state) === id ? 'minimize' : 'open') : action.type;
  if (type === 'close') {
    return {
      running: state.running.filter((item) => item !== id),
      minimized: state.minimized.filter((item) => item !== id),
      stack: state.stack.filter((item) => item !== id),
    };
  }
  if (type === 'minimize') {
    return !running || state.minimized.includes(id) ? state : { ...state, minimized: [...state.minimized, id] };
  }
  if (type === 'focus' && (!running || state.minimized.includes(id))) return state;
  if (running && activeWindow(state) === id) return state;
  return {
    running: running ? state.running : [...state.running, id],
    minimized: state.minimized.filter((item) => item !== id),
    stack: [...state.stack.filter((item) => item !== id), id],
  };
}

export interface DesktopBounds { width: number; height: number }
export interface WindowRect extends DesktopBounds { x: number; y: number }
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

// Both size AND position must fit above the taskbar, including after rotation.
export function fitWindow(rect: WindowRect, bounds: DesktopBounds, maximized = false): WindowRect {
  const area = { width: Math.max(0, bounds.width), height: Math.max(0, bounds.height) };
  if (maximized) return { x: 0, y: 0, ...area };
  const gap = Math.min(8, area.width / 4, area.height / 4);
  const width = Math.min(Math.max(320, rect.width), area.width - gap * 2);
  const height = Math.min(Math.max(240, rect.height), area.height - gap * 2);
  return {
    x: clamp(rect.x, gap, area.width - width - gap),
    y: clamp(rect.y, gap, area.height - height - gap),
    width,
    height,
  };
}
export function resizeWindow(rect: WindowRect, delta: { x: number; y: number }, bounds: DesktopBounds): WindowRect {
  const fitted = fitWindow(rect, bounds);
  const gap = Math.min(8, bounds.width / 4, bounds.height / 4);
  return {
    ...fitted,
    width: Math.min(Math.max(320, fitted.width + delta.x), bounds.width - fitted.x - gap),
    height: Math.min(Math.max(240, fitted.height + delta.y), bounds.height - fitted.y - gap),
  };
}

// Opens a saved work layout with the same window list: windows already open are reused (never
// duplicated), other open windows are only minimized so nothing in them is lost, and the saved
// active window ends up in front.
function applyLayout(state: DesktopState, { windows, minimized, active }: { windows: WindowId[]; minimized: WindowId[]; active?: WindowId }): DesktopState {
  const wanted = windows.filter((id, index) => WINDOW_IDS.includes(id) && windows.indexOf(id) === index);
  const others = state.running.filter(id => !wanted.includes(id));
  const front = active && wanted.includes(active) && !minimized.includes(active) ? active : undefined;
  return {
    running: [...state.running, ...wanted.filter(id => !state.running.includes(id))],
    minimized: [...others, ...wanted.filter(id => minimized.includes(id))],
    stack: [...state.stack.filter(id => !wanted.includes(id)), ...wanted.filter(id => id !== front), ...(front ? [front] : [])],
  };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { activeWindow, desktopReducer, initialDesktop, WINDOW_IDS, fitWindow, resizeWindow } from '../src/app/desktopState.ts';

const openedDesktop = () => desktopReducer(
  desktopReducer(initialDesktop, { type: 'open', id: 'priceCalculator' }),
  { type: 'open', id: 'fileExplorer' },
);

test('taskbar only contains running programs; minimizing and restoring preserve membership', () => {
  assert.deepEqual(initialDesktop, { running: [], minimized: [], stack: [] });
  assert.equal(activeWindow(initialDesktop), undefined);
  const opened = openedDesktop();
  let state = opened;
  assert.equal(state.running.length, 2);
  assert.equal(activeWindow(state), 'fileExplorer');
  state = desktopReducer(state, { type: 'minimize', id: 'fileExplorer' });
  assert.deepEqual(state.running, opened.running);
  assert.equal(activeWindow(state), 'priceCalculator');
  assert.ok(state.minimized.includes('fileExplorer'));
  state = desktopReducer(state, { type: 'taskbar', id: 'fileExplorer' });
  assert.equal(activeWindow(state), 'fileExplorer');
  assert.deepEqual(state.minimized, []);
  assert.deepEqual(state.running, opened.running);
});

test('closing removes the tab; reopening adds it once; active task click minimizes', () => {
  let state = desktopReducer(openedDesktop(), { type: 'close', id: 'fileExplorer' });
  assert.deepEqual(state.running, ['priceCalculator']);
  assert.equal(activeWindow(state), 'priceCalculator');
  state = desktopReducer(state, { type: 'open', id: 'notepad' });
  state = desktopReducer(state, { type: 'open', id: 'notepad' });
  assert.deepEqual(state.running, ['priceCalculator', 'notepad']);
  state = desktopReducer(state, { type: 'taskbar', id: 'notepad' });
  assert.ok(state.minimized.includes('notepad'));
  assert.equal(activeWindow(state), 'priceCalculator');
  state = desktopReducer(state, { type: 'close', id: 'notepad' });
  assert.deepEqual(state.minimized, []);
  assert.deepEqual(state.running, ['priceCalculator']);
});

test('all windows can close and reopen; focus order never creates duplicate tabs', () => {
  let state = structuredClone(initialDesktop);
  for (const id of WINDOW_IDS) state = desktopReducer(state, { type: 'open', id });
  for (let i = 0; i < 50; i++) state = desktopReducer(state, { type: 'focus', id: WINDOW_IDS[i % 6] });
  assert.equal(state.running.length, 6);
  assert.equal(state.stack.length, 6);
  for (const id of WINDOW_IDS) state = desktopReducer(state, { type: 'minimize', id });
  assert.equal(activeWindow(state), undefined);
  assert.equal(state.running.length, 6);
  for (const id of WINDOW_IDS) state = desktopReducer(state, { type: 'close', id });
  assert.deepEqual(state, { running: [], minimized: [], stack: [] });
  state = desktopReducer(state, { type: 'open', id: 'priceCalculator' });
  assert.equal(activeWindow(state), 'priceCalculator');
});

const defaults = [
  { x: 255, y: 90, width: 720, height: 410 },
  { x: 240, y: 24, width: 920, height: 760 },
  { x: 390, y: 190, width: 720, height: 500 },
  { x: 440, y: 120, width: 680, height: 500 },
  { x: 300, y: 135, width: 680, height: 480 },
  { x: 250, y: 52, width: 980, height: 680 },
];
const screens = [[1440, 900], [1180, 820], [820, 1180], [1024, 768], [768, 1024], [1067, 1536], [390, 844], [844, 390], [320, 568]];
function inBounds(rect, bounds) {
  assert.ok(rect.x >= 0 && rect.y >= 0);
  assert.ok(rect.width > 0 && rect.height > 0);
  assert.ok(rect.x + rect.width <= bounds.width, JSON.stringify({ rect, bounds }));
  assert.ok(rect.y + rect.height <= bounds.height, JSON.stringify({ rect, bounds }));
}
for (const [width, screenHeight] of screens) {
  test(`every window fits ${width} × ${screenHeight}, including taskbar and safe area`, () => {
    const bounds = { width, height: screenHeight - 56 - 34 };
    for (const preferred of defaults) {
      const rect = fitWindow(preferred, bounds);
      inBounds(rect, bounds);
      assert.deepEqual(fitWindow(preferred, bounds, true), { x: 0, y: 0, ...bounds });
      for (const delta of [{ x: 9999, y: 9999 }, { x: -9999, y: -9999 }]) {
        inBounds(fitWindow({ ...rect, x: delta.x, y: delta.y }, bounds), bounds);
        inBounds(resizeWindow(rect, delta, bounds), bounds);
      }
    }
  });
}

test('portrait ↔ landscape fits both orientations without mutating saved restore geometry', () => {
  const preferred = { x: 250, y: 52, width: 980, height: 680 };
  const copy = { ...preferred };
  const landscape = { width: 1180, height: 764 };
  const portrait = { width: 820, height: 1124 };
  const first = fitWindow(preferred, landscape);
  inBounds(fitWindow(preferred, portrait), portrait);
  assert.deepEqual(fitWindow(preferred, landscape), first);
  assert.deepEqual(preferred, copy);
});

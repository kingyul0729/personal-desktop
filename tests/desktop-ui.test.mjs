import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';

const bundled = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server.browser';
      import { ContextMenuList } from './src/app/components/ContextMenu';
      import { DesktopIcon } from './src/app/components/DesktopIcon';
      export const menuButtons = (items) => { let element; const Probe = () => { element = ContextMenuList({ items, onClose() {} }); return null; }; renderToStaticMarkup(React.createElement(Probe)); return element.props.children; };
      export const renderMenu = (items) => renderToStaticMarkup(React.createElement(ContextMenuList, { items, onClose() {} }));
      export const renderIcon = (props) => renderToStaticMarkup(React.createElement(DesktopIcon, { icon: null, onClick() {}, ...props }));
      export { createLongPress, desktopMenu, entryKind, iconArt, menuFor, defaultDesktop } from './src/app/desktopModel';
      export { ICON_LIBRARY, DEFAULT_ICONS, TRASH_FULL_ICON } from './src/app/iconLibrary';
      export { programs } from './src/app/programs';
      // Call the component inside a real render so its hooks work, and keep the element it returns.
      export const iconElement = (props) => { let element; const Probe = () => { element = DesktopIcon({ icon: null, ...props }); return null; }; renderToStaticMarkup(React.createElement(Probe)); return element; };
    `,
    resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx',
  },
  bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', logLevel: 'silent', external: [],
});
const ui = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const { createLongPress, desktopMenu, entryKind, iconArt, menuFor, defaultDesktop } = ui;

test('menus match what each item really is; fixed programs never offer deletion', () => {
  const labels = kind => menuFor(kind, true).map(item => item.label);
  assert.deepEqual(labels('program'), ['열기', '표시 이름 변경', '아이콘 변경', '바탕화면에서 숨기기']);
  assert.deepEqual(labels('shortcut'), ['열기', '표시 이름 변경', '아이콘 변경', '바탕화면에서 숨기기', '바탕화면에서 제거']);
  assert.deepEqual(labels('file'), ['열기', '이름 변경', '보안 설정', '휴지통으로 이동']);
  assert.deepEqual(labels('folder'), ['열기', '이름 변경', '보안 설정', '휴지통으로 이동']);
  for (const program of defaultDesktop.items) {
    const actions = menuFor(entryKind(program), true).map(item => item.action);
    assert.ok(!actions.includes('trash') && !actions.includes('remove'), program.label);
  }
  assert.deepEqual(menuFor('file', false).map(item => item.label), ['열기']);
  assert.deepEqual(desktopMenu(true).map(item => item.label), ['새 파일', '새 폴더', '현재 화면 저장', '배경화면 변경', '환경설정']);
  assert.deepEqual(desktopMenu(false).map(item => item.label), ['환경설정']);
  const html = ui.renderMenu(menuFor('program', true).map(item => ({ label: item.label, onSelect() {} })));
  assert.equal((html.match(/role="menuitem"/g) ?? []).length, 4);
  assert.ok(!html.includes('휴지통'));
});

test('a long press opens the menu like a right click; moving or releasing early does not', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const opened = [];
  const press = createLongPress(point => opened.push(point));
  press.down({ clientX: 100, clientY: 200 });
  t.mock.timers.tick(549);
  assert.equal(opened.length, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(opened, [{ x: 100, y: 200 }]);
  assert.equal(press.consumeClick(), true, 'the click after a long press does not also open the item');
  assert.equal(press.consumeClick(), false);
  press.down({ clientX: 10, clientY: 10 }); t.mock.timers.tick(300); press.up(); t.mock.timers.tick(500);
  press.down({ clientX: 10, clientY: 10 }); press.move({ clientX: 40, clientY: 10 }); t.mock.timers.tick(800);
  press.down({ clientX: 10, clientY: 10, button: 2 }); t.mock.timers.tick(800);
  assert.equal(opened.length, 1);
});

test('desktop icons wire right click and touch; a custom icon keeps the same action and badge', () => {
  let opened = 0; const menus = [];
  const element = ui.iconElement({ label: '메모장', onClick: () => opened++, onMenu: point => menus.push(point) });
  element.props.onContextMenu({ preventDefault() {}, clientX: 5, clientY: 6 });
  assert.deepEqual(menus, [{ x: 5, y: 6 }]);
  element.props.onClick();
  assert.equal(opened, 1);
  const assets = [{ id: 'abcdefgh-1', kind: 'icon', src: '/api/desktop-assets/abcdefgh-1' }];
  const art = iconArt({ icon: 'asset:abcdefgh-1', target: 'program:notepad' }, assets);
  assert.equal(art.image, '/api/desktop-assets/abcdefgh-1');
  const html = ui.renderIcon({ label: '메모장', image: art.image, variant: art.variant });
  assert.ok(html.includes('desktop-image-icon') && html.includes('메모장'));
  assert.ok(!html.includes('desktop-app-badge'), 'a picture icon stands on its own');
  assert.ok(ui.renderIcon({ label: '잠금', image: art.image, locked: true }).includes('desktop-app-badge'), 'locks stay visible');
  assert.deepEqual(iconArt({ icon: 'folder:cherry', target: 'program:notepad' }, assets), { variant: 'cherry' });
  assert.ok(ui.renderIcon({ label: '폴더', variant: 'cherry' }).includes('desktop-app-badge'));
  const renaming = ui.renderIcon({ label: '메모장', renaming: true, onRename() {}, onCancelRename() {} });
  assert.ok(renaming.includes('value="메모장"') && renaming.includes('이름 저장'));
});

test('every built-in icon exists, every tab has a fitting default, and picking one keeps what it opens', () => {
  const ids = ui.ICON_LIBRARY.map(icon => icon.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 50);
  for (const id of ids) assert.ok(existsSync(new URL(`../public/icons/${id}.png`, import.meta.url)), id);
  for (const program of ui.programs) {
    const art = iconArt({ icon: null, target: `program:${program.id}` }, []);
    assert.ok(ids.includes(ui.DEFAULT_ICONS[`program:${program.id}`]), program.label);
    assert.equal(art.image, `/icons/${ui.DEFAULT_ICONS[`program:${program.id}`]}.png`);
  }
  assert.equal(iconArt({ icon: null, target: 'program:priceCalculator' }, []).image, '/icons/pink-calculator.png');
  assert.equal(iconArt({ icon: null, target: 'program:trash' }, []).image, '/icons/pink-trash-kitty.png');
  assert.equal(iconArt({ icon: null, target: 'program:trash' }, [], { trashFull: true }).image, `/icons/${ui.TRASH_FULL_ICON}.png`);
  assert.equal(iconArt({ icon: 'builtin:coral-calculator', target: 'program:trash' }, [], { trashFull: true }).image, '/icons/coral-calculator.png', 'a chosen icon is kept even when the trash fills');
  assert.equal(iconArt({ icon: null, target: 'file:x', fileKind: 'folder' }, []).image, '/icons/pink-folder-heart.png');
  assert.equal(iconArt({ icon: null, target: 'file:x', fileKind: 'file' }, []).image, '/icons/pink-document-kitty.png');
  assert.equal(iconArt({ icon: 'builtin:not-real', target: 'program:notepad' }, []).image, '/icons/pink-notepad.png', 'an unknown icon falls back to the default');
});

test('a menu item ignores the click left over from the long press that opened it', () => {
  const picked = [];
  const [first] = ui.menuButtons([{ label: '환경설정', onSelect: () => picked.push('settings') }]);
  first.props.onClick({ detail: 1 });
  assert.deepEqual(picked, [], 'release of the long press lands on the new menu but selects nothing');
  first.props.onClick({ detail: 0 });
  assert.deepEqual(picked, ['settings'], 'keyboard activation still works');
  first.props.onPointerDown();
  first.props.onClick({ detail: 1 });
  assert.deepEqual(picked, ['settings', 'settings'], 'a real tap on the menu selects');
});

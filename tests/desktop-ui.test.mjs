import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server.browser';
      import { ContextMenuList } from './src/app/components/ContextMenu';
      import { DesktopIcon } from './src/app/components/DesktopIcon';
      export const renderMenu = (items) => renderToStaticMarkup(React.createElement(ContextMenuList, { items, onClose() {} }));
      export const renderIcon = (props) => renderToStaticMarkup(React.createElement(DesktopIcon, { icon: null, onClick() {}, ...props }));
      export { createLongPress, desktopMenu, entryKind, iconArt, menuFor, defaultDesktop } from './src/app/desktopModel';
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
  assert.deepEqual(desktopMenu(true).map(item => item.label), ['새 파일', '새 폴더', '배경화면 변경', '환경설정']);
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
  assert.ok(html.includes('desktop-custom-icon') && html.includes('desktop-app-badge') && html.includes('메모장'));
  assert.deepEqual(iconArt({ icon: 'folder:cherry', target: 'program:notepad' }, assets), { variant: 'cherry' });
  assert.deepEqual(iconArt({ icon: null, target: 'program:fileExplorer' }, assets), { variant: 'kitty' });
  const renaming = ui.renderIcon({ label: '메모장', renaming: true, onRename() {}, onCancelRename() {} });
  assert.ok(renaming.includes('value="메모장"') && renaming.includes('이름 저장'));
});

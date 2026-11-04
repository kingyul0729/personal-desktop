import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  stdin: { contents: `export { finderItems, finderSectionOf } from './src/app/components/DesktopFinder';`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', logLevel: 'silent',
});
const { finderItems, finderSectionOf } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const item = (id, kind, target, extra = {}) => ({ id, kind, target, label: id, hidden: false, ...extra });
const items = [
  item('공부 보관함', 'program', 'program:terminal'), item('메모장', 'program', 'program:notepad'),
  item('업무 자료실', 'program', 'program:workLibrary'), item('가격표 보관함', 'program', 'program:fileExplorer'),
  item('금액 계산', 'program', 'program:priceCalculator'), item('휴지통', 'program', 'program:trash'),
  item('계산 바로가기', 'shortcut', 'program:priceCalculator'), item('상담 메모', 'file', 'file:abc'),
  item('숨긴 항목', 'program', 'program:controlPanel', { hidden: true }),
];

test('each desktop item appears in exactly one space, hidden items nowhere', () => {
  assert.deepEqual(finderItems(items, 'A').map(i => i.id), ['공부 보관함', '메모장']);
  assert.deepEqual(finderItems(items, 'B').map(i => i.id), ['업무 자료실', '가격표 보관함']);
  assert.deepEqual(finderItems(items, 'common').map(i => i.id), ['금액 계산', '휴지통', '계산 바로가기']);
  assert.deepEqual(finderItems(items, 'files').map(i => i.id), ['상담 메모']);
  const spaces = ['A', 'B', 'common', 'files'].flatMap(section => finderItems(items, section).map(i => i.id));
  assert.equal(new Set(spaces).size, spaces.length);
  assert.deepEqual(finderItems(items, 'all').map(i => i.id).sort(), [...spaces].sort());
  assert.equal(finderSectionOf(item('x', 'shortcut', 'file:abc')), 'files');
});

test('search narrows the chosen space by label', () => {
  assert.deepEqual(finderItems(items, 'all', '보관함').map(i => i.id), ['공부 보관함', '가격표 보관함']);
  assert.deepEqual(finderItems(items, 'A', '가격').map(i => i.id), []);
});

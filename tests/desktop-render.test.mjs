import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { desktopReducer, initialDesktop } from '../src/app/desktopState.ts';
import { calculatePriceGuide, createPriceGuideMessage } from '../src/app/priceGuide.ts';
import { calculatorNumber, emptyCalculatorInputs, normalizeCalculatorInput } from '../src/app/calculatorInput.ts';

// Render real components without a browser; keep the bundle entirely in memory.
const bundled = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server.browser';
      import { Taskbar } from './src/app/components/Taskbar';
      import { Window } from './src/app/components/Window';
      import { PriceCalculator, Field, VatReferenceTable, ChartPaymentMethods } from './src/app/components/PriceCalculator';
      import { calculatePriceGuide } from './src/app/priceGuide';
      export const renderCalculator = () => renderToStaticMarkup(React.createElement(PriceCalculator));
      export const renderVatTable = () => renderToStaticMarkup(React.createElement(VatReferenceTable));
      export const paymentMethodButtons = (props) => ChartPaymentMethods(props).props.children[1].props.children;
      export const renderPaymentMethods = (props) => renderToStaticMarkup(React.createElement(ChartPaymentMethods, props));
      export const fieldInput = (props) => Field(props).props.children[1].props.children[0];
      export const renderTaskbar = (desktop) => renderToStaticMarkup(React.createElement(Taskbar, {
        desktop, onOpenWindow() {}, onTaskClick() {}, currentTime: '05:12'
      }));
      export const renderWindow = (extra = {}) => renderToStaticMarkup(React.createElement(Window, {
        title: '금액 계산', icon: null, isOpen: true, isMinimized: false, isActive: true,
        bounds: { width: 820, height: 1124 }, defaultPosition: { x: 250, y: 52 },
        defaultSize: { width: 980, height: 680 }, zIndex: 10,
        onClose() {}, onMinimize() {}, onFocus() {}, ...extra,
      }, React.createElement('input', { defaultValue: '37' })));
    `,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    loader: 'tsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const { renderTaskbar, renderWindow, renderCalculator, renderVatTable, fieldInput, paymentMethodButtons, renderPaymentMethods } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

test('taskbar renders exactly the running windows and updates after close', () => {
  assert.equal((renderTaskbar(initialDesktop).match(/class="taskbar-task\b/g) ?? []).length, 0);
  const opened = desktopReducer(desktopReducer(initialDesktop, { type: 'open', id: 'priceCalculator' }), { type: 'open', id: 'fileExplorer' });
  const html = renderTaskbar(opened);
  assert.equal((html.match(/class="taskbar-task\b/g) ?? []).length, 2);
  assert.ok(html.includes('aria-label="가격표 보관함"'));
  assert.ok(html.includes('aria-label="금액 계산"'));
  assert.ok(!html.includes('aria-label="Terminal"'));
  const closed = renderTaskbar(desktopReducer(opened, { type: 'close', id: 'fileExplorer' }));
  assert.equal((closed.match(/class="taskbar-task\b/g) ?? []).length, 1);
  assert.ok(!closed.includes('aria-label="가격표 보관함"'));
});

test('minimized window retains its child content, but closing removes it', () => {
  const minimized = renderWindow({ isMinimized: true });
  assert.ok(minimized.includes('hidden=""'));
  assert.ok(minimized.includes('value="37"'));
  assert.equal(renderWindow({ isOpen: false }), '');
  const restored = renderWindow();
  assert.ok(!restored.includes('hidden=""'));
  assert.ok(restored.includes('value="37"'));
});

test('portrait rendering clamps position and width; titlebar controls remain present', () => {
  const html = renderWindow();
  assert.ok(html.includes('left:8px'));
  assert.ok(html.includes('width:804px'));
  for (const label of ['금액 계산 최소화', '금액 계산 최대화', '금액 계산 닫기']) {
    assert.ok(html.includes(`aria-label="${label}"`));
  }
});

test('minimized task stays available and has a restore label', () => {
  const opened = desktopReducer(desktopReducer(initialDesktop, { type: 'open', id: 'priceCalculator' }), { type: 'open', id: 'fileExplorer' });
  const minimized = desktopReducer(opened, { type: 'minimize', id: 'fileExplorer' });
  const html = renderTaskbar(minimized);
  assert.equal((html.match(/class="taskbar-task\b/g) ?? []).length, 2);
  assert.ok(html.includes('aria-label="가격표 보관함 복원"'));
});

const visibleGuideText = (html) => html.replace(/<output hidden[\s\S]*?<\/output>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('VAT reference contains every amount from the supplied table without gaps', () => {
  const html = renderVatTable();
  const rows = [...html.matchAll(/<tr><td>([\d.]+)<\/td><td>([\d.]+)<\/td><\/tr>/g)].map((row) => [Number(row[1]), Number(row[2])]);
  assert.equal(rows.length, 91);
  assert.equal(rows[0][0], 10);
  assert.equal(rows.at(-1)[0], 100);
  assert.ok(rows.every(([before], index) => index === 0 || before === rows[index - 1][0] + 1));
  const prices = new Map(rows);
  for (const [before, after] of [[10, 11], [13, 14.3], [45, 49.5], [50, 55], [51, 56.1], [61, 67.1], [99, 108.9], [100, 110]]) {
    assert.equal(prices.get(before), after);
  }
});

test('actual field handlers preserve clearing, decimal editing and replacement without a forced zero', () => {
  const edits = [];
  const input = fieldInput({ label: '금액', value: '12', onChange: value => edits.push(value) });
  let selected = false;
  input.props.onFocus({ currentTarget: { select() { selected = true; } } });
  assert.ok(selected);
  for (const value of ['', '0', '0.', '0.5', '', '9', '9.', '9.9', '009.9', 'abc']) input.props.onChange({ currentTarget: { value } });
  assert.deepEqual(edits, ['', '0', '0.', '0.5', '', '9', '9.', '9.9', '9.9']);
  assert.equal(calculatorNumber('9.9'), 9.9);
  assert.equal(calculatorNumber('.'), 0);
  assert.equal(normalizeCalculatorInput('1.5', true), null);
  assert.equal(normalizeCalculatorInput('05', true), '5');
});

test('calculator returns exactly four prices and generates the requested internal message', () => {
  const prices = calculatePriceGuide({ normalUnit: 10, discountUnit: 9, count: 5, vatSeparate: true }, 'after');
  assert.deepEqual(prices, { normalUnit: 11, normalTotal: 55, appliedUnit: 9.9, appliedTotal: 49.5 });
  assert.equal(createPriceGuideMessage(prices, 5), '정상가는 1회 11만원으로 5회 진행 시 55만원이고,\n5회로 진행하시면 1회 9.9만원, 총 49.5만원입니다.');
  const changed = calculatePriceGuide({ normalUnit: 20, discountUnit: 18, count: 3, vatSeparate: true }, 'after');
  assert.equal(changed.normalTotal, changed.normalUnit * 3);
  assert.equal(changed.appliedTotal, changed.appliedUnit * 3);
});

test('payment buttons select exactly one method and can switch through card, cash, transfer and mixed', () => {
  let method = '';
  const onChange = value => { method = value; };
  for (const [index, expected] of ['card', 'cash', 'transfer', 'mixed'].entries()) {
    const buttons = paymentMethodButtons({ method, onChange });
    assert.equal(buttons[index].props.type, 'button');
    buttons[index].props.onClick();
    assert.equal(method, expected);
    const updated = paymentMethodButtons({ method, onChange });
    assert.deepEqual(updated.map(button => button.props['aria-pressed']), updated.map((_, i) => i === index));
    const html = renderPaymentMethods({ method, onChange });
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /disabled/);
  }
});

test('calculator opens on the general tab with only two menus', () => {
  const html = renderCalculator();
  assert.equal((html.match(/pc-mode-tabs/g) ?? []).length, 1);
  assert.ok(html.includes('일반 금액 계산'));
  assert.ok(html.includes('선불권 P'));
  for (const old of ['정가 · 할인가</button>', '>부가세</button>', '>할인율</button>']) assert.ok(!html.includes(old));
});

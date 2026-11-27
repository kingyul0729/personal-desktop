import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 2026-11-27 사용자 '편집을 누르면 흰 화면': 편집 목록이 프로그램을 그릴 때 itemText가 없어 화면 전체가 멈췄음
const bundled = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server.browser';
      import { ProgramEditor } from './src/app/components/PriceProgramCompare';
      export const render = (data) => renderToStaticMarkup(React.createElement(ProgramEditor, { category: '리프팅', data, onChange() {} }));
    `,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    loader: 'tsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const { render } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

test('user 11-27: 가격표 [편집]의 프로그램 목록이 멈추지 않고 횟수·샷 글자를 보여 줌', () => {
  const html = render({ lines: [], programs: [{ id: 'a', category: '리프팅', name: '울쎄라 300샷 (대표 원장님)', price: 1275000, items: [{ name: '울쎄라', qty: null, label: '300샷' }, { name: '스킨보톡스 S.V', qty: 1 }] }] });
  assert.match(html, /울쎄라 300샷/);
  assert.match(html, /스킨보톡스 S\.V 1회/);
});

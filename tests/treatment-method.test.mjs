import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 상담 화면(치료 방법·프로그램 안내)이 실제로 그려지는지: 문법 오류로 화면이 통째로 안 뜨는 일을 막는다.
const bundled = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server.browser';
      import { TreatmentMethod } from './src/app/components/TreatmentMethod';
      import { ProgramGuide } from './src/app/components/ProgramGuide';
      export const renderMethod = () => renderToStaticMarkup(React.createElement(TreatmentMethod));
      export const renderGuide = () => renderToStaticMarkup(React.createElement(ProgramGuide));
    `,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    loader: 'tsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const { renderMethod, renderGuide } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

test('treatment method and program guide render', () => {
  const method = renderMethod();
  assert.match(method, /색소는 어디에 있을까/);
  assert.match(method, /장비마다 닿는 깊이와 역할/);
  assert.match(renderGuide(), /색소/);
});

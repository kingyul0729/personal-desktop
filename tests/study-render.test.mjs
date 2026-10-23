import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundled = await build({ stdin: {
  contents: `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server.browser'; import { StudyDocument } from './src/app/components/StudyDocument';
    export const render = content => renderToStaticMarkup(React.createElement(StudyDocument, { note: { title: '공부 기록', content, revision: 1, updatedAt: 1 }, folder: '기초' }));`,
  resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx',
}, bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent' });
const { render } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

test('reader renders semantic title, subheading, paragraphs, tables and images in one document', () => {
  const html = render('## 기본 개념\n\n핵심 **설명**입니다.\n\n| 구분 | 특징 |\n| --- | --- |\n| A | B |\n\n![구조 그림](/api/study/assets/abcdefgh-1234)\n\n- 첫째\n- 둘째');
  for (const value of ['<article', '<h1>공부 기록</h1>', '<h2>기본 개념</h2>', '<strong>설명</strong>', '<table>', '<thead>', '<td>A</td>', 'alt="구조 그림"', '<ul>', 'aria-label="비교표"']) assert.ok(html.includes(value), value);
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /pf-image-grid|image-document-viewer|<textarea/);
});
test('imported HTML, scripts and javascript URLs never become executable content', () => {
  const html = render('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[위험](javascript:alert%281%29)\n\n![외부](data:text/html,evil)');
  assert.doesNotMatch(html, /<script|onerror|href="javascript|src="data:/);
  assert.match(html, /편집 화면/);
});

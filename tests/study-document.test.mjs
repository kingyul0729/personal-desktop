import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const bundle = await build({ stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server.browser'; import {StudyNoteText} from './src/app/components/StudyNoteText'; export const render = text => renderToStaticMarkup(React.createElement(StudyNoteText,{text}));`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic' });
const { render } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
test('study document separates subheadings, comparison table and emphasis', () => {
 const html = render('## 피부 구조\n\n본문\n| 층 | 기능 |\n| --- | --- |\n| 표피 | **보호** |\n\n__기억__ ==핵심==');
 assert.match(html, /<h3[^>]*>피부 구조<\/h3>/);
 assert.match(html, /<table><thead>/); assert.match(html, /<td>표피<\/td>/);
 assert.match(html, /note-important/); assert.match(html, /note-remember/); assert.match(html, /<mark>/);
});
test('study notes preserve user text without executing HTML', () => {
 const html = render('<script>alert(1)</script>\n<img src=x onerror=alert(1)>');
 assert.doesNotMatch(html, /<script|<img/); assert.match(html, /&lt;script&gt;/);
});

test('plain notes typed like a notebook become 강 · 소제목 · 작은 소제목 without marks', () => {
  const html = render('3강 테이블 디자인\n1) 테이블 디자인\n(1) 디자인 보기: 테이블 구조\n※ 이상현상\n- 삽입 이상\n핵심: 최소화');
  assert.match(html, /<h3 class="note-h1">3강 테이블 디자인<\/h3>/);
  assert.match(html, /<h3 class="note-h2">1\) 테이블 디자인<\/h3>/);
  assert.match(html, /<h3 class="note-h3">\(1\) 디자인 보기: 테이블 구조<\/h3>/);
  assert.match(html, /<h3 class="note-h3">※ 이상현상<\/h3>/);
  assert.match(html, /note-bullet/); assert.match(html, /class="note-key"/);
});

test('pasted text with other bullets, 1. numbering and tab tables is organised too', () => {
  const html = render('제2장 피부\n1. 표피\n가. 각질층\n• 장벽\n· 수분\n항목\t설명\n표피\t바깥층\n진피\t안쪽층');
  assert.match(html, /<h3 class="note-h1">제2장 피부<\/h3>/); assert.match(html, /<h3 class="note-h2">1\. 표피<\/h3>/);
  assert.match(html, /<h3 class="note-h3">가\. 각질층<\/h3>/); assert.equal(html.match(/note-bullet/g).length, 2);
  assert.match(html, /<th>항목<\/th><th>설명<\/th>/); assert.match(html, /<td>진피<\/td><td>안쪽층<\/td>/);
  assert.doesNotMatch(render('1.5배 늘어남'), /<h3/);
});

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

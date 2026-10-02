import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { getImageVariant, imageFitRatios, imageSwipeDirection } from '../src/app/imageNavigation.ts';
import { imageDimensions } from './image-dimensions.mjs';
import { initialPriceFiles } from '../src/app/priceFiles.ts';

const bundle = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server.browser';
      import { ImageDocumentViewer, ImageNavigation, ImageOrientationControl } from './src/app/components/ImageDocumentViewer';
      export const navigation = props => ImageNavigation(props).props.children;
      export const orientations = props => ImageOrientationControl(props).props.children;
      export const render = props => renderToStaticMarkup(React.createElement(ImageDocumentViewer, props));
    `,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'tsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const { navigation, orientations, render } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('a horizontal swipe changes direction while scrolling, tapping and slow dragging do not', () => {
  assert.equal(imageSwipeDirection(-120, 12, 240), 1);
  assert.equal(imageSwipeDirection(95, -9, 300), -1);
  assert.equal(imageSwipeDirection(12, -150, 240), 0);
  assert.equal(imageSwipeDirection(90, 80, 250), 0);
  assert.equal(imageSwipeDirection(-10, 2, 100), 0);
  assert.equal(imageSwipeDirection(-120, 0, 1200), 0);
});

test('the real navigation buttons move through the supplied list without leaving its bounds', () => {
  let index = 0;
  const buttons = () => navigation({ index, count: 7, onNavigate: next => { index = next; } });
  assert.equal(buttons()[0].props.disabled, true);
  for (let next = 1; next < 7; next++) {
    assert.equal(buttons()[2].props.disabled, false);
    buttons()[2].props.onClick();
    assert.equal(index, next);
  }
  assert.equal(buttons()[2].props.disabled, true);
  buttons()[0].props.onClick();
  assert.equal(index, 5);
  const single = navigation({ index: 0, count: 1, onNavigate() {} });
  assert.equal(single[0].props.disabled, true);
  assert.equal(single[2].props.disabled, true);
});

test('the viewer shows the selected file and its real position, with existing zoom controls', () => {
  const html = render({ name: '스페셜 토닝 4', src: '/documents/toning-special4.png', index: 3, count: 7, onBack() {}, onNavigate() {} });
  assert.match(html, /src="\/documents\/toning-special4.png"/);
  assert.match(html, /aria-label="현재 이미지 순서"[^>]*>4 \/ 7<\/output>/);
  for (const label of ['이전 이미지', '다음 이미지', '확대', '축소', '파일 목록으로 돌아가기']) assert.ok(html.includes(`aria-label="${label}"`));
  for (const label of ['너비 맞춤', '한 장 보기', '전체화면']) assert.ok(html.includes(label));
  assert.match(html, /class="document-stage document-stage-page"/);
  assert.match(html, /touch-action:pan-y pinch-zoom/);
});

test('every original fits completely inside both iPad orientations, including compact window sizes', () => {
  const viewports = [{ width: 820, height: 1180 }, { width: 1180, height: 820 }, { width: 640, height: 420 }];
  for (const image of initialPriceFiles.images) {
    for (const src of Object.values(image.variants ?? { default: image.src })) {
      const natural = imageDimensions(new URL(`../public${src}`, import.meta.url));
      for (const viewport of viewports) {
        for (const padding of [0, 16]) {
          const ratio = imageFitRatios(natural, viewport, padding).page;
          assert.ok(natural.width * ratio <= viewport.width - padding * 2 + 0.001, `${src} width fits`);
          assert.ok(natural.height * ratio <= viewport.height - padding * 2 + 0.001, `${src} height fits`);
        }
      }
    }
  }
});

test('orientation buttons select the supplied original while leaving the program order unchanged', () => {
  const image = initialPriceFiles.images.find(item => item.id === 'toning-special2');
  let preferred = 'landscape';
  const buttons = () => orientations({ variants: image.variants, orientation: getImageVariant(image, preferred).orientation, onChange: value => { preferred = value; } });
  assert.deepEqual(buttons().map(button => button.props['aria-pressed']), [true, false]);
  buttons()[1].props.onClick();
  assert.equal(getImageVariant(image, preferred).src, '/documents/toning-special2-portrait.png');
  assert.deepEqual(buttons().map(button => button.props['aria-pressed']), [false, true]);
  const next = initialPriceFiles.images.find(item => item.id === 'toning-special3');
  assert.equal(getImageVariant(next, preferred).src, '/documents/toning-special3-portrait.png');
  buttons()[0].props.onClick();
  assert.equal(getImageVariant(image, preferred).src, '/documents/toning-special2-landscape.png');
  const html = render({ ...image, index: 1, count: 7, onBack() {}, onNavigate() {} });
  assert.match(html, /aria-label="가격표 방향"/);
  assert.match(html, /aria-label="현재 이미지 순서"[^>]*>2 \/ 7<\/output>/);
});

test('missing portrait originals stay disabled and fall back without inventing or rotating an image', () => {
  const image = { src: '/documents/acne-guide.png', variants: { landscape: '/documents/acne-guide.png' } };
  const result = getImageVariant(image, 'portrait');
  assert.deepEqual(result, { src: image.src, orientation: 'landscape' });
  const buttons = orientations({ variants: image.variants, orientation: result.orientation, onChange() {} });
  assert.equal(buttons[1].props.disabled, true);
  assert.equal(buttons[0].props['aria-pressed'], true);
  const uploaded = { src: '/api/price-images/user-photo' };
  assert.deepEqual(getImageVariant(uploaded, 'portrait'), { src: uploaded.src, orientation: undefined });
});

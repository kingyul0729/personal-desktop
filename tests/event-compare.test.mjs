import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const load = async (f) => { const o = join(mkdtempSync(join(tmpdir(), 'ev-')), 'm.mjs'); const r = await build({ entryPoints: [f], bundle: true, format: 'esm', write: false }); writeFileSync(o, r.outputFiles[0].text); return import(pathToFileURL(o).href); };
const E = await load('src/app/eventCompare.ts');
const { compareRows } = await load('src/app/programCompare.ts');

// 가짜 예시(사용자 문서의 동작 확인 예시 숫자) — 실제 가격 자료는 파일로 넣음
const list = [
  { id: 'e1', category: '이벤트', name: '올리지오 600샷 패키지 [힐로웨이브 2cc]', price: 1210000, items: [{ name: '올리지오', qty: null, label: '600샷' }, { name: '힐로웨이브', qty: null, label: '2cc' }] },
  { id: 'e2', category: '이벤트', name: '올리지오 600샷 패키지 [리투오 5cc]', price: 1320000, items: [{ name: '올리지오', qty: null, label: '600샷' }, { name: '리투오', qty: null, label: '5cc' }] },
  { id: 'p1', category: '리프팅', name: '올리지오 600샷 (대표 원장님)', price: 1100000, items: [{ name: '올리지오', qty: null, label: '600샷' }] },
];

test('user 11-28: 이벤트 옵션 묶음 · 권종 할인은 정가에서 한 번', () => {
  const g = E.eventGroups(list);
  assert.equal(g.length, 1);
  assert.equal(g[0].base, '올리지오 600샷 패키지');
  assert.deepEqual(g[0].options.map(o => [o.label, o.program.price]), [['힐로웨이브 2cc', 1210000], ['리투오 5cc', 1320000]]);
  assert.deepEqual(E.TIERS.map(t => E.tierPrice(1100000, t)), [990000, 935000, 880000]);
  assert.equal(E.tierPrice(E.tierPrice(1100000, 300), 300) === E.tierPrice(1100000, 300), false); // 쌓으면 달라짐 — 화면은 늘 정가에서 계산
  assert.equal(E.tierPrice(null, 300), null);
});

test('user 11-28: 포함·1회처럼 단위가 다르면 차이로 강조하지 않음, 구성 동일 판정', () => {
  const c = (count) => ({ count, subs: [] });
  assert.equal(E.cellDiff(c('포함'), c('1회')), false);
  assert.equal(E.cellDiff(c('600샷'), c('1회')), false);
  assert.equal(E.cellDiff(c('5회'), c('3회')), true);
  assert.equal(E.cellDiff(c('2cc'), null), true);
  assert.equal(E.sameAll(compareRows(list[0].items, list[0].items)), true);
  assert.equal(E.sameAll(compareRows(list[0].items, list[2].items)), false);
});

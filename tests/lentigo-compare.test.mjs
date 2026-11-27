import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = join(mkdtempSync(join(tmpdir(), 'lent-')), 'm.mjs');
const r = await build({ entryPoints: ['src/app/lentigoCompare.ts'], bundle: true, format: 'esm', write: false });
writeFileSync(out, r.outputFiles[0].text);
const L = await import(pathToFileURL(out).href);
const { compareRows } = await import(pathToFileURL(await (async () => { const o = join(mkdtempSync(join(tmpdir(), 'pc-')), 'p.mjs'); const b = await build({ entryPoints: ['src/app/programCompare.ts'], bundle: true, format: 'esm', write: false }); writeFileSync(o, b.outputFiles[0].text); return o; })()).href);

const items = [{ name: '피코 532', qty: 1 }, { name: '레블라이트 SI', qty: 4 }];
const list = [
  { id: 'a', category: '색소', name: '스페셜 토닝 03', price: 1000, items: [{ name: '레블라이트 SI + 비타민 관리', qty: 4 }] },
  { id: 'b', category: '색소', name: '스페셜 토닝 03 추가 관리(1개)', price: 1100, items: [{ name: '레블라이트 SI + 비타민 관리', qty: 4 }, { name: '추가 관리', qty: null, label: '1개 +11만원' }] },
  { id: 's2', category: '색소', name: '흑자 제거 (1cm 초과 ~ 2cm 이하)', price: 44, items },
  { id: 's1', category: '색소', name: '흑자 제거 (1cm 이하)', price: 33, items },
];

test('user 11-27: 흑자 개별 제거 — 크기별 개수 × 등록 금액, 회차는 그대로, PICO 532 한 줄', () => {
  const sizes = L.lentigoSizes(list);
  assert.deepEqual(sizes.map(z => z.size), ['1cm 이하', '1cm 초과 ~ 2cm 이하']);
  const v = L.lentigoProgram(sizes, { s1: 3, s2: 1 });
  assert.equal(v.price, Math.round((33 * 3 + 44) * 0.7)); // 4개 → 30% 할인
  assert.deepEqual(v.items, [{ name: L.PICO_ROW, qty: null, label: '4개' }, { name: '레블라이트 SI', qty: 4 }]);
  assert.deepEqual(L.withLentigo(list, v).map(p => p.id), ['a', 'b', 'lentigo']);
  const other = L.withPicoRow(list[1]);
  const rows = compareRows(v.items, other.items);
  const pico = rows.find(x => x.name === L.PICO_ROW);
  assert.equal(pico.a.count, '4개'); assert.equal(L.PICO_ROW, 'PICO 532'); assert.equal(L.picoQty(sizes), 1); assert.equal(pico.b.count, '얼굴 전체');
  assert.equal(rows.find(x => x.name === '레블라이트 SI').a.count, '4회');
  assert.deepEqual(L.extraSplit(list[1], list), { base: 1000, extra: 100 });
  assert.equal(L.extraSplit(list[0], list), null);
});

test('user 11-27: 흑자 개수 할인 — 크기 무관 전체 개수, 정상 총액에 한 번, 5개 이상은 확인 필요', () => {
  const sizes = L.lentigoSizes(list);
  assert.deepEqual([1, 2, 3, 4, 5].map(L.lentigoRate), [0, 0.1, 0.2, 0.3, null]);
  assert.deepEqual(L.lentigoTotal(sizes, { s1: 1 }), { n: 1, normal: 33, rate: 0, off: 0, final: 33 });
  assert.deepEqual(L.lentigoTotal(sizes, { s1: 1, s2: 1 }), { n: 2, normal: 77, rate: 0.1, off: 8, final: 69 });
  const five = L.lentigoTotal(sizes, { s1: 3, s2: 2 });
  assert.equal(five.normal, 187); assert.equal(five.final, null); assert.equal(five.off, null);
  assert.equal(L.lentigoProgram(sizes, { s1: 5 }).price, null);
});

test('user 11-27: 스페셜 토닝 기본형 ↔ 추가 관리(1개) — 등록 금액만, 두 번 더하지 않음', () => {
  const ap = L.addonPair(list[0], list);
  assert.equal(ap.base.id, 'a'); assert.equal(ap.plus.id, 'b');
  assert.equal(L.addonPair(list[1], list).base.id, 'a');
  assert.equal(ap.plus.price, 1100);
  assert.equal(L.addonPair(list[2], list), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const mod = async () => {
  const r = await build({ entryPoints: ['src/app/programPick.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
};

test('user 11-29: 프로그램 고르기 팝업 — 시술 종류 · 일반/리프팅 고객 · 원장님 · 나머지 글자', async () => {
  const { pickItems } = await mod();
  const L = ' · 리프팅 고객 (시술 후 1년 이내)';
  const it = pickItems([
    { id: '1', name: '리바이브 1회' }, { id: '2', name: '리바이브 1회' + L }, { id: '3', name: '리바이브 1회 + LDM 트리플 1회' },
    { id: '4', name: '리투오 3회' }, { id: '5', name: '울쎄라 300샷 (대표 원장님)' }, { id: '6', name: '울쎄라 300샷 + 세르프 600샷 (부원장님)' },
    { id: '7', name: '세르프 600샷 (대표 원장님)' },
  ]);
  const by = Object.fromEntries(it.map(x => [x.id, x]));
  assert.deepEqual([by[1].kind, by[1].label, by[1].lift], ['리바이브', '1회', false]);
  assert.deepEqual([by[2].kind, by[2].label, by[2].lift], ['리바이브', '1회', true]);
  assert.equal(by[3].label, '1회 + LDM 트리플 1회');
  assert.deepEqual([by[5].kind, by[5].doc, by[5].label], ['울쎄라', '대표 원장님', '300샷']);
  assert.deepEqual([by[6].kind, by[6].doc, by[6].label], ['울쎄라', '부원장님', '300샷 + 세르프 600샷']);
  assert.deepEqual([by[4].kind, by[4].label], ['', '리투오 3회']); // 종류에 하나뿐 → '그 외'에 전체 이름
  assert.deepEqual([by[7].kind, by[7].label], ['', '세르프 600샷']);
  const flat = pickItems([{ id: 'a', name: '피코프락셀' }, { id: 'b', name: '피코프락셀 + CROSS' }]);
  assert.deepEqual(flat.map(x => [x.kind, x.label]), [['', '피코프락셀'], ['', '피코프락셀 + CROSS']]); // 묶을 게 없으면 그냥 목록
});

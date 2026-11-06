import assert from 'node:assert/strict';
import test from 'node:test';
import { folderTone, folderTones } from '../src/app/folderTone.ts';

test('folders with a similar purpose share one muted dot color', () => {
  assert.equal(folderTone('색소·토닝'), 'pigment');
  assert.equal(folderTone('홍조·혈관'), 'pigment');
  assert.equal(folderTone('여드름·흉터'), 'acne');
  assert.equal(folderTone('리프팅'), folderTone('스킨부스터'));
  assert.equal(folderTone('기타 프로그램'), 'etc');
  assert.equal(folderTone('새 폴더'), 'plain');
  // 공부 보관함 주제도 같은 규칙: 같은 목적이면 두 보관함에서 같은 색 점
  assert.equal(folderTone('색소·레이저'), folderTone('색소·토닝'));
  assert.equal(folderTone('홍조·혈관'), 'pigment');
  assert.equal(folderTone('상담·기타'), 'etc');
  assert.equal(folderTone('피부 기초'), 'etc');
  assert.equal(new Set(Object.values(folderTones).map(tone => tone.front)).size, 5);
});

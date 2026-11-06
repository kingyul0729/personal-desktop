import assert from 'node:assert/strict';
import test from 'node:test';
import { folderTone, folderTones } from '../src/app/folderTone.ts';

test('folders with a similar purpose share one muted color', () => {
  assert.equal(folderTone('색소·토닝'), 'pigment');
  assert.equal(folderTone('홍조·혈관'), 'pigment');
  assert.equal(folderTone('여드름·흉터'), 'acne');
  assert.equal(folderTone('리프팅'), folderTone('스킨부스터'));
  assert.equal(folderTone('기타 프로그램'), 'etc');
  assert.equal(folderTone('새 폴더'), 'plain');
  assert.equal(new Set(Object.values(folderTones).map(tone => tone.front)).size, 5);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { guideCategories, sessionCells, treatments } from '../src/app/programGuide.ts';

test('program guide uses only the confirmed special toning data', () => {
  const pigment = guideCategories.find(category => category.id === 'pigment');
  const byId = Object.fromEntries(pigment.programs.map(program => [program.id, program]));
  assert.deepEqual(['st1', 'st2', 'st3', 'st4'].map(id => [byId[id].sessions, byId[id].price]), [[11, 1320000], [10, 1430000], [11, 1540000], [10, 1540000]]);
  // 구성 회차를 더하면 총 내원 횟수와 같다
  for (const program of pigment.programs) {
    assert.equal(sessionCells(program).length, program.sessions, program.name);
    for (const part of program.parts) assert.ok(treatments[part.treatment], part.treatment);
  }
  assert.deepEqual(byId.st3.included, ['co2']);
  assert.deepEqual(byId.st4.extras.options.map(option => option.price), [1650000, 1760000]);
  assert.equal(byId.st4.tag, 'ABNOM');
  // 과장 표현을 쓰지 않는다
  const words = JSON.stringify(guideCategories) + JSON.stringify(treatments);
  assert.doesNotMatch(words, /완치|100%|무조건|반드시|재발하지|영구/);
});

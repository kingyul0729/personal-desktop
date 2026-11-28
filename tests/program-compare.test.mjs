import assert from 'node:assert/strict';
import test from 'node:test';
import { compareRows } from '../src/app/programCompare.ts';

const t = (c) => (c ? [c.count, ...c.subs].join(' / ') : '—');
const flat = (rows) => rows.map(r => `${t(r.a)} | ${r.name} | ${t(r.b)}${r.same ? '' : ' *'}`);

test('user 11-26 밤: 비교 줄 공통 기준 — 같은 조합 한 줄, 한쪽만 더한 것은 + 이름, 서비스, 단독·병행 합치기', () => {
  // 같은 레이저에 관리만 다름 → 레이저 이름 한 줄, 관리는 횟수 아래 '+'
  // 관리는 레이저에서 떼어 맨 아래 따로 한 줄(총횟수)
  assert.deepEqual(flat(compareRows(
    [{ name: '레이저A + 비타민', qty: 5 }, { name: '레이저C + 비타민 관리', qty: 5 }],
    [{ name: '레이저A + LDM 트리플', qty: 5 }, { name: '레이저B S.V', qty: 1 }])), [
    '5회 | 레이저A | 5회',
    '— | 레이저B | 포함 *',
    '5회 | 레이저C | — *',
    '— | LDM 트리플 | 5회 *',
    '10회 | 비타민 관리 | — *',
  ]);
  // 두 쪽이 같이 하는 조합은 가운데에 묶고, 한쪽만 더한 시술은 '+'
  assert.deepEqual(flat(compareRows(
    [{ name: '레이저A + 레이저C + LDM 트리플', qty: 5 }, { name: '레이저B + LDM 트리플', qty: 5 }],
    [{ name: '레이저A + 레이저C + LDM 트리플', qty: 5 }, { name: '레이저B + 레이저D + LDM 트리플', qty: 5 }])), [
    '5회 | 레이저A + 레이저C | 5회',
    '5회 | 레이저B | 5회 / + 레이저D *',
    '10회 | LDM 트리플 | 10회',
  ]);
  // 같은 시술의 서비스 여부는 같은 줄
  assert.deepEqual(flat(compareRows([{ name: '레이저B', qty: 1 }], [{ name: '레이저B S.V', qty: 1 }])), ['1회 | 레이저B | 포함 *']);
  // 한 프로그램 안에서 LDM 단독·병행 → 한 줄 총횟수 + 세부, 다른 쪽 단독만이면 '단독'
  assert.deepEqual(flat(compareRows(
    [{ name: '레이저E + LDM 트리플', qty: 5 }, { name: 'LDM 트리플 단독 관리', qty: 5 }],
    [{ name: 'LDM 트리플 관리', qty: 10 }])), [
    '5회 | 레이저E | — *',
    '10회 / (레이저E 병행 5) / (단독 5) | LDM 트리플 | 10회 / (단독) *',
  ]);
  // 다른 레이저끼리는 따로, 관리는 같은 줄
  assert.deepEqual(flat(compareRows([{ name: '레이저A + LDM 트리플', qty: 5 }], [{ name: '레이저B + LDM 트리플', qty: 5 }])), [
    '— | 레이저B | 5회 *', '5회 | 레이저A | — *', '5회 | LDM 트리플 | 5회']);
  // 같은 프로그램끼리는 모두 같음, 차이만 보기로 숨을 줄
  const same = [{ name: '압출 + 스케일링', qty: 2 }, { name: 'CO₂', qty: null, label: '포함' }];
  assert.ok(compareRows(same, same).every(x => x.same));
});

test('user 11-27: 리프팅 S.V 관리는 서비스만(단독 아님), 샷 수는 글자 그대로', () => {
  const rows = compareRows(
    [{ name: '울쎄라', label: '300샷' }, { name: '스킨보톡스 S.V', qty: 1 }],
    [{ name: '울쎄라', label: '300샷' }, { name: '올리지오', label: '600샷' }, { name: '스킨보톡스 S.V', qty: 1 }, { name: 'LDM 트리플 S.V', qty: 1 }],
  );
  const ldm = rows.find(r => r.name === 'LDM 트리플');
  assert.deepEqual(ldm.b, { count: '포함', subs: [] });
  assert.equal(rows.find(r => r.name === '울쎄라').same, true);
});

test('user 11-27: 한쪽에만 더해진 시술은 각각, S.V는 이름 옆 S/V', () => {
  const rows = compareRows([{ name: '피코프락셀', qty: 5 }], [{ name: '피코프락셀 + CROSS + 서브시전 S.V', qty: 5 }]);
  assert.deepEqual(rows[0].b.subs, ['+ CROSS', '+ 서브시전 (S.V)']);
  const r2 = compareRows([{ name: '피코프락셀 + CROSS', qty: 5 }], [{ name: '피코프락셀 + CROSS + 서브시전', qty: 5 }]);
  assert.deepEqual(r2[0].b.subs, ['+ 서브시전']);
});

test('user 11-27: 흉터는 더해진 시술을 각각 따로 줄, S.V는 S/V', () => {
  const rows = compareRows([{ name: '피코프락셀', qty: 5 }], [{ name: '피코프락셀 + CROSS + 서브시전 S.V', qty: 5 }, { name: '크라이오 관리 + 모델링팩', qty: 5 }], { split: true });
  assert.deepEqual(rows.map(r => [r.name, r.a?.count ?? '—', r.b?.count ?? '—', (r.b?.subs ?? []).join()]), [
    ['피코프락셀', '5회', '5회', ''], ['CROSS', '—', '5회', ''], ['서브시전', '—', '5회', '(S.V)'], ['크라이오 관리 + 모델링팩', '—', '5회', ''],
  ]);
});

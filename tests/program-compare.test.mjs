import assert from 'node:assert/strict';
import test from 'node:test';
import { compareRows } from '../src/app/programCompare.ts';

const t = (c) => (c ? [c.count, ...c.subs].join(' / ') : '—');
const flat = (rows) => rows.map(r => `${t(r.a)} | ${r.name} | ${t(r.b)}${r.same ? '' : ' *'}`);

test('user 11-26 밤: 비교 줄 공통 기준 — 같은 조합 한 줄, 한쪽만 더한 것은 + 이름, 서비스, 단독·병행 합치기', () => {
  // 같은 레이저에 관리만 다름 → 레이저 이름 한 줄, 관리는 횟수 아래 '+'
  assert.deepEqual(flat(compareRows(
    [{ name: '레이저A + 비타민', qty: 5 }],
    [{ name: '레이저A + LDM 트리플', qty: 5 }, { name: '레이저B S.V', qty: 1 }])), [
    '5회 / + 비타민 관리 | 레이저A | 5회 / + LDM 트리플 *',
    '— | 레이저B | 1회 / 서비스 *',
  ]);
  // 두 쪽이 같이 하는 조합은 가운데에 묶고, 한쪽만 더한 시술은 '+'
  assert.deepEqual(flat(compareRows(
    [{ name: '레이저A + 레이저C + LDM 트리플', qty: 5 }, { name: '레이저B + LDM 트리플', qty: 5 }],
    [{ name: '레이저A + 레이저C + LDM 트리플', qty: 5 }, { name: '레이저B + 레이저D + LDM 트리플', qty: 5 }])), [
    '5회 | 레이저A + 레이저C + LDM 트리플 | 5회',
    '5회 | 레이저B + LDM 트리플 | 5회 / + 레이저D *',
  ]);
  // 같은 시술의 서비스 여부는 같은 줄
  assert.deepEqual(flat(compareRows([{ name: '레이저B', qty: 1 }], [{ name: '레이저B S.V', qty: 1 }])), ['1회 | 레이저B | 1회 / 서비스 *']);
  // 한 프로그램 안에서 LDM 단독·병행 → 한 줄 총횟수 + 세부, 다른 쪽 단독만이면 '단독'
  assert.deepEqual(flat(compareRows(
    [{ name: '레이저E + LDM 트리플', qty: 5 }, { name: 'LDM 트리플 단독 관리', qty: 5 }],
    [{ name: 'LDM 트리플 관리', qty: 10 }])), [
    '5회 | 레이저E | — *',
    '10회 / 레이저E 병행 5 / 단독 5 | LDM 트리플 | 10회 / 단독 *',
  ]);
  // 관리만 겹치는 조합끼리는 묶지 않음
  const r = compareRows([{ name: '레이저A + LDM 트리플', qty: 5 }], [{ name: '레이저B + LDM 트리플', qty: 5 }]);
  assert.equal(r.length, 2);
  // LED 재생레이저처럼 따라붙는 것만 겹쳐도 묶지 않음(MAX-G · 알렉스 + LED / MAX-G · PICO 1064 + LED)
  assert.equal(compareRows([{ name: '레이저A + LED 재생레이저', qty: 2 }], [{ name: '레이저B + LED 재생레이저', qty: 2 }]).length, 2);
  // 같은 프로그램끼리는 모두 같음, 차이만 보기로 숨을 줄
  const same = [{ name: '압출 + 스케일링', qty: 2 }, { name: 'CO₂', qty: null, label: '포함' }];
  assert.ok(compareRows(same, same).every(x => x.same));
});

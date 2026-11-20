// 연차 사용 기록 수정·취소의 저장 순서(2026-11-21 '연차 수정이 순차 저장 — 중간 실패 검증').
// 서버 저장이 세 번(원래 날 근태 → 새 날 연차 → 기록 연결)이라 중간에 끊겨도 숫자가 꼬이지 않게:
// ① 원래 날을 먼저 바꾼다(연차 해제) — 실패하면 아무것도 안 바뀜.
// ② 새 날 연차 — 실패하면 ①을 원래 기록 그대로 되돌림(원래 날은 늘 기록이 있어 되돌릴 수 있음).
// ③ 기록 연결 — 실패해도 스케줄·사용연차는 이미 맞음. 몇 번 다시 하고, 그래도 안 되면 같은 창에서 저장을 다시 누르면
//    지금 스케줄을 보고 끝난 단계는 건너뛰고 ③만 한다. 응답만 못 받고 이미 연결됐으면('취소된 기록') 끝난 것으로 본다.
import type { AttendanceRecord, StaffMember } from './staffRules';
import { isRedDay, payloadFor, statePatch, todayLocal } from './staffRules';

export type UseFixApi = {
  rec: (date: string) => Promise<AttendanceRecord | null>;
  post: (path: string, body: unknown) => Promise<unknown>;
};
export type UseFixInput = { logId: number; from: string; kind: 'edit' | 'cancel'; date: string; state: string; reason: string };

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e || ''));
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export async function runUseFix(api: UseFixApi, staff: StaffMember, x: UseFixInput, today = todayLocal()) {
  const { from, kind, date, state, reason } = x;
  if (kind === 'edit') {
    if (date === from) throw new Error('바뀐 것이 없어요');
    if (isRedDay(date)) throw new Error('빨간 날에는 연차를 넣지 않아요');
    if (date.slice(0, 7) > today.slice(0, 7)) throw new Error('다음 달 연차는 직원스케줄에서 넣어 주세요');
  }
  const src = await api.rec(from);
  const dst = kind === 'edit' ? await api.rec(date) : null;
  const srcLeave = src?.attendance === '연차';
  // 처음 저장인데 새 날이 이미 연차면 막음(앞 저장이 ①②까지 끝난 경우는 원래 날이 연차가 아니라 이어서 함)
  if (kind === 'edit' && srcLeave && dst?.attendance === '연차') throw new Error('그날은 이미 연차예요');
  // ① 원래 날 근태
  if (srcLeave) await api.post('/attendance', payloadFor(staff, from, src, statePatch(state, staff, from, src)));
  // ② 새 날 연차
  if (kind === 'edit' && dst?.attendance !== '연차') {
    try { await api.post('/attendance', payloadFor(staff, date, dst, statePatch('연차', staff, date, dst))); }
    catch (e) {
      if (srcLeave) {
        try { await api.post('/attendance', payloadFor(staff, from, src, {})); }
        catch { throw new Error(`저장하지 못했어요. 직원스케줄 ${md(from)}·${md(date)}를 확인해 주세요`); }
        throw new Error(`저장하지 못해 ${md(from)} 연차를 원래대로 되돌렸어요 · ${msgOf(e)}`);
      }
      throw e;
    }
  }
  // ③ 기록 연결
  const body = { action: kind === 'edit' ? 'use-move' : 'use-cancel', reason, date };
  let last: unknown = null;
  for (let i = 0; i < 3; i++) {
    try { await api.post(`/leave-fix/${x.logId}`, body); return; }
    catch (e) {
      if (msgOf(e).includes('취소된 기록')) return; // 앞 요청이 이미 연결함
      if (msgOf(e).includes('아직 연차')) throw e;
      last = e;
    }
  }
  throw new Error(`스케줄은 바뀌었어요. 저장을 한 번 더 눌러 주세요 · ${msgOf(last)}`);
}

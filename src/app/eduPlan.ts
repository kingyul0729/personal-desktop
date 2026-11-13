// 피부팀 신입 직원 20일 교육 일정(2026-11-14 사용자가 보낸 문서 그대로). 팀장 교육(lead) / 직원 교육(staff)을 나눠 둔다.
// 항목 키 = d{일차}-l{번호}(팀장) · d{일차}-s{번호}(직원). 키는 저장된 체크와 이어지므로 순서를 바꾸지 말 것(뒤에 더하기만).
export type EduDay = { day: number; title?: string; lead: string[]; staff: string[]; evalItems?: string };
export type EduStage = { n: number; title: string; from: number; to: number };

export const EDU_STAGES: EduStage[] = [
  { n: 1, title: '기본 업무 및 환자 응대', from: 1, to: 5 },
  { n: 2, title: '비타민·크라이오 관리', from: 6, to: 9 },
  { n: 3, title: '마취크림 및 기본 관리 반복', from: 10, to: 12 },
  { n: 4, title: 'LDM 관리', from: 13, to: 15 },
  { n: 5, title: '여드름 프로그램', from: 16, to: 20 },
];

export const EDU_DAYS: EduDay[] = [
  { day: 1, title: '피부팀 기본 업무 익히기',
    lead: ['피부팀 담당 업무 및 부서별 역할 안내', '레이저 장비명과 외형 구별하기', '업무 진행 시 확인사항 및 주의사항', '클렌징 숙련도 확인', '클렌징 진행하기 (필요 시 교육)'],
    staff: ['병원 내부 공간 및 관리실 위치 안내', '오픈·마감 업무 배우기'] },
  { day: 2, title: '환자 응대 및 기본 업무 배우기', lead: [],
    staff: ['당일 예약 스케줄 확인하기', '환자 맞이 및 파우더룸 안내하기', '무전 듣고 상황 파악하기', '팩 올리기', '관리 마무리하기'] },
  { day: 3, lead: [], staff: ['2일차 업무 반복', '환자 안내·클렌징·팩·마무리 실제 진행'] },
  { day: 4, lead: ['프로그램 확인 방법', '무전 기준', '레이저 기계 준비 기준'], staff: ['환자 모시기', '클렌징', '무전 및 기계 준비 연습'] },
  { day: 5, lead: ['기본 업무 진행 상태 확인'], staff: ['4일차 업무 반복', '환자 안내부터 기계 준비까지 진행'], evalItems: '환자 안내 · 클렌징 · 팩 · 마무리 · 무전 및 기계 준비' },
  { day: 6, lead: ['비타민관리 순서, 방법 및 주의사항 교육'], staff: ['비타민관리 준비 및 연습', '팀장 확인하에 실제 관리 진행'] },
  { day: 7, lead: ['크라이오관리 순서, 방법 및 주의사항 교육'], staff: ['크라이오관리 연습 및 실제 관리 진행', '비타민관리 반복'] },
  { day: 8, lead: [], staff: ['환자 맞이부터 관리 준비·팩·마무리까지 전체 과정 연습 (관리 단계 제외)'] },
  { day: 9, lead: ['관리 진행 상태 및 부족한 부분 확인'], staff: ['비타민·크라이오관리를 포함한 전체 과정 실제 진행'], evalItems: '비타민·크라이오관리 진행' },
  { day: 10, lead: ['마취크림 도포 관련 기준, 환자 안내 문구 및 주의사항'], staff: ['마취크림 관련 준비·안내 업무 연습', '기본 관리 반복'] },
  { day: 11, lead: [], staff: ['환자 맞이부터 클렌징·관리·마무리까지 전체 과정 진행'] },
  { day: 12, lead: ['기본 관리 숙련도 확인 및 부족한 업무 지정'], staff: ['기본 관리 반복', '부족한 부분 보완'], evalItems: '기본 관리 전체 과정 및 환자 응대' },
  { day: 13, lead: ['LDM 관리 순서, 장비 사용 기준, 적용 방법 및 주의사항'], staff: ['LDM 장비 준비 및 관리 연습', '비타민관리 반복'] },
  { day: 14, lead: [], staff: ['LDM 관리 연습 및 팀장 확인하에 실제 관리 진행'] },
  { day: 15, lead: ['LDM 관리 숙련도 확인'], staff: ['LDM 관리 반복', '기본 관리 전체 과정 진행'], evalItems: 'LDM 관리 및 기본 관리 숙련도' },
  { day: 16, lead: ['여드름 프로그램별 구성, 진행 순서 및 어시스트 업무범위 교육'], staff: ['프로그램별 준비 물품 및 장비 위치 익히기'] },
  { day: 17, lead: [], staff: ['여드름 프로그램 준비 방법 교육', '어시스트 시범 및 관찰'] },
  { day: 18, lead: [], staff: ['여드름 프로그램 직접 준비', '직원과 함께 어시스트 연습'] },
  { day: 19, lead: ['어시스트 진행 상태 확인'], staff: ['프로그램 준비 및 어시스트 반복', '마무리 연습'] },
  { day: 20, lead: ['여드름 프로그램 준비 및 어시스트 숙련도 최종 확인'], staff: ['프로그램 준비부터 어시스트·마무리까지 실제 진행'], evalItems: '여드름 프로그램 준비, 어시스트 및 마무리' },
];

export const EDU_PRINCIPLES = [
  '클렌징은 팀장이 숙련도를 확인하고, 필요할 경우 직접 교육한다.',
  '팩은 직원이 1~2회 교육한 후 실제 업무에 참여하도록 한다.',
  '새로운 관리의 진행 방법과 주의사항은 팀장이 먼저 교육한다.',
  '팀장이 교육한 업무는 직원이 반복 연습을 지도한다.',
  '신입 직원이 기존에 할 수 있는 업무는 숙련도를 확인한 후 실무에 참여하도록 한다.',
  '팀장은 지정된 평가일에 숙련도를 확인하고 추가 교육 여부를 결정한다.',
  '교육 진도는 직원별 숙련도와 실제 환자 일정에 따라 조정한다.',
  '의료행위에 해당하는 업무는 적법한 자격과 의료진 지시에 따라 수행하며, 단순 교육 이수만으로 수행 권한을 부여하지 않는다.',
];
export const EDU_GOALS = [
  '당일 프로그램을 확인하고 필요한 물품과 장비를 준비할 수 있다.',
  '기본 관리 업무를 정해진 순서에 따라 진행할 수 있다.',
  '여드름 프로그램 어시스트 업무를 이해하고 선임 직원과 함께 진행할 수 있다.',
  '관리 후 환자 안내와 마무리 업무를 진행할 수 있다.',
];

export const itemKey = (day: number, role: 'lead' | 'staff', i: number) => `d${day}-${role === 'lead' ? 'l' : 's'}${i + 1}`;
export const dayKeys = (d: EduDay) => [...d.lead.map((_, i) => itemKey(d.day, 'lead', i)), ...d.staff.map((_, i) => itemKey(d.day, 'staff', i))];
export const stageOf = (day: number) => EDU_STAGES.find(s => day >= s.from && day <= s.to) || EDU_STAGES[0];

export type EduCheck = { teacher: string; at: number };
export type EduTrainee = { id: number; name: string; start_date: string | null; checks: Record<string, EduCheck>; evals: Record<string, { result: 'pass' | 'more'; at: number }> };
export type EduDoc = { id: number; item_key: string; name: string; mime: string };

/** 끝난 일차 = 그 날 항목을 모두 체크(평가일은 평가 결과까지). 지금 일차 = 아직 안 끝난 첫 날. */
export function progressOf(t: EduTrainee) {
  const dayDone = (d: EduDay) => dayKeys(d).every(k => t.checks[k]) && (!d.evalItems || !!t.evals[String(d.day)]);
  const done = EDU_DAYS.filter(dayDone).length;
  const current = EDU_DAYS.find(d => !dayDone(d))?.day ?? null;
  const nextEval = EDU_DAYS.find(d => d.evalItems && !t.evals[String(d.day)])?.day ?? null;
  return { done, current, nextEval, finished: current == null, dayDone };
}

// 고객 상담 화면용 프로그램 안내 데이터.
// 구성·횟수·가격은 병원 확정 자료(스페셜토닝 1~4, v6 통합문서)만 쓴다. 회차 순서는 확정 자료에 없으므로 '구성'으로만 보여 준다.
// 장비 설명은 과장 없이 역할만 짧게. 병원 확정 문구가 오면 role 문장만 바꾸면 된다.
export type TreatmentTone = 'sage' | 'blue' | 'navy' | 'rose' | 'sand' | 'gray';

export interface Treatment {
  id: string;
  name: string;
  tone: TreatmentTone;
  role: string;
}

export interface ProgramPart { treatment: string; count: number }
export interface ProgramExtra { label: string; price: number }

export interface GuideProgram {
  id: string;
  name: string;
  tag?: string;          // 예: ABNOM
  summary: string;       // 구성 한 줄
  sessions: number;      // 총 내원 횟수
  price: number;         // 원
  parts: ProgramPart[];  // 회차가 있는 구성 (합 = sessions)
  included?: string[];   // 회차와 별개로 기본 포함되는 시술
  extras?: { note: string; options: ProgramExtra[] };
}

export interface GuideCategory { id: string; name: string; programs: GuideProgram[] }

export const treatments: Record<string, Treatment> = {
  starlux: { id: 'starlux', name: '스타룩스 1540', tone: 'sage', role: '1540nm 비박리 프락셔널 레이저예요. 피부 속에 아주 작은 열 자극을 촘촘히 주어 재생을 돕고, 피부결과 톤을 함께 다듬어요.' },
  revlite: { id: 'revlite', name: '레블라이트 + 비타민', tone: 'blue', role: '낮은 에너지로 여러 번 나눠 하는 레이저 토닝이에요. 넓게 퍼진 색소를 조금씩 옅게 하고, 시술 후 비타민 관리를 함께 해요.' },
  pico: { id: 'pico', name: '피코플러스 + 비타민', tone: 'navy', role: '아주 짧은 순간(피코초)에 빛을 주는 레이저 토닝이에요. 색소를 잘게 부숴 몸이 처리하기 쉽게 하고, 비타민 관리를 함께 해요.' },
  maxgAlex: { id: 'maxgAlex', name: 'MaxG + 노블린 755nm', tone: 'rose', role: 'MaxG(빛 치료)로 표면의 잡티와 붉은기를 넓게 다루고, 노블린 755nm로 주근깨·일광흑자처럼 또렷한 색소를 겨냥해요.' },
  maxgPico1064: { id: 'maxgPico1064', name: 'MaxG + 피코 1064nm', tone: 'rose', role: 'MaxG로 표면 잡티를 다루고, 피코 1064nm로 피부 깊은 층(진피)에 있는 색소를 겨냥해요.' },
  co2: { id: 'co2', name: '얼굴 전체 점 CO2 제거', tone: 'sand', role: '얼굴의 점을 레이저로 얇게 깎아 제거해요. 프로그램에 기본으로 포함돼요.' },
};

const addOns = { note: '추가 치료: CO2 제거 또는 흑자 피코 532 제거 (1종 11만원)', options: [{ label: '추가 치료 1종 포함', price: 1650000 }, { label: '추가 치료 2종 포함', price: 1760000 }] };

export const guideCategories: GuideCategory[] = [
  {
    id: 'pigment', name: '색소',
    programs: [
      { id: 'st1', name: '스페셜 토닝 1', summary: '스타룩스 1540 1회 + 토닝 10회', sessions: 11, price: 1320000,
        parts: [{ treatment: 'starlux', count: 1 }, { treatment: 'revlite', count: 5 }, { treatment: 'pico', count: 5 }] },
      { id: 'st2', name: '스페셜 토닝 2', summary: '또렷한 잡티 치료 2회 + 토닝 8회', sessions: 10, price: 1430000,
        parts: [{ treatment: 'maxgAlex', count: 2 }, { treatment: 'revlite', count: 4 }, { treatment: 'pico', count: 4 }] },
      { id: 'st3', name: '스페셜 토닝 3', summary: '스타룩스 1540 1회 + 잡티 치료 2회 + 토닝 8회, 점 제거 포함', sessions: 11, price: 1540000,
        parts: [{ treatment: 'starlux', count: 1 }, { treatment: 'maxgAlex', count: 2 }, { treatment: 'revlite', count: 4 }, { treatment: 'pico', count: 4 }],
        included: ['co2'], extras: addOns },
      { id: 'st4', name: '스페셜 토닝 4', tag: 'ABNOM', summary: '깊은 색소 치료 2회 + 토닝 8회, 점 제거 포함', sessions: 10, price: 1540000,
        parts: [{ treatment: 'maxgPico1064', count: 2 }, { treatment: 'revlite', count: 4 }, { treatment: 'pico', count: 4 }],
        included: ['co2'], extras: addOns },
    ],
  },
];

export const findProgram = (id: string) => guideCategories.flatMap(category => category.programs.map(program => ({ category, program }))).find(entry => entry.program.id === id);
// 회차 칸: 구성 순서대로 펼친 목록(순서가 아니라 비율을 보여 주는 용도)
export const sessionCells = (program: GuideProgram) => program.parts.flatMap(part => Array.from({ length: part.count }, () => part.treatment));

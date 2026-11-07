-- ============================================
-- 0009: 직원 운영 (직원 스케줄 탭)
-- ============================================
-- 요구사항(명세):
--   · 직원 스케줄 탭은 직원별 근태/실근무시간/관리 인원/지정 환자 수/연차/직원정보/퇴사를 관리하는 원본 입력 화면
--   · 직원 성과 탭은 이 데이터를 월 단위로 조회만 한다(수정 불가)
--   · 데이터는 절대 삭제하지 않는다(퇴사=상태변경 retired, 연차/정보 이력은 누적 기록)
-- 비즈니스 로직(계산식)은 서버 staff.ts / 프런트 staff.js 에서 처리한다.

-- ── 직원 테이블 ──
--   status: 'active'(재직) | 'retired'(퇴사)  → 직원 삭제는 사용하지 않는다
--   is_leader: 팀장 여부(김유리 1명 고정). 팀장 전용 근태(상담/미기록) 노출 제어용
--   total_leave / used_leave: 연차 원본 수치. 잔여 연차 = total_leave - used_leave (계산은 코드에서)
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  position TEXT DEFAULT '직원',          -- 직책 (예: 팀장 / 직원)
  is_leader INTEGER DEFAULT 0,           -- 팀장 여부 (김유리=1)
  hire_date TEXT,                        -- 입사일자 (YYYY-MM-DD) · 필수 입력(코드 검증)
  retire_date TEXT,                      -- 퇴사일자 (YYYY-MM-DD) · 퇴사 처리 시 기록
  status TEXT DEFAULT 'active',          -- active | retired
  total_leave INTEGER DEFAULT 0,         -- 총 발생 연차
  used_leave INTEGER DEFAULT 0,          -- 사용 연차
  second_shift_count INTEGER DEFAULT 0,  -- 2출 지정 횟수
  memo TEXT,                             -- 직원 메모
  sort_order INTEGER DEFAULT 0,          -- 보조 정렬값(필요 시)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── 직원 근태 기록 (직원 × 날짜 단위 원본 데이터) ──
--   attendance: 정상근무 / 2출 / 휴무 / 연차 / 상담 / 공휴일 / 미기록 / 기타
--   etc_type:   기타일 때 세부 유형 → 'time'(시간 인정 기타) | 'unpaid'(무급 기타)
--   etc_detail: 시간 인정 기타의 세부 유형(오버타임사용/조퇴/중간상담/기타 시간 인정 근무 등)
--   work_minutes: 자동 계산된 실근무시간(분). 계산 제외 상태는 NULL(0시간 저장 금지)
--   manual_adjust / adjust_reason: 근무시간 수동 보정 여부와 사유
--   managed_count: 관리 인원, designated_count: 지정 환자 수 (미입력은 NULL)
CREATE TABLE IF NOT EXISTS staff_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  work_date TEXT NOT NULL,               -- YYYY-MM-DD
  attendance TEXT NOT NULL,              -- 근태 상태
  etc_type TEXT,                         -- time | unpaid (기타일 때)
  etc_detail TEXT,                       -- 시간 인정 기타 세부 유형
  start_time TEXT,                       -- HH:MM
  end_time TEXT,                         -- HH:MM
  work_minutes INTEGER,                  -- 실근무시간(분), 계산 제외 상태는 NULL
  manual_adjust INTEGER DEFAULT 0,       -- 근무시간 수동 보정 여부
  adjust_reason TEXT,                    -- 수동 보정 사유
  managed_count INTEGER,                 -- 관리 인원 (미입력 NULL)
  designated_count INTEGER,              -- 지정 환자 수 (미입력 NULL)
  memo TEXT,                             -- 메모
  editor TEXT DEFAULT '관리자',          -- 처리자
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(staff_id, work_date),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);

-- ── 날짜 전체 상태 (병원휴무) ──
--   병원휴무는 개별 직원 근태가 아니라 전체 날짜 상태로 관리한다.
--   해당 날짜는 전체 직원의 성과 계산에서 제외한다.
CREATE TABLE IF NOT EXISTS staff_day_status (
  work_date TEXT PRIMARY KEY,            -- YYYY-MM-DD
  status TEXT NOT NULL,                  -- 'clinic_off'(병원휴무) 등
  memo TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── 연차 이력 (사용/되돌림/수동수정/지급/전환) · 삭제 금지, 누적 기록 ──
--   log_type: 'use'(연차 사용) | 'revert'(사용 되돌림) | 'adjust'(수동 수정)
--             | 'grant'(월 발생 지급) | 'convert'(정직원 기준 전환)
CREATE TABLE IF NOT EXISTS staff_leave_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  log_type TEXT NOT NULL,
  log_date TEXT,                         -- 관련 날짜(연차 사용 날짜 등)
  amount INTEGER,                        -- 변동 수량(+1 / -1 등)
  before_total INTEGER,                  -- 수정 전 총 발생 연차
  after_total INTEGER,                   -- 수정 후 총 발생 연차
  before_used INTEGER,                   -- 수정 전 사용 연차
  after_used INTEGER,                    -- 수정 후 사용 연차
  after_remain INTEGER,                  -- 차감/수정 후 잔여 연차
  reason TEXT,                           -- 수정/취소 사유
  memo TEXT,
  editor TEXT DEFAULT '관리자',          -- 처리자
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);

-- ── 직원 정보 수정 이력 · 삭제 금지, 누적 기록 ──
CREATE TABLE IF NOT EXISTS staff_info_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  changes TEXT,                          -- 변경 내용 요약(JSON 문자열)
  editor TEXT DEFAULT '관리자',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_att_staff_date ON staff_attendance(staff_id, work_date);
CREATE INDEX IF NOT EXISTS idx_att_date ON staff_attendance(work_date);
CREATE INDEX IF NOT EXISTS idx_leave_staff ON staff_leave_log(staff_id);
CREATE INDEX IF NOT EXISTS idx_info_staff ON staff_info_log(staff_id);

-- ── 기본 직원 시드 (명세 [3]) ──
--   김유리 팀장 고정 + 일반 직원 4명. 입사일은 입사일 오래된 순 정렬용 임시값.
--   (실제 운영 시 직원 정보 수정으로 정확한 입사일/연차 보정 가능)
INSERT OR IGNORE INTO staff (id, name, position, is_leader, hire_date, status, total_leave, used_leave, second_shift_count) VALUES
  (1, '김유리', '팀장', 1, '2018-03-02', 'active', 15, 0, 0),
  (2, '최윤희', '직원', 0, '2020-06-01', 'active', 15, 0, 0),
  (3, '최지혜', '직원', 0, '2021-09-13', 'active', 15, 0, 0),
  (4, '안이람', '직원', 0, '2023-04-10', 'active', 15, 0, 0),
  (5, '차혜진', '직원', 0, '2024-11-05', 'active', 15, 0, 0);
-- ============================================
-- 0010: 직원 운영 - 직원 스케줄 탭 최종 수정 (v2)
-- ============================================
-- 변경 요지(명세):
--   · 근태 상태 체계 정비: '2출' 최상위 제거 → 시간 인정 기타의 세부 사유 '2시 출근'으로 통합
--   · '기타' → '시간 인정 기타'(etc_type=time) / '무급 기타'(etc_type=unpaid) 로만 운영
--   · 미기록 세분화: 미기록 + 재고일(비정산) / 미기록 + 성과일(정산 반영) → record_mode 컬럼
--   · 직원 유형(일반/신입) staff_type 추가
--   · 데모/테스트 데이터 구분용 is_demo 플래그 추가 (운영 데이터와 분리 · 초기화 가능)
--   · 모든 데이터 연동은 employee_id(staff.id) 기준 (직원명 기준 연동 금지)
-- 기존 데이터는 보존한다(컬럼 추가 방식, 삭제 없음).

-- ── staff: 직원 유형 / 데모 구분 ──
ALTER TABLE staff ADD COLUMN staff_type TEXT DEFAULT 'regular';   -- regular(일반) | newbie(신입)
ALTER TABLE staff ADD COLUMN is_demo INTEGER DEFAULT 0;           -- 1=데모/테스트 직원

-- ── staff_attendance: 정산 메타 / 데모 구분 ──
--   record_mode: attendance='미기록'일 때만 의미
--     · 'stock'   = 재고일(비정산) → 직원 성과 정산 제외
--     · 'perf'    = 성과일(정산 반영) → 직원 성과 정산 반영
--   partial_start / partial_end: 팀장 부분 시간 정산용(상담/2출/조퇴/재고 구간 등)
--     · 명세 [14] 팀장 부분 시간 정산 규칙에서 사용하는 "정산 제외/반영 시간 구간"
--   is_demo: 1=데모/테스트 근태
ALTER TABLE staff_attendance ADD COLUMN record_mode TEXT;         -- 미기록 세부: stock | perf
ALTER TABLE staff_attendance ADD COLUMN partial_start TEXT;       -- 부분 정산 시작 HH:MM
ALTER TABLE staff_attendance ADD COLUMN partial_end TEXT;         -- 부분 정산 종료 HH:MM
ALTER TABLE staff_attendance ADD COLUMN is_demo INTEGER DEFAULT 0;

-- ── staff_day_status: 데모 구분 ──
ALTER TABLE staff_day_status ADD COLUMN is_demo INTEGER DEFAULT 0;

-- ── 기존 '2출' 근태를 '시간 인정 기타 + 2시 출근' 으로 정규화 (데이터 보존 변환) ──
--   화면 표시는 '2출' 라벨, 저장값은 기타(time)/etc_detail='2시 출근'
UPDATE staff_attendance
   SET attendance='기타', etc_type='time', etc_detail='2시 출근'
 WHERE attendance='2출';

-- ── 기존 단순 '기타'(etc_type 미지정)는 무급 기타로 간주 정규화 ──
UPDATE staff_attendance
   SET etc_type='unpaid'
 WHERE attendance='기타' AND (etc_type IS NULL OR etc_type='');

-- 기존 시드 5명은 일반 직원으로 표시 (신입 분류 아님)
UPDATE staff SET staff_type='regular' WHERE staff_type IS NULL;
-- 직원 개인 색상 (가운데 개인 근태 달력 표시용 UI 값)
--   · 휴무/연차 등 표시 시 테두리/연한 배경 색으로 사용한다.
--   · 직원성과/실근무시간/총 관리/평균 관리수/지정 환자 수/연차/원장님 PDF 계산에는 전혀 영향 없음.
--   · 코드 하드코딩이 아니라 직원 데이터의 UI 설정값으로 저장한다(직원 추가/설정에서 변경 가능).
ALTER TABLE staff ADD COLUMN personal_color TEXT;

-- 기존 직원 개인 색상 기본값 지정 (요청 11)
UPDATE staff SET personal_color = '#EFA7B7' WHERE name = '김유리' AND (personal_color IS NULL OR personal_color = '');
UPDATE staff SET personal_color = '#8FCFA9' WHERE name = '최윤희' AND (personal_color IS NULL OR personal_color = '');
UPDATE staff SET personal_color = '#E6C85C' WHERE name = '최지혜' AND (personal_color IS NULL OR personal_color = '');
UPDATE staff SET personal_color = '#8FB7E8' WHERE name = '안이람' AND (personal_color IS NULL OR personal_color = '');
UPDATE staff SET personal_color = '#B6A4E8' WHERE name = '차혜진' AND (personal_color IS NULL OR personal_color = '');
-- ============================================================
-- 0022: 상담일 총 피부관리 인원(팀 전체) 수동 입력 기록 테이블
-- ------------------------------------------------------------
-- 배경/요구사항(원장님):
--   상담일에도 일일재고 실사를 입력할 수 있게 열되(방식 A),
--   상담일은 정상근무일이 아니므로 직원별 개인 관리인원(managed_count) 자동 합산을
--   쓰지 않는다. 대신 일일재고 화면의 "총 피부관리 인원" 칸에서 직접 입력한 값을
--   날짜별로 저장한다.
--
--   [용도]
--     1. 상담일에도 총 피부관리 인원 입력 가능
--     2. 입력값은 날짜별 팀 전체 관리 인원 기록용
--     3. 직원 개인 성과/급여/근무시간 계산에는 반영하지 않음 (staff.ts 불변)
--     4. 재고 소모량 계산에도 반영하지 않음 (실사값 기준 계산 그대로)
--     5. 일일재고 화면 및 월별/원장님 보고서에서 팀 전체 관리 인원 참고값으로만 사용
--
--   [null vs 0]
--     · team_managed 는 NULL 허용. NULL=미입력. 0=실제 0명.
--     · 미입력(NULL)일 때는 0으로 저장하지 않는다.
--
--   [데이터 보존]
--     · 신규 테이블만 생성 → 기존 데이터 100% 보존.
--     · UNIQUE(work_date) → 날짜당 1행, 재저장 시 덮어쓰기.
-- ============================================================
CREATE TABLE IF NOT EXISTS consult_team_managed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_date TEXT NOT NULL,            -- 날짜 (YYYY-MM-DD)
  team_managed INTEGER,               -- 상담일 총 피부관리 인원(명, 팀 전체). NULL=미입력, 0=실제0.
  editor TEXT,                        -- 작성자
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(work_date)
);

CREATE INDEX IF NOT EXISTS idx_consult_team_managed_date ON consult_team_managed(work_date);

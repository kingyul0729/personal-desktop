# personal-desktop

Web desktop (React 18 + Vite, Cloudflare Worker in `worker/`). 앱 화면(`src/app/App.tsx`의 `AppShell`)은 macOS Finder 창 하나처럼 생겼다: 왼쪽 메뉴(회색 점 3개, 그룹 업무: 가격표·금액 계산·업무 자료 / 개인: 공부 보관함·메모장 / 설정: 환경설정, 선 아이콘, `SIDEBAR_GROUPS`), 오른쪽은 `FinderMain`(`components/FinderFrame.tsx`: ‹ › 제목 도구 막대, 내용, 경로 막대, 항목 수·크기 조절 상태 막대). 떠다니는 창·작업표시줄·바탕화면 아이콘은 쓰지 않는다. 한 번 연 화면은 숨겨 두기만 해서 메뉴를 오가도 입력이 남는다. 휴지통·파일은 환경설정에서 열고 제목 줄+닫기로 보인다. `Window`·`Taskbar`·`DesktopFinder`·작업 캡슐 코드는 남아 있지만 화면에 쓰지 않는다.

## Commands
- `npm test`: node test runner over `tests/*.test.mjs` (components are rendered with esbuild + `react-dom/server`)
- `npm run dev`: Vite dev server
- `npm run build`: worker + client build

## 공간 구분 (A / B / 공통)
- `src/app/programs.ts`의 `space`로 시작 메뉴를 나눈다. A 개인 공간: 공부 보관함, 메모장. B 다채움피부과 업무 공간: 업무 자료실, 가격표 보관함. 공통: 금액 계산, 작업 캡슐, 환경설정, 휴지통.
- 저장 위치를 섞지 않는다. 공부 기록 `/api/study`(study_records, R2 `study/`), 업무 매뉴얼·상담자료 `/api/work`(work_docs, R2 `work/`), 가격표 `/api/price-files`(price_folders, price_images). 각 화면의 검색은 자기 저장소만 찾는다.
- 화면 형식: 업무 자료실은 중앙 슬라이드(`WorkLibrary.tsx`), 공부 보관함은 겹친 카드(`StudyArchive.tsx`의 `StudyStack`), 가격표는 Finder형 폴더 → 썸네일(`FileExplorer.tsx`).
- 가격표는 이미지로 저장되어 있다. 프로그램명·구성·횟수·가격을 표 데이터로 만들려면 확정 가격 원본이 필요하므로 임의로 입력하지 않는다.
- 디자인 기준(2026-11-06 사용자 지정): 배경 #FAFAFA, 메뉴 #EFF0F2, 글자 #2D3136, 보조 #7D838B, 선 #E1E4E8, 포인트 #829BB2 하나. 메뉴 22%·내용 78%, 제목 20px, 위 30px·옆 40px 여백, 그림자·그라데이션·캐릭터 없음. 가격표는 Finder처럼 처음엔 카테고리 폴더 아이콘, 폴더를 열면 같은 크기 썸네일(얇은 테두리, 가운데 이름). ‹ › 는 가격표 안에서는 폴더 단위, 다른 화면은 지나온 메뉴 순서.
- 상담용 '프로그램 안내'(프로그램 브리핑·치료 원리·색소 치료 방법 그림/표)는 2026-11-07 사용자가 '상담에 도움이 안 되고 난잡하다'고 해서 통째로 삭제했다. 되살리려면 커밋 ed976fe 이전 기록을 본다. 비슷한 상담 그림 화면을 다시 만들기 전에 먼저 사용자와 형식을 정한다.
- 환경설정에는 글씨체·파일 설정·보안 설정 탭만 보인다(배경화면·바탕화면 탭은 앱 화면에 쓰이지 않아 숨김). 파일 설정 아래 '업로드 자료 모두 삭제'(`trash-uploads`)는 가격표 이미지 전부와 첨부가 있는 업무 자료·공부 기록을 휴지통으로 보낸다.
- 색상은 차분한 회색·청회색 계열이다. 분홍 계열 색은 hue만 청회색으로 바꾸고 밝기는 유지했다(오류 빨강은 그대로).
- 폴더 그림은 모두 같은 청회색(`ToneFolder`). 목적 구분은 이름 앞 작은 색 점(`ToneDot`, Finder 태그처럼)으로만 하고, 색은 `folderTone.ts`가 이름의 목적으로 정한다(사용자가 고른 muted 팔레트: 색소·홍조 더스티 블루, 여드름·흉터 세이지, 리프팅·스킨부스터 더스티 로즈, 기타·상담·기초 샌드, 그 밖 모브 그레이). 가격표와 공부 보관함 주제가 같은 규칙을 쓴다. 폴더 자체를 여러 색으로 칠하지 않는다(어수선해 보여서).
- 상태 아이콘(`components/Feedback.tsx`, 사용자가 고른 그림 기준): 불러오는 중은 회색 막대 12개 `Spinner`, 저장·이동·처리 중은 버튼 글자 앞 `SavingMark`(점 + 도는 호), 다운로드는 꽉 찬 화살표 `DownloadMark`(가리키면 한 번 내려옴). 움직임 줄이기 설정이면 멈춘다.
- 그 밖의 아이콘은 하나로 통일한다: 폴더 그림은 `.pink-folder-icon`의 청회색 폴더 하나, 종류는 오른쪽 아래 작은 선 아이콘(`EntryBadge`)으로 구분. 작업표시줄·시작 메뉴는 `programs.ts`의 선 아이콘을 쓴다.
- 깔끔하게(유아틱하지 않게): 기본 글씨체는 고딕(손글씨체는 환경설정에서 고를 때만), 하트·폴더 귀·번호(01·02) 장식과 반짝이는 그라데이션은 쓰지 않는다. 기본 배경은 회색(`public/wallpapers/plain-gray.svg`).
- 계약 등록, 환불 정산, 계약 내역 기능은 넣지 않는다.

## 금액 계산 (상담 계산기)
- UI: `src/app/components/PriceCalculator.tsx`. Pure logic: `priceGuide.ts`, `prepaid.ts`, `consultCalc.ts`, `calculatorInput.ts`.
- The calculation formulas in `priceGuide.ts` and `prepaid.ts` are confirmed by the clinic. Do not change them; report any difference first.
- Input in 만 원, settlement in whole won. 만 원 amounts show up to 2 decimals (prepaid keeps up to 4 so chart text stays exact); final payments are shown in won.
- 화면 모양(2026-11-07 v4): 왼쪽 입력(칸 이름 위·칸 아래, 넉넉한 간격, 선택은 글자 길이만한 알약 버튼), 오른쪽 영수증(`Receipt`: 줄마다 이름 ……… 금액, 점선 구분, 맨 아래 연파랑 합계 띠 + '만' 읽기). 포인트는 맑은 파랑 #2f6fd6 하나. 숫자는 15~24px로 고르게, 한 숫자만 거대하게 하지 않는다. '만' 읽기는 `koreanAmount.ts`의 `readWon`(1,028,500원 → 102만 8,500원). 가로로 꽉 찬 긴 탭은 쓰지 않는다. 스타일은 `os.css`의 '금액 계산 v4' 블록(앞 v3 블록 위에 덮어씀).
- 영수증은 간결하게(2026-11-07 '꼭 다 써야 하나'): 일반 = 정상가(N회) · 할인 → 결제하실 금액 → 1회당 · 부가세 포함(공급가) 한 줄. 선불권 = 시술비(정상가에서 N% 할인) → ① 기존 잔액에서 차감 / ② N만원권 결제 → 예약금 → 오늘 받을 금액 → 남은잔액 한 줄. 위아래 톱니 가장자리 종이 모양.
- 입력 방식: 터치 기기는 화면 숫자 패드(`NumberPad`, 시스템 키보드 안 뜸), 컴퓨터는 자판 + Enter(다음 칸)/Shift+Enter(이전 칸). '숫자 패드' 버튼으로 켜고 끄며 기기별로 기억한다. 내용 폭 560px 이상이면 입력 | 영수증 나란히(아이패드 가로 + 패드도), 더 좁으면 영수증이 위.
- Calculator state lives in `PriceCalculator`; the pane stays mounted when you switch menus, so input survives until the page reloads.

## dauril.com 배포 (브랜치 `dauril`, Cloudflare Workers `personal-desktop`)
- `cloudflare/worker.js`가 원래 앱(`worker/index.js`) 앞에서 직원 로그인을 처리하고 `oai-authenticated-user-*` 헤더를 서버에서 채운다. 브라우저가 보낸 `oai-*` 헤더는 버린다.
- D1은 동의서·환불정산 시스템(`dachaeum-consent`, consent.dauril.com)과 같은 DB를 쓴다. `users`·`kv`(session_secret) 공유 → 같은 계정, 쿠키 `dc_session`(Domain=dauril.com)으로 한 번 로그인.
- DB 표는 `drizzle/*.sql`을 `cloudflare/gen-migrations.mjs`가 `cloudflare/migrations.js`로 묶고, Worker가 처음 요청 때 `desktop_migrations`에 기록하며 1회씩 적용한다. 새 마이그레이션을 추가하면 `npm run build:cf`가 다시 묶는다.
- 파일 저장: R2(`BUCKET`)가 연결돼 있으면 R2, 없으면 D1 `desktop_blobs`에 900KB 조각으로 저장.
- 빌드 `npm run build:cf`, 배포 `npx wrangler deploy` (루트 `wrangler.toml`). 기존 `npm run build`(OpenAI 호스팅용)는 그대로 둔다.

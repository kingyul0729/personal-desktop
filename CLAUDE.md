# personal-desktop

Web desktop (React 18 + Vite, Cloudflare Worker in `worker/`). Programs open as windows from the desktop icons and the taskbar Start menu (`src/app/programs.ts`, `src/app/App.tsx`).

## Commands
- `npm test`: node test runner over `tests/*.test.mjs` (components are rendered with esbuild + `react-dom/server`)
- `npm run dev`: Vite dev server
- `npm run build`: worker + client build

## 공간 구분 (A / B / 공통)
- `src/app/programs.ts`의 `space`로 시작 메뉴를 나눈다. A 개인 공간: 공부 보관함, 메모장. B 다채움피부과 업무 공간: 업무 자료실, 가격표 보관함. 공통: 금액 계산, 작업 캡슐, 환경설정, 휴지통.
- 저장 위치를 섞지 않는다. 공부 기록 `/api/study`(study_records, R2 `study/`), 업무 매뉴얼·상담자료 `/api/work`(work_docs, R2 `work/`), 가격표 `/api/price-files`(price_folders, price_images). 각 화면의 검색은 자기 저장소만 찾는다.
- 화면 형식: 업무 자료실은 중앙 슬라이드(`WorkLibrary.tsx`), 공부 보관함은 겹친 카드(`StudyArchive.tsx`의 `StudyStack`), 가격표는 겹친 폴더 탭(`FileExplorer.tsx`).
- 가격표는 이미지로 저장되어 있다. 프로그램명·구성·횟수·가격을 표 데이터로 만들려면 확정 가격 원본이 필요하므로 임의로 입력하지 않는다.
- 바탕화면은 파일 탐색기형(`DesktopFinder.tsx`): 왼쪽 공간 메뉴(전체·A·B·공통·바탕화면 파일), 오른쪽 항목 그리드. 항목의 열기·이름 변경·메뉴는 `DesktopIcon`이 그대로 맡는다.
- 색상은 차분한 회색·청회색 계열이다. 분홍 계열 색은 hue만 청회색으로 바꾸고 밝기는 유지했다(오류 빨강은 그대로).
- 아이콘은 하나로 통일한다: 폴더 그림은 `.pink-folder-icon`의 청회색 폴더 하나, 종류는 오른쪽 아래 작은 선 아이콘(`EntryBadge`)으로 구분. 작업표시줄·시작 메뉴는 `programs.ts`의 선 아이콘을 쓴다.
- 바탕화면 탐색기는 화면 전체를 채운다.
- 계약 등록, 환불 정산, 계약 내역 기능은 넣지 않는다.

## 금액 계산 (상담 계산기)
- UI: `src/app/components/PriceCalculator.tsx`. Pure logic: `priceGuide.ts`, `prepaid.ts`, `consultCalc.ts`, `calculatorInput.ts`.
- The calculation formulas in `priceGuide.ts` and `prepaid.ts` are confirmed by the clinic. Do not change them; report any difference first.
- Input in 만 원, settlement in whole won. 만 원 amounts show up to 2 decimals (prepaid keeps up to 4 so chart text stays exact); final payments are shown in won.
- Calculator state lives in `PriceCalculator`; minimizing only hides the window, so input survives until the window is closed.

## dauril.com 배포 (브랜치 `dauril`, Cloudflare Workers `personal-desktop`)
- `cloudflare/worker.js`가 원래 앱(`worker/index.js`) 앞에서 직원 로그인을 처리하고 `oai-authenticated-user-*` 헤더를 서버에서 채운다. 브라우저가 보낸 `oai-*` 헤더는 버린다.
- D1은 동의서·환불정산 시스템(`dachaeum-consent`, consent.dauril.com)과 같은 DB를 쓴다. `users`·`kv`(session_secret) 공유 → 같은 계정, 쿠키 `dc_session`(Domain=dauril.com)으로 한 번 로그인.
- DB 표는 `drizzle/*.sql`을 `cloudflare/gen-migrations.mjs`가 `cloudflare/migrations.js`로 묶고, Worker가 처음 요청 때 `desktop_migrations`에 기록하며 1회씩 적용한다. 새 마이그레이션을 추가하면 `npm run build:cf`가 다시 묶는다.
- 파일 저장: R2(`BUCKET`)가 연결돼 있으면 R2, 없으면 D1 `desktop_blobs`에 900KB 조각으로 저장.
- 빌드 `npm run build:cf`, 배포 `npx wrangler deploy` (루트 `wrangler.toml`). 기존 `npm run build`(OpenAI 호스팅용)는 그대로 둔다.

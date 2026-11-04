# personal-desktop

Pink web desktop (React 18 + Vite, Cloudflare Worker in `worker/`). Programs open as windows from the desktop icons and the taskbar Start menu (`src/app/programs.ts`, `src/app/App.tsx`).

## Commands
- `npm test`: node test runner over `tests/*.test.mjs` (components are rendered with esbuild + `react-dom/server`)
- `npm run dev`: Vite dev server
- `npm run build`: worker + client build

## 공간 구분 (A / B / 공통)
- `src/app/programs.ts`의 `space`로 시작 메뉴를 나눈다. A 개인 공간: 공부 보관함, 메모장. B 다채움피부과 업무 공간: 업무 자료실, 가격표 보관함. 공통: 금액 계산, 작업 캡슐, 환경설정, 휴지통.
- 저장 위치를 섞지 않는다. 공부 기록 `/api/study`(study_records, R2 `study/`), 업무 매뉴얼·상담자료 `/api/work`(work_docs, R2 `work/`), 가격표 `/api/price-files`(price_folders, price_images). 각 화면의 검색은 자기 저장소만 찾는다.
- 화면 형식: 업무 자료실은 중앙 슬라이드(`WorkLibrary.tsx`), 공부 보관함은 겹친 카드(`StudyArchive.tsx`의 `StudyStack`), 가격표는 겹친 폴더 탭(`FileExplorer.tsx`).
- 가격표는 이미지로 저장되어 있다. 프로그램명·구성·횟수·가격을 표 데이터로 만들려면 확정 가격 원본이 필요하므로 임의로 입력하지 않는다.
- 계약 등록, 환불 정산, 계약 내역 기능은 넣지 않는다.

## 금액 계산 (상담 계산기)
- UI: `src/app/components/PriceCalculator.tsx`. Pure logic: `priceGuide.ts`, `prepaid.ts`, `consultCalc.ts`, `calculatorInput.ts`.
- The calculation formulas in `priceGuide.ts` and `prepaid.ts` are confirmed by the clinic. Do not change them; report any difference first.
- Input in 만 원, settlement in whole won. 만 원 amounts show up to 2 decimals (prepaid keeps up to 4 so chart text stays exact); final payments are shown in won.
- Calculator state lives in `PriceCalculator`; minimizing only hides the window, so input survives until the window is closed.

# personal-desktop

Pink web desktop (React 18 + Vite, Cloudflare Worker in `worker/`). Programs open as windows from the desktop icons and the taskbar Start menu (`src/app/programs.ts`, `src/app/App.tsx`).

## Commands
- `npm test`: node test runner over `tests/*.test.mjs` (components are rendered with esbuild + `react-dom/server`)
- `npm run dev`: Vite dev server
- `npm run build`: worker + client build

## 금액 계산 (상담 계산기)
- UI: `src/app/components/PriceCalculator.tsx`. Pure logic: `priceGuide.ts`, `prepaid.ts`, `consultCalc.ts`, `calculatorInput.ts`.
- The calculation formulas in `priceGuide.ts` and `prepaid.ts` are confirmed by the clinic. Do not change them; report any difference first.
- Input in 만 원, settlement in whole won. 만 원 amounts show up to 2 decimals (prepaid keeps up to 4 so chart text stays exact); final payments are shown in won.
- Calculator state lives in `PriceCalculator`; minimizing only hides the window, so input survives until the window is closed.

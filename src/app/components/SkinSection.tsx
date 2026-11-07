// 의학 교과서식 피부 단면 그림(직접 그린 SVG, 외부 이미지 없음).
// 각질층 → 표피 세포층(각질형성세포) → 기저층(기저세포·멜라닌세포) → 진피유두(모세혈관 고리) → 망상진피(콜라겐 다발·혈관·모낭·피지샘) → 피하지방.
// 색소 위치는 일반적으로 확립된 내용만: 주근깨·흑자 = 기저층 멜라닌 증가, 기미 = 표피 멜라닌 + 진피 위쪽 멜라닌 포식세포,
// ABNOM = 진피 속 멜라닌세포, 점(모반) = 경계부·진피의 모반세포 둥지.
import { useId } from 'react';

export type SkinFocus = 'top' | 'mid' | 'deep' | 'texture' | 'mole';

const W = 400;
const SURFACE = 44;
const surfaceY = (x: number, mole: boolean) => SURFACE + 1.2 * Math.sin(x / 17) - (mole ? Math.max(0, 9 - Math.abs(x - 200) / 3.2) : 0);
const junctionY = (x: number) => 102 + 10 * Math.sin((x - 10) / 13);
const papBottom = (x: number) => PAPILLARY + 3 * Math.sin(x / 30);
const PAPILLARY = 150;
const SUBCUTIS = 248;
const H = 286;

// 같은 그림이 매번 같게 나오도록 고정된 난수
function rng(seed: number) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

const curve = (fn: (x: number) => number, from = 0, to = W, step = 4) => {
  let d = `M${from} ${fn(from).toFixed(1)}`;
  for (let x = from + step; x <= to; x += step) d += ` L${x} ${fn(x).toFixed(1)}`;
  return d;
};

// 오른쪽 → 왼쪽으로 이어 그리기(면을 닫을 때)
const back = (fn: (x: number) => number, step = 4) => { let d = ''; for (let x = W; x >= 0; x -= step) d += ` L${x} ${fn(x).toFixed(1)}`; return d; };

export function SkinSection({ focus, label }: { focus: SkinFocus; label: string }) {
  const id = useId().replace(/:/g, '');
  const r = rng(7);
  const mole = focus === 'mole';
  const s = (x: number) => surfaceY(x, mole);

  // 표피 세포: 위로 갈수록 납작하고 옅다
  const cells: { x: number; y: number; rx: number; ry: number; tone: number }[] = [];
  for (let y = SURFACE + 13; y < 130; y += 8.5) {
    const row = Math.round((y - SURFACE) / 8.5);
    for (let x = (row % 2) * 6; x < W + 6; x += 12) {
      const jx = x + (r() - .5) * 3;
      if (y > junctionY(jx) - 10 || y < s(jx) + 10) continue;
      const depth = (y - SURFACE) / (junctionY(jx) - SURFACE);
      cells.push({ x: jx, y: y + (r() - .5) * 2, rx: 5.6, ry: 2.4 + depth * 1.8, tone: depth });
    }
  }
  // 기저층 세포: 경계선을 따라 한 줄
  const basal: { x: number; y: number; a: number }[] = [];
  for (let x = 3; x < W; x += 7) {
    const y = junctionY(x) - 4.2;
    const a = Math.atan2(junctionY(x + 1) - junctionY(x - 1), 2) * 180 / Math.PI;
    basal.push({ x, y, a });
  }
  // 콜라겐 다발
  const fibers: string[] = [];
  for (let i = 0; i < 46; i++) {
    const y = PAPILLARY + 8 + r() * (SUBCUTIS - PAPILLARY - 16);
    const x = r() * W - 30; const len = 40 + r() * 60; const amp = 2 + r() * 3;
    fibers.push(`M${x.toFixed(0)} ${y.toFixed(0)} q${(len / 4).toFixed(0)} ${-amp.toFixed(1)} ${(len / 2).toFixed(0)} 0 t${(len / 2).toFixed(0)} 0`);
  }
  // 진피유두 꼭대기(경계선이 가장 높은 곳)마다 모세혈관 고리
  const papillae: number[] = [];
  for (let x = 10; x < W; x += 2) if (junctionY(x) < junctionY(x - 2) && junctionY(x) <= junctionY(x + 2)) papillae.push(x);
  // 피하지방 세포
  const fat: { x: number; y: number; r: number }[] = [];
  for (let y = SUBCUTIS + 12; y < H + 10; y += 17) for (let x = ((y / 17) % 2) * 9; x < W + 10; x += 19) fat.push({ x: x + (r() - .5) * 4, y: y + (r() - .5) * 3, r: 9 + r() * 2 });

  const inZone = (x: number, a: number, b: number) => x > a && x < b;
  const beam = { top: { x: 200, to: junctionY(200) - 2, w: 30 }, mid: { x: 200, to: PAPILLARY - 14, w: 70 }, deep: { x: 200, to: 178, w: 22 }, texture: null, mole: { x: 200, to: s(200) + 12, w: 34 } }[focus];

  return <svg viewBox={`0 0 ${W} ${H}`} className="skin-section" role="img" aria-label={label}>
    <defs>
      <clipPath id={`${id}c`}><rect x="0" y="0" width={W} height={H} rx="12" /></clipPath>
    </defs>
    <g clipPath={`url(#${id}c)`}>
      <rect x="0" y="0" width={W} height={H} fill="#fbfbfc" />
      {/* 피하지방 */}
      <rect x="0" y={SUBCUTIS} width={W} height={H - SUBCUTIS} fill="#f5e7c6" />
      {fat.map((f, i) => <circle key={i} cx={f.x} cy={f.y} r={f.r} fill="#f9eed3" stroke="#e3cb93" strokeWidth=".8" />)}
      {/* 망상진피 */}
      <path d={`${curve(papBottom)} L${W} ${SUBCUTIS} L0 ${SUBCUTIS} Z`} fill="#f1d3cb" />
      {fibers.map((d, i) => <path key={i} d={d} fill="none" stroke="#dcaea2" strokeWidth="2.2" strokeLinecap="round" opacity=".55" />)}
      {/* 진피유두층 */}
      <path d={`${curve(junctionY)} ${back(papBottom)} Z`} fill="#f7e2dc" />
      {papillae.map(x => <path key={x} d={`M${x - 4} ${papBottom(x) - 8} C${x - 5} ${junctionY(x) + 5} ${x + 5} ${junctionY(x) + 5} ${x + 4} ${papBottom(x) - 8}`} fill="none" stroke="#c9605a" strokeWidth="1.3" opacity=".7" />)}
      {/* 혈관 */}
      <path d={curve(x => 214 + 4 * Math.sin(x / 40))} fill="none" stroke="#b94b47" strokeWidth="7" strokeLinecap="round" opacity=".8" />
      <path d={curve(x => 228 + 4 * Math.sin(x / 40 + 1))} fill="none" stroke="#6475a8" strokeWidth="8" strokeLinecap="round" opacity=".75" />
      <path d={curve(x => papBottom(x) - 8)} fill="none" stroke="#c9605a" strokeWidth="1.1" opacity=".45" />
      {/* 모낭 + 피지샘 */}
      <g transform="translate(352 0)">
        <path d={`M-9 ${s(352)} C-10 120 -12 190 -13 236 Q0 250 13 236 C12 190 10 120 9 ${s(352)} Z`} fill="#efcdb9" stroke="#d6a88d" strokeWidth="1" />
        <path d={`M-2 ${s(352) - 30} L-2 238`} stroke="#4b3b33" strokeWidth="3.4" strokeLinecap="round" />
        <ellipse cx="-22" cy="150" rx="11" ry="15" fill="#f4e2a8" stroke="#d9bd6d" strokeWidth="1" />
        <ellipse cx="-31" cy="164" rx="8" ry="11" fill="#f4e2a8" stroke="#d9bd6d" strokeWidth="1" />
      </g>
      {/* 표피 */}
      <path d={`${curve(s)} ${back(junctionY)} Z`} fill="#f4dccd" />
      {cells.map((c, i) => <g key={i}>
        <ellipse cx={c.x} cy={c.y} rx={c.rx} ry={c.ry} fill={c.tone < .3 ? '#f6e5d9' : '#f0d2bf'} stroke="#e1b9a2" strokeWidth=".6" />
        {c.tone > .25 && <circle cx={c.x} cy={c.y} r={.9 + c.tone * .5} fill="#b9867a" opacity=".7" />}
      </g>)}
      {basal.map((b, i) => <g key={i} transform={`translate(${b.x} ${b.y}) rotate(${b.a})`}>
        <ellipse rx="3.2" ry="4.6" fill="#ebc2ab" stroke="#d6a28a" strokeWidth=".6" />
        <circle r="1.5" fill="#9c6b5e" />
      </g>)}
      {/* 각질층 */}
      <path d={curve(s)} fill="none" stroke="#e8cdbf" strokeWidth="7" />
      {[0, 2.6, 5.2].map(o => <path key={o} d={curve(x => s(x) - 2.6 + o)} fill="none" stroke="#dcb8a6" strokeWidth=".7" />)}
      {/* 멜라닌세포(정상): 기저층에 띄엄띄엄 */}
      {[46, 118, 268, 326].map(x => <g key={x} transform={`translate(${x} ${junctionY(x) - 5})`}>
        <path d="M0 0 l-7 -9 M0 0 l6 -10 M0 0 l11 -4 M0 0 l-11 -2" stroke="#7a5446" strokeWidth="1" strokeLinecap="round" />
        <circle r="3" fill="#7a5446" />
      </g>)}

      {/* 색소: 주근깨·흑자 = 기저층 멜라닌이 늘어난 자리 */}
      {focus === 'top' && <g>
        {basal.filter(b => inZone(b.x, 140, 262)).map((b, i) => <ellipse key={i} cx={b.x} cy={b.y - 3} rx="3.4" ry="2.3" fill="#6b4434" opacity=".85" />)}
        {cells.filter(c => inZone(c.x, 140, 262) && c.tone > .55).map((c, i) => <circle key={i} cx={c.x + 2} cy={c.y - 1} r="1.4" fill="#7b5040" opacity=".7" />)}
      </g>}
      {/* 기미 = 표피 전체에 퍼진 멜라닌 + 진피 위쪽 멜라닌 포식세포 */}
      {focus === 'mid' && <g>
        {basal.filter(b => inZone(b.x, 60, 340)).map((b, i) => <ellipse key={i} cx={b.x} cy={b.y - 3} rx="3" ry="2" fill="#7b5040" opacity=".6" />)}
        {cells.filter(c => inZone(c.x, 60, 340) && c.tone > .3).map((c, i) => <circle key={i} cx={c.x + 2} cy={c.y - 1} r="1.2" fill="#8a5c47" opacity=".55" />)}
        {[92, 140, 178, 226, 262, 300].map((x, i) => <g key={x} transform={`translate(${x} ${junctionY(x) + 14 + (i % 2) * 8})`}>
          <ellipse rx="6" ry="4" fill="#9a6a55" opacity=".75" /><circle cx="1.5" cy="-.5" r="1.6" fill="#5b3b2f" /><circle cx="-2.5" cy="1" r="1.2" fill="#5b3b2f" />
        </g>)}
      </g>}
      {/* ABNOM = 진피 속(중간층)에 흩어진 멜라닌세포. 위에서 보면 푸르스름한 회갈색 */}
      {focus === 'deep' && <g>
        {[[150, 166, 18], [176, 182, -12], [198, 160, 10], [222, 178, -20], [244, 164, 14], [168, 196, 8], [212, 196, -6]].map(([x, y, a]) => <g key={`${x}-${y}`} transform={`translate(${x} ${y}) rotate(${a})`}>
          <path d="M-12 0 Q0 -4 12 0 Q0 4 -12 0 Z" fill="#5f5a73" opacity=".85" /><path d="M-12 0 l-6 -2 M12 0 l6 2" stroke="#5f5a73" strokeWidth=".9" />
        </g>)}
      </g>}
      {/* 점(모반) = 표피-진피 경계와 진피의 모반세포 둥지 */}
      {focus === 'mole' && <g>
        {Array.from({ length: 34 }, (_, i) => { const a = i * 2.4; const d = 3 + (i % 9) * 3.1; return <circle key={i} cx={200 + Math.cos(a) * d * 1.5} cy={junctionY(200) + 10 + Math.sin(a) * d * .9} r="3.4" fill="#8a5a46" stroke="#6b4434" strokeWidth=".6" />; })}
        {[176, 190, 210, 224].map(x => <ellipse key={x} cx={x} cy={junctionY(x) - 6} rx="5" ry="3.4" fill="#7b4e3d" />)}
      </g>}
      {/* 스타룩스 1540 = 표면은 두고 피부 속에 아주 가는 열 기둥(미세 치료 구역) */}
      {focus === 'texture' && <g>
        {[110, 160, 210, 260].map(x => <g key={x}>
          <path d={`M${x - 3} ${s(x) + 6} Q${x - 6} 140 ${x} 182 Q${x + 6} 140 ${x + 3} ${s(x) + 6} Z`} fill="#2f6fd6" opacity=".2" />
          <path d={`M${x} ${s(x) + 6} V176`} stroke="#2f6fd6" strokeWidth="1.2" opacity=".6" />
        </g>)}
        {[110, 160, 210, 260].map(x => <path key={x} d={`M${x} 6 V${s(x) - 4}`} stroke="#2f6fd6" strokeWidth="1.4" strokeDasharray="2 3" opacity=".7" />)}
      </g>}
      {/* 레이저 빛: 겨냥한 깊이까지 */}
      {beam && <g>
        <path d={`M${beam.x - beam.w / 2} 0 H${beam.x + beam.w / 2} L${beam.x + beam.w * .32} ${beam.to} H${beam.x - beam.w * .32} Z`} fill="#2f6fd6" opacity=".14" />
        <path d={`M${beam.x} 0 V${beam.to}`} stroke="#2f6fd6" strokeWidth="1.2" strokeDasharray="3 3" opacity=".65" />
        <ellipse cx={beam.x} cy={beam.to} rx={beam.w * .42} ry="4" fill="none" stroke="#2f6fd6" strokeWidth="1.4" opacity=".8" />
      </g>}
      {/* 층 이름 */}
      <g className="skin-layer-tags">
        <text x="8" y={SURFACE + 34}>표피</text>
        <text x="8" y={PAPILLARY + 40}>진피</text>
        <text x="8" y={SUBCUTIS + 26}>피하지방</text>
      </g>
    </g>
  </svg>;
}

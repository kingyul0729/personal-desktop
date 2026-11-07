// 피부 단면 그림(직접 그린 SVG, 외부 이미지 없음). 2026-11-07 사용자가 보낸 참고 그림 스타일:
// 입체 블록(윗면 + 앞 단면 + 오른쪽 옆면), 크게 확대한 세포, 부드러운 파스텔 층 구분
// — 각질층(분홍 얇은 판) · 표피 세포(노랑, 둥근 사각 세포 + 핵) · 기저층(연보라 세포 + 보라 기저막) · 진피(살구색, 물결 콜라겐 + 가는 혈관) · 피하지방(노란 띠).
// 멜라닌세포는 기저층 사이의 가지 달린 갈색 세포. 색소 위치는 일반적으로 확립된 내용만:
// 주근깨·흑자 = 기저층 멜라닌 증가, 기미 = 표피 멜라닌 + 진피 위쪽 멜라닌 포식세포, ABNOM = 진피 속 멜라닌세포, 점 = 경계부·진피의 모반세포 둥지.
import { useId } from 'react';

export type SkinFocus = 'top' | 'mid' | 'deep' | 'texture' | 'mole';

const FW = 352;            // 앞면 너비
const DX = 36, DY = 28;    // 윗면·옆면 깊이(오른쪽 위로)
const TOP = 40;            // 앞면 맨 위(피부 표면)
const SC = 16;             // 각질층 두께
const ROW = 27;            // 표피 세포 한 줄 높이
const SP1 = TOP + SC, SP2 = SP1 + ROW, BAS = SP2 + ROW, BM = BAS + ROW + 1; // 표피 세포 2줄 + 기저층 1줄, BM = 기저막
const FAT = 262, BOTTOM = 276;
const VB_TOP = -34;

function rng(seed: number) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

// 가로로 한 줄 세포(너비 조금씩 다르게)
function rowCells(y: number, h: number, rand: () => number, offset: number) {
  const cells: { x: number; w: number; y: number; h: number }[] = [];
  let x = -offset;
  while (x < FW) { const w = 36 + rand() * 9; cells.push({ x, w, y, h }); x += w; }
  return cells;
}
const cellPath = (c: { x: number; w: number; y: number; h: number }, inset = 1.4, round = 9) => {
  const x = Math.max(c.x + inset, inset), r = Math.min(c.x + c.w - inset, FW - inset);
  const w = r - x; if (w < 6) return '';
  return `M${x + round} ${c.y + inset} H${r - round} Q${r} ${c.y + inset} ${r} ${c.y + inset + round} V${c.y + c.h - inset - round} Q${r} ${c.y + c.h - inset} ${r - round} ${c.y + c.h - inset} H${x + round} Q${x} ${c.y + c.h - inset} ${x} ${c.y + c.h - inset - round} V${c.y + inset + round} Q${x} ${c.y + inset} ${x + round} ${c.y + inset} Z`;
};
const centerOf = (c: { x: number; w: number; y: number; h: number }) => ({ cx: (Math.max(c.x, 0) + Math.min(c.x + c.w, FW)) / 2, cy: c.y + c.h / 2 });

// 가지 달린 멜라닌세포(참고 그림처럼 아래가 넓게 붙고 위로 가지가 갈라짐)
function Melanocyte({ x, base, color = '#9c6235', dark = '#5e3418', scale = 1 }: { x: number; base: number; color?: string; dark?: string; scale?: number }) {
  return <g transform={`translate(${x} ${base}) scale(${scale})`}>
    <path d="M-22 0 C-13 -2 -10 -7 -10 -14 C-14 -20 -22 -28 -30 -32 C-21 -30 -14 -25 -9 -21 C-10 -30 -8 -38 -3 -47 C-3 -37 -4 -29 -3 -23 C1 -30 7 -36 14 -40 C9 -33 5 -27 4 -22 C10 -26 18 -28 28 -27 C19 -24 12 -20 9 -14 C9 -7 13 -2 22 0 Z" fill={color} stroke={dark} strokeWidth=".7" strokeOpacity=".5" />
    <path d="M-6 -12 C-3 -19 3 -19 5 -12" fill="none" stroke="#fff" strokeOpacity=".25" strokeWidth="1.2" />
    <ellipse cx="0" cy="-8" rx="4.6" ry="4.2" fill={dark} />
    <ellipse cx="-1.2" cy="-9.4" rx="1.4" ry="1.1" fill="#fff" opacity=".3" />
  </g>;
}

// 진피 속 가지 달린 색소세포(ABNOM): 길쭉한 몸 + 양끝 가지
function DermalMelanocyte({ x, y, a, s }: { x: number; y: number; a: number; s: number }) {
  return <g transform={`translate(${x} ${y}) rotate(${a}) scale(${s})`}>
    <path d="M-17 1 C-12 -1 -9 -4 -6 -4 C-2 -6 4 -5 7 -3 C10 -2 13 -3 18 -6 C14 -2 12 0 11 1 C14 2 16 4 19 7 C13 5 10 3 7 3 C3 5 -3 6 -7 3 C-10 2 -13 3 -18 6 C-15 3 -15 2 -17 1 Z" fill="#7a6a80" stroke="#4f4258" strokeWidth=".5" strokeOpacity=".5" />
    <ellipse cx="0" cy="0" rx="3.4" ry="2.6" fill="#4a3d55" />
  </g>;
}

// 레이저 손잡이 끝(금속 몸체 + 빛 나오는 창)
function Handpiece({ id, x, w }: { id: string; x: number; w: number }) {
  return <g>
    <rect x={x - w / 2} y={VB_TOP - 6} width={w} height="22" rx="5" fill={`url(#${id}h)`} />
    <rect x={x - w / 2 + 3} y={VB_TOP + 13} width={w - 6} height="6" rx="2" fill="#3c4249" />
    <rect x={x - w / 2 + 6} y={VB_TOP + 16.5} width={w - 12} height="3" rx="1.5" fill="#cfe1ff" />
    <rect x={x - w / 2 + 6} y={VB_TOP + 16.5} width={w - 12} height="3" rx="1.5" fill="#fff" opacity=".8" filter={`url(#${id}b1)`} />
  </g>;
}

export function SkinSection({ focus, label }: { focus: SkinFocus; label: string }) {
  const id = useId().replace(/:/g, '');
  const u = (k: string) => `url(#${id}${k})`;
  const r = rng(5);
  const spin1 = rowCells(SP1, ROW, r, 8);
  const spin2 = rowCells(SP2, ROW, r, 24);
  const basal = rowCells(BAS, ROW, r, 14);
  const melanoX = [92, 248];
  const inZone = (x: number, a: number, b: number) => x > a && x < b;

  // 진피: 물결 콜라겐 결
  const waves = Array.from({ length: 13 }, (_, i) => {
    const y = BM + 12 + i * 8 + r() * 3; let d = `M-4 ${y.toFixed(1)}`; const amp = 2 + r() * 2.5, len = 46 + r() * 20, ph = r() * 6;
    for (let x = 0; x <= FW + 8; x += 8) d += ` L${x} ${(y + amp * Math.sin(x / len * Math.PI * 2 + ph)).toFixed(1)}`;
    return { d, o: .25 + r() * .25 };
  });
  // 진피: 가는 혈관(가지가 갈라지는 붉은·푸른 실선)
  const vessel = (x0: number, y0: number, dir: number, len: number, color: string, depth: number): string[] => {
    const out: string[] = []; let x = x0, y = y0;
    let d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
    const steps = 4;
    for (let k = 0; k < steps; k++) {
      const nx = x + dir * len / steps, ny = y + (r() - .5) * 5;
      d += ` Q${((x + nx) / 2).toFixed(1)} ${(ny + (r() - .5) * 4).toFixed(1)} ${nx.toFixed(1)} ${ny.toFixed(1)}`;
      if (depth > 0 && k === 2) out.push(...vessel(nx, ny, dir * (r() > .5 ? 1 : -1), len * .4, color, depth - 1).map(p => p));
      if (k === 1 || k === 3) out.push(`M${nx.toFixed(1)} ${ny.toFixed(1)} q${(dir * 5).toFixed(1)} -4 ${(dir * (10 + r() * 6)).toFixed(1)} ${(-(8 + r() * 6)).toFixed(1)}`);
      x = nx; y = ny;
    }
    return [d, ...out];
  };
  const vessels = [
    { paths: vessel(24, BM + 30, 1, 110, 'r', 1), c: '#e2707a' }, { paths: vessel(150, BM + 38, -1, 100, 'b', 0), c: '#8a86d0' },
    { paths: vessel(214, BM + 32, 1, 110, 'r', 1), c: '#e2707a' }, { paths: vessel(336, BM + 40, -1, 90, 'b', 0), c: '#8a86d0' },
    { paths: vessel(-4, FAT - 12, 1, 200, 'b', 1), c: '#8a86d0' }, { paths: vessel(40, FAT - 24, 1, 130, 'r', 1), c: '#e2707a' },
    { paths: vessel(356, FAT - 14, -1, 150, 'r', 1), c: '#e2707a' },
  ];

  const beam = { top: { x: 176, to: BAS + ROW / 2 - 2, w: 30 }, mid: { x: 176, to: BM + 12, w: 66 }, deep: { x: 176, to: 206, w: 22 }, texture: null, mole: { x: 176, to: SP1 + 6, w: 36 } }[focus];

  // 옆면(오른쪽): 앞면과 같은 층을 비스듬히
  const side = (y: number) => `M${FW} ${y} L${FW + DX} ${y - DY}`;
  const sideBand = (y1: number, y2: number, fill: string) => <path d={`M${FW} ${y1} L${FW + DX} ${y1 - DY} L${FW + DX} ${y2 - DY} L${FW} ${y2} Z`} fill={fill} />;

  return <svg viewBox={`0 ${VB_TOP} ${FW + DX + 6} ${BOTTOM - VB_TOP + 4}`} className="skin-section" role="img" aria-label={label}>
    <defs>
      {/* 손으로 칠한 듯 아주 약한 일렁임 */}
      <filter id={`${id}w`} x="-2%" y="-2%" width="104%" height="104%">
        <feTurbulence type="fractalNoise" baseFrequency=".04" numOctaves="2" seed="4" result="t" />
        <feDisplacementMap in="SourceGraphic" in2="t" scale="2.2" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id={`${id}t`} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="2" seed="9" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 .55  0 0 0 0 .35  0 0 0 0 .3  0 0 0 .07 0" />
      </filter>
      <filter id={`${id}b1`} x="-50%" y="-20%" width="200%" height="140%"><feGaussianBlur stdDeviation="1.4" /></filter>
      <filter id={`${id}b2`} x="-80%" y="-20%" width="260%" height="140%"><feGaussianBlur stdDeviation="4.5" /></filter>
      <filter id={`${id}b3`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6" /></filter>
      <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" /><stop offset=".5" stopColor="#fff" stopOpacity=".8" /><stop offset="1" stopColor="#fff" stopOpacity=".25" /></linearGradient>
      <mask id={`${id}m`}><rect x="-10" y={VB_TOP} width={FW + 60} height={BOTTOM - VB_TOP} fill={u('f')} /></mask>
      <linearGradient id={`${id}h`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#4a5058" /><stop offset=".35" stopColor="#9aa2ab" /><stop offset=".55" stopColor="#d9dde2" /><stop offset="1" stopColor="#555c64" /></linearGradient>
      <linearGradient id={`${id}top`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fbd6c6" /><stop offset="1" stopColor="#f8c8b5" /></linearGradient>
      <clipPath id={`${id}front`}><rect x="0" y={TOP} width={FW} height={BOTTOM - TOP} /></clipPath>
    </defs>

    <g filter={u('w')}>
      {/* 윗면(피부 표면) */}
      <path d={`M0 ${TOP} Q2 ${TOP - 4} ${8} ${TOP - 7} L${DX} ${TOP - DY} L${FW + DX - 4} ${TOP - DY} Q${FW + DX + 2} ${TOP - DY + 1} ${FW + DX} ${TOP - DY + 5} L${FW} ${TOP} Z`} fill={u('top')} stroke="#e8a48f" strokeWidth=".8" />

      {/* 오른쪽 옆면 */}
      {sideBand(TOP, SP1, '#f2b3aa')}
      {sideBand(SP1, BAS, '#f8dca8')}
      {sideBand(BAS, BM, '#ecd2e4')}
      {sideBand(BM, FAT, '#f3bfa9')}
      {sideBand(FAT, BOTTOM, '#f3d98c')}
      {[SP1 + ROW / 2, SP2 + ROW / 2, BAS + ROW / 2].map((y, i) => <g key={y}>
        {[0, 1, 2].map(k => { const t = (k + .5) / 3; return <ellipse key={k} cx={FW + DX * t} cy={y - DY * t} rx="2.3" ry="4.2" fill={i === 2 ? '#c4a3d8' : '#f2b493'} opacity=".8" transform={`rotate(-38 ${FW + DX * t} ${y - DY * t})`} />; })}
      </g>)}
      {[SP1, SP2, BAS, BM, FAT].map(y => <path key={y} d={side(y)} stroke={y === BM ? '#9c7fd0' : '#e7b98a'} strokeWidth={y === BM ? 1.4 : .8} />)}
      <path d={`M${FW + DX} ${TOP - DY + 4} V${BOTTOM - DY} L${FW} ${BOTTOM}`} fill="none" stroke="#e1a28c" strokeWidth=".8" />

      {/* 앞 단면 */}
      <g clipPath={u('front')}>
        {/* 진피 */}
        <rect x="0" y={BM} width={FW} height={FAT - BM} fill="#f9cbb6" />
        {waves.map((w, i) => <path key={i} d={w.d} fill="none" stroke="#ec9f8c" strokeWidth="1.1" opacity={w.o} />)}
        {vessels.map((v, i) => v.paths.map((d, k) => <path key={`${i}-${k}`} d={d} fill="none" stroke={v.c} strokeWidth={k === 0 ? 1.6 : 1} strokeLinecap="round" opacity=".85" />))}
        {/* 피하지방 */}
        <rect x="0" y={FAT} width={FW} height={BOTTOM - FAT} fill="#f6dc8e" />
        {Array.from({ length: 12 }, (_, i) => <path key={i} d={`M${i * 30 + 2} ${FAT + 2} h26 q3 0 3 3 v6 q0 3 -3 3 h-26 q-3 0 -3 -3 v-6 q0 -3 3 -3 Z`} fill="#f9e6a8" stroke="#e8c461" strokeWidth=".7" />)}
        {/* 각질층 */}
        <rect x="0" y={TOP} width={FW} height={SC} fill="#f3b2a8" />
        {[3.5, 7, 10.5, 13.5].map(o => <path key={o} d={`M0 ${TOP + o} ${Array.from({ length: 23 }, (_, k) => `L${k * 16} ${(TOP + o + 1.1 * Math.sin(k * 1.3 + o)).toFixed(1)}`).join(' ')}`} fill="none" stroke="#e48c84" strokeWidth=".7" opacity=".55" />)}
        {/* 표피 세포 2줄 */}
        <rect x="0" y={SP1} width={FW} height={ROW * 2} fill="#f7d79e" />
        {[...spin1, ...spin2].map((c, i) => { const { cx, cy } = centerOf(c); return <g key={i}>
          <path d={cellPath(c)} fill="#fde6b8" stroke="#f0bf73" strokeWidth=".9" />
          <ellipse cx={cx} cy={cy} rx="8" ry="5" fill="#f6b48f" />
        </g>; })}
        {/* 기저층 */}
        <rect x="0" y={BAS} width={FW} height={ROW + 1} fill="#ead0e7" />
        {basal.map((c, i) => { const { cx, cy } = centerOf(c); return <g key={i}>
          <path d={cellPath(c)} fill="#fbdde3" stroke="#a983d6" strokeWidth="1" />
          <ellipse cx={cx} cy={cy + 1} rx="8.4" ry="6.4" fill="#c49ddb" />
        </g>; })}
        <path d={`M0 ${BM} ${Array.from({ length: 23 }, (_, k) => `L${k * 16} ${(BM + 1.2 * Math.sin(k * .9)).toFixed(1)}`).join(' ')}`} fill="none" stroke="#9877cf" strokeWidth="1.8" />

        {/* 주근깨·흑자: 기저층 세포에 멜라닌이 많이 쌓인 자리(핵 위에 갈색 알갱이) */}
        {focus === 'top' && basal.filter(c => inZone(centerOf(c).cx, 120, 236)).map((c, i) => { const { cx, cy } = centerOf(c); return <g key={i}>
          {Array.from({ length: 16 }, (_, k) => <circle key={k} cx={cx + (r() - .5) * 18} cy={cy - 6 + (r() - .5) * 6} r={1 + r() * .9} fill="#6e3f22" opacity=".85" />)}
        </g>; })}
        {/* 기미: 표피 전체에 멜라닌 + 진피 위쪽 멜라닌 포식세포 */}
        {focus === 'mid' && <g>
          {[...spin1, ...spin2, ...basal].filter(c => inZone(centerOf(c).cx, 40, 320)).map((c, i) => { const { cx, cy } = centerOf(c); return <g key={i}>
            {Array.from({ length: c.y >= BAS ? 9 : 5 }, (_, k) => <circle key={k} cx={cx + (r() - .5) * 22} cy={cy + (r() - .5) * 12} r={.8 + r() * .8} fill="#7a4a2c" opacity=".6" />)}
          </g>; })}
          {[70, 128, 176, 226, 282].map((x, i) => { const y = BM + 12 + (i % 2) * 7; return <g key={x}>
            <path d={`M${x - 9} ${y} C${x - 9} ${y - 6} ${x + 8} ${y - 7} ${x + 10} ${y - 1} C${x + 11} ${y + 5} ${x - 8} ${y + 7} ${x - 9} ${y} Z`} fill="#c99a7e" opacity=".9" />
            {Array.from({ length: 9 }, (_, k) => <circle key={k} cx={x + (r() - .5) * 14} cy={y + (r() - .5) * 6} r={.8 + r() * .7} fill="#5a321d" />)}
          </g>; })}
        </g>}
        {/* ABNOM: 진피 속에 흩어진 멜라닌세포 */}
        {focus === 'deep' && [[132, 196, 12, 1], [168, 214, -10, .9], [206, 192, 6, 1.05], [236, 216, -18, .9], [150, 230, 4, .85], [196, 236, -6, .95]].map(([x, y, a, s]) => <DermalMelanocyte key={`${x}-${y}`} x={x} y={y} a={a} s={s} />)}
        {/* 점: 경계부와 진피에 모반세포가 둥지처럼 모임(깊을수록 작고 옅게) */}
        {focus === 'mole' && <g>
          {Array.from({ length: 40 }, (_, i) => { const a = i * 2.39996; const d = Math.sqrt(i) * 5.4; const x = 176 + Math.cos(a) * d * 1.5; const y = BM + 6 + Math.abs(Math.sin(a)) * d * .95 - 4; const t = Math.max(0, (y - BM) / 34);
            return <g key={i}><circle cx={x} cy={y} r={5 - t * 1.6} fill={t > .6 ? '#c99577' : '#a5673f'} stroke="#6d3f22" strokeWidth=".5" /><circle cx={x} cy={y} r={1.8 - t * .5} fill="#4c2814" /></g>; })}
        </g>}
        {/* 스타룩스 1540: 표면은 두고 피부 속에 아주 가는 열 기둥(미세 치료 구역) */}
        {focus === 'texture' && [110, 150, 190, 230, 270].map(x => <g key={x}>
          <ellipse cx={x} cy={(SP1 + 214) / 2} rx="5" ry={(214 - SP1) / 2} fill="#fff6ee" opacity=".65" filter={u('b1')} />
        </g>)}
        <rect x="0" y={TOP} width={FW} height={BOTTOM - TOP} filter={u('t')} />
      </g>
      {/* 앞면 테두리 */}
      <path d={`M0 ${TOP} V${BOTTOM} H${FW} V${TOP}`} fill="none" stroke="#e1a28c" strokeWidth=".8" />
      {/* 멜라닌세포(정상) */}
      {melanoX.map(x => <Melanocyte key={x} x={x} base={BM - 1} scale={.72} />)}
    </g>

    {/* 레이저 빛 */}
    {focus === 'texture' && <g>
      <g mask={u('m')}>{[110, 150, 190, 230, 270].map(x => <g key={x}>
        <rect x={x - 4} y={VB_TOP + 18} width="8" height={214 - VB_TOP - 18} fill="#8fbaff" opacity=".45" filter={u('b2')} />
        <rect x={x - 1} y={VB_TOP + 18} width="2" height={210 - VB_TOP - 18} fill="#fff" opacity=".9" filter={u('b1')} />
      </g>)}</g>
      <Handpiece id={id} x={190} w={200} />
    </g>}
    {beam && <g>
      <g mask={u('m')}>
        <path d={`M${beam.x - beam.w / 2} ${VB_TOP + 18} H${beam.x + beam.w / 2} L${beam.x + beam.w * .18} ${beam.to} H${beam.x - beam.w * .18} Z`} fill="#8fbaff" opacity=".5" filter={u('b2')} />
        <path d={`M${beam.x - beam.w * .22} ${VB_TOP + 18} H${beam.x + beam.w * .22} L${beam.x + 2} ${beam.to} H${beam.x - 2} Z`} fill="#dbe9ff" opacity=".8" filter={u('b1')} />
      </g>
      <ellipse cx={beam.x} cy={beam.to} rx={beam.w * .5} ry="9" fill="#bcd6ff" opacity=".85" filter={u('b3')} />
      <ellipse cx={beam.x} cy={beam.to} rx={beam.w * .18} ry="3.5" fill="#fff" opacity=".95" filter={u('b1')} />
      {focus !== 'mole' && Array.from({ length: 18 }, (_, i) => { const a = i * 2.39; const d = 6 + (i % 6) * 2.6; return <circle key={i} cx={beam.x + Math.cos(a) * d * 1.4} cy={beam.to + Math.sin(a) * d * .55} r={.6 + (i % 3) * .3} fill={focus === 'deep' ? '#5f5a73' : '#6b4434'} opacity=".8" />; })}
      <Handpiece id={id} x={beam.x} w={Math.max(34, beam.w + 14)} />
    </g>}

    {/* 층 이름 */}
    <g className="skin-layer-tags">
      <text x="6" y={SP1 + 20}>표피</text>
      <text x="6" y={BM + 60}>진피</text>
      <text x="6" y={BOTTOM - 3}>피하지방</text>
    </g>
  </svg>;
}

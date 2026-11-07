// 피부 단면 그림: 사용자가 보낸 그림(public/illustrations/skin-base.jpg, 1707×1280)을 바탕으로 쓰고,
// 그 위에 카드마다 색소 위치와 레이저 빛만 얹는다(2026-11-07 "이걸 바탕으로 쓰라고").
// 바탕 그림 좌표: 앞면 x 30~1495 · 피부 표면 y≈285 · 각질층 285~355 · 표피 세포 355~580 · 기저층 580~745(핵 y≈667) · 기저막 y≈745 · 진피 750~1195 · 피하지방 1195~1230.
// 색소 위치는 일반적으로 확립된 내용만: 주근깨·흑자 = 기저층 멜라닌 증가, 기미 = 표피 멜라닌 + 진피 위쪽 멜라닌 포식세포,
// ABNOM = 진피 속 멜라닌세포, 점 = 경계부·진피의 모반세포 둥지.
import { useId } from 'react';

export type SkinFocus = 'top' | 'mid' | 'deep' | 'texture' | 'mole';

export const SKIN_BASE = '/illustrations/skin-base.jpg';
const IW = 1707, IH = 1280, PAD = 230; // 위쪽 여백: 레이저 손잡이 자리
const BASAL_NUCLEI = [240, 520, 705, 888, 1188, 1385];
const SPIN_NUCLEI = [[90, 404], [263, 404], [437, 406], [608, 406], [782, 408], [958, 408], [1133, 408], [1314, 408], [176, 500], [340, 500], [515, 500], [688, 504], [866, 504], [1040, 504], [1215, 504], [1397, 507]];

function rng(seed: number) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

// 레이저 손잡이 끝(금속 몸체 + 빛 나오는 창)
function Handpiece({ id, x, w }: { id: string; x: number; w: number }) {
  const y = -PAD + 6;
  return <g>
    <rect x={x - w / 2} y={y} width={w} height="80" rx="16" fill={`url(#${id}h)`} />
    <rect x={x - w / 2 + 10} y={y + 72} width={w - 20} height="22" rx="7" fill="#3c4249" />
    <rect x={x - w / 2 + 20} y={y + 84} width={w - 40} height="10" rx="5" fill="#cfe1ff" />
    <rect x={x - w / 2 + 20} y={y + 84} width={w - 40} height="10" rx="5" fill="#fff" opacity=".8" filter={`url(#${id}b1)`} />
  </g>;
}

// 진피 속 멜라닌세포(ABNOM): 바탕 그림의 멜라닌세포와 같은 질감, 더 어둡고 길쭉하게
function DermalMelanocyte({ x, y, a, s }: { x: number; y: number; a: number; s: number }) {
  return <g transform={`translate(${x} ${y}) rotate(${a}) scale(${s})`}>
    <path d="M-60 4 C-44 -2 -34 -14 -20 -15 C-6 -20 14 -18 26 -10 C36 -6 48 -12 66 -22 C54 -8 46 -1 42 4 C52 8 58 14 68 26 C48 16 36 12 26 12 C12 18 -10 20 -24 11 C-36 8 -46 12 -64 22 C-54 12 -54 8 -60 4 Z" fill="#8a6f7e" stroke="#5c4556" strokeWidth="2" strokeOpacity=".5" />
    <path d="M-16 -6 C-4 -11 10 -10 18 -5" fill="none" stroke="#fff" strokeOpacity=".25" strokeWidth="4" strokeLinecap="round" />
    <ellipse cx="0" cy="1" rx="12" ry="9.5" fill="#4d3a4b" />
  </g>;
}

export function SkinSection({ focus, label }: { focus: SkinFocus; label: string }) {
  const id = useId().replace(/:/g, '');
  const u = (k: string) => `url(#${id}${k})`;
  const r = rng(5);
  const granule = (cx: number, cy: number, n: number, spreadX: number, spreadY: number, color = '#6e3f22', size = 4) =>
    Array.from({ length: n }, (_, k) => <circle key={k} cx={cx + (r() - .5) * spreadX} cy={cy + (r() - .5) * spreadY} r={size * (.6 + r() * .6)} fill={color} opacity={.7 + r() * .25} />);

  const beam = { top: { x: 705, to: 640, w: 110 }, mid: { x: 705, to: 795, w: 240 }, deep: { x: 720, to: 950, w: 80 }, texture: null, mole: { x: 750, to: 300, w: 130 } }[focus];
  const columns = [400, 600, 800, 1000, 1200];

  return <svg viewBox={`0 ${-PAD} ${IW} ${IH + PAD}`} className="skin-section" role="img" aria-label={label}>
    <defs>
      <filter id={`${id}b1`} x="-50%" y="-20%" width="200%" height="140%"><feGaussianBlur stdDeviation="5" /></filter>
      <filter id={`${id}b2`} x="-80%" y="-20%" width="260%" height="140%"><feGaussianBlur stdDeviation="16" /></filter>
      <filter id={`${id}b3`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="22" /></filter>
      <filter id={`${id}soft`}><feGaussianBlur stdDeviation="1.2" /></filter>
      <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" /><stop offset=".55" stopColor="#fff" stopOpacity=".8" /><stop offset="1" stopColor="#fff" stopOpacity=".25" /></linearGradient>
      <mask id={`${id}m`}><rect x="0" y={-PAD} width={IW} height={IH + PAD} fill={u('f')} /></mask>
      <linearGradient id={`${id}h`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#4a5058" /><stop offset=".35" stopColor="#9aa2ab" /><stop offset=".55" stopColor="#d9dde2" /><stop offset="1" stopColor="#555c64" /></linearGradient>
    </defs>
    <image href={SKIN_BASE} x="0" y="0" width={IW} height={IH} />

    <g filter={u('soft')}>
      {/* 주근깨·흑자: 기저층 세포 핵 위에 멜라닌이 많이 쌓인 자리 */}
      {focus === 'top' && <g>
        {[520, 705, 888].map(x => <g key={x}>{granule(x, 630, 34, 110, 34, '#6e3f22', 6)}</g>)}
        {[515, 688, 866].map(x => <g key={x}>{granule(x, 520, 10, 120, 50, '#7d4a2b', 4.5)}</g>)}
      </g>}
      {/* 기미: 표피 전체에 멜라닌 + 진피 위쪽 멜라닌 포식세포 */}
      {focus === 'mid' && <g>
        {BASAL_NUCLEI.map(x => <g key={x}>{granule(x, 630, 18, 120, 40, '#7a4a2c', 5)}</g>)}
        {SPIN_NUCLEI.map(([x, y]) => <g key={`${x}-${y}`}>{granule(x, y, 7, 110, 50, '#8a5634', 4)}</g>)}
        {[240, 470, 705, 940, 1180].map((x, i) => { const y = 800 + (i % 2) * 26; return <g key={x}>
          <path d={`M${x - 34} ${y} C${x - 34} ${y - 22} ${x + 30} ${y - 26} ${x + 38} ${y - 4} C${x + 42} ${y + 18} ${x - 30} ${y + 26} ${x - 34} ${y} Z`} fill="#c9977b" opacity=".92" />
          {granule(x, y, 14, 54, 22, '#5a321d', 4)}
        </g>; })}
      </g>}
      {/* ABNOM: 진피 속에 흩어진 멜라닌세포 */}
      {focus === 'deep' && [[560, 900, 12, 1], [700, 960, -10, .9], [850, 900, 6, 1.05], [960, 980, -18, .9], [610, 1030, 4, .85], [800, 1040, -6, .95]].map(([x, y, a, s]) => <DermalMelanocyte key={`${x}-${y}`} x={x} y={y} a={a} s={s} />)}
      {/* 점: 경계부와 진피에 모반세포가 둥지처럼 모임(깊을수록 작고 옅게) */}
      {focus === 'mole' && <g>
        {Array.from({ length: 46 }, (_, i) => { const a = i * 2.39996; const d = Math.sqrt(i) * 19; const x = 750 + Math.cos(a) * d * 1.5; const y = 760 + Math.abs(Math.sin(a)) * d * .95 - 10; const t = Math.max(0, (y - 750) / 130);
          return <g key={i}><circle cx={x} cy={y} r={20 - t * 6} fill={t > .6 ? '#c99577' : '#a5673f'} stroke="#6d3f22" strokeWidth="2" /><circle cx={x} cy={y} r={7 - t * 2} fill="#4c2814" /></g>; })}
      </g>}
      {/* 스타룩스 1540: 표면은 두고 피부 속에 아주 가는 열 기둥(미세 치료 구역) */}
      {focus === 'texture' && columns.map(x => <ellipse key={x} cx={x} cy={660} rx="16" ry="330" fill="#fff6ee" opacity=".55" filter={u('b1')} />)}
    </g>

    {/* 레이저 빛 */}
    {focus === 'texture' && <g>
      <g mask={u('m')}>{columns.map(x => <g key={x}>
        <rect x={x - 14} y={-PAD + 96} width="28" height={1000 + PAD - 96} fill="#8fbaff" opacity=".45" filter={u('b2')} />
        <rect x={x - 4} y={-PAD + 96} width="8" height={980 + PAD - 96} fill="#fff" opacity=".9" filter={u('b1')} />
      </g>)}</g>
      <Handpiece id={id} x={800} w={920} />
    </g>}
    {beam && <g>
      <g mask={u('m')}>
        <path d={`M${beam.x - beam.w / 2} ${-PAD + 96} H${beam.x + beam.w / 2} L${beam.x + beam.w * .18} ${beam.to} H${beam.x - beam.w * .18} Z`} fill="#8fbaff" opacity=".5" filter={u('b2')} />
        <path d={`M${beam.x - beam.w * .22} ${-PAD + 96} H${beam.x + beam.w * .22} L${beam.x + 6} ${beam.to} H${beam.x - 6} Z`} fill="#dbe9ff" opacity=".8" filter={u('b1')} />
      </g>
      <ellipse cx={beam.x} cy={beam.to} rx={beam.w * .55} ry="34" fill="#bcd6ff" opacity=".85" filter={u('b3')} />
      <ellipse cx={beam.x} cy={beam.to} rx={beam.w * .2} ry="13" fill="#fff" opacity=".95" filter={u('b1')} />
      {focus !== 'mole' && Array.from({ length: 22 }, (_, i) => { const a = i * 2.39; const d = 20 + (i % 6) * 9; return <circle key={i} cx={beam.x + Math.cos(a) * d * 1.5} cy={beam.to + Math.sin(a) * d * .55} r={2.4 + (i % 3) * 1.2} fill={focus === 'deep' ? '#5f5a73' : '#6b4434'} opacity=".8" />; })}
      <Handpiece id={id} x={beam.x} w={Math.max(130, beam.w + 50)} />
    </g>}

  </svg>;
}

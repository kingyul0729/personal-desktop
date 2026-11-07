// 의학 교과서식 피부 단면 그림(직접 그린 SVG, 외부 이미지 없음).
// 각질층 → 표피 세포층(각질형성세포) → 기저층(기저세포·멜라닌세포) → 진피유두(모세혈관 고리) → 망상진피(콜라겐 다발·혈관·모낭·피지샘) → 피하지방.
// 색소 위치는 일반적으로 확립된 내용만: 주근깨·흑자 = 기저층 멜라닌 증가, 기미 = 표피 멜라닌 + 진피 위쪽 멜라닌 포식세포,
// ABNOM = 진피 속 가지 달린 멜라닌세포, 점(모반) = 경계부·진피의 모반세포 둥지(깊을수록 색이 옅고 작아짐).
// 도형처럼 보이지 않게(2026-11-07 사용자 지적): 같은 크기·같은 간격·같은 굵기를 피하고, 조직 전체에 아주 약한 일렁임(feDisplacementMap)을 준다.
import { useId } from 'react';

export type SkinFocus = 'top' | 'mid' | 'deep' | 'texture' | 'mole';

const W = 400;
const H = 286;
const SURFACE = 44;
const PAPILLARY = 150;
const SUBCUTIS = 250;
const surfaceY = (x: number, mole: boolean) => SURFACE + 1.2 * Math.sin(x / 17) + .6 * Math.sin(x / 5.3) - (mole ? Math.max(0, 9 - Math.abs(x - 200) / 3.2) : 0);
const junctionY = (x: number) => 102 + 9 * Math.sin((x - 10) / 13) + 2.5 * Math.sin(x / 7.1);
const papBottom = (x: number) => PAPILLARY + 4 * Math.sin(x / 30) + 2 * Math.sin(x / 11);
const subY = (x: number) => SUBCUTIS + 5 * Math.sin(x / 37) + 3 * Math.sin(x / 13);

// 같은 그림이 매번 같게 나오도록 고정된 난수
function rng(seed: number) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

const curve = (fn: (x: number) => number, from = 0, to = W, step = 4) => {
  let d = `M${from} ${fn(from).toFixed(1)}`;
  for (let x = from + step; x <= to; x += step) d += ` L${x} ${fn(x).toFixed(1)}`;
  return d;
};
// 오른쪽 → 왼쪽으로 이어 그리기(면을 닫을 때)
const back = (fn: (x: number) => number, step = 4) => { let d = ''; for (let x = W; x >= 0; x -= step) d += ` L${x} ${fn(x).toFixed(1)}`; return d; };
// 울퉁불퉁한 덩어리(세포·지방소엽·샘): 둘레를 조금씩 다르게
const blob = (cx: number, cy: number, rx: number, ry: number, rand: () => number, n = 9, jag = .18) => {
  const p = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; const k = 1 + (rand() - .5) * jag * 2; return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]; });
  const mid = (i: number) => { const a = p[i % n], c = p[(i + 1) % n]; return [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]; };
  let d = `M${mid(0)[0].toFixed(1)} ${mid(0)[1].toFixed(1)}`;
  for (let i = 1; i <= n; i++) { const c = p[i % n], m = mid(i); d += ` Q${c[0].toFixed(1)} ${c[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`; }
  return d + ' Z';
};
// 굵기가 변하는 관(혈관): 두 가장자리를 따로 그려 면으로 닫는다
const tube = (fn: (x: number) => number, width: (x: number) => number, from = -10, to = W + 10, step = 5) => {
  let top = '', bottom = '';
  for (let x = from; x <= to; x += step) top += `${top ? ' L' : 'M'}${x} ${(fn(x) - width(x) / 2).toFixed(1)}`;
  for (let x = to; x >= from; x -= step) bottom += ` L${x} ${(fn(x) + width(x) / 2).toFixed(1)}`;
  return top + bottom + ' Z';
};

// 레이저 손잡이 끝(금속 몸체 + 빛 나오는 창)
function Handpiece({ id, x, w }: { id: string; x: number; w: number }) {
  return <g>
    <rect x={x - w / 2} y="-6" width={w} height="24" rx="5" fill={`url(#${id}h)`} />
    <rect x={x - w / 2 + 3} y="14" width={w - 6} height="7" rx="2" fill="#3c4249" />
    <rect x={x - w / 2 + 6} y="18.5" width={w - 12} height="3" rx="1.5" fill="#cfe1ff" />
    <rect x={x - w / 2 + 6} y="18.5" width={w - 12} height="3" rx="1.5" fill="#ffffff" opacity=".8" filter={`url(#${id}b1)`} />
  </g>;
}

// 가지 달린 멜라닌세포(ABNOM·기저층)
function Dendritic({ x, y, a, size, color, rand, spindle = false }: { x: number; y: number; a: number; size: number; color: string; rand: () => number; spindle?: boolean }) {
  const arms = Array.from({ length: spindle ? 3 : 4 + Math.floor(rand() * 2) }, (_, i) => {
    const ang = spindle ? a + (i === 0 ? 0 : i === 1 ? Math.PI : Math.PI * (rand() > .5 ? .35 : 1.35)) + (rand() - .5) * .3 : a + (i / 5) * Math.PI * 2 + (rand() - .5) * .8; const len = size * (spindle ? 1.6 + rand() : 1.4 + rand() * 1.3);
    const ex = Math.cos(ang) * len, ey = Math.sin(ang) * len * .7;
    const bx = ex * .55 + (rand() - .5) * size, by = ey * .55 + (rand() - .5) * size;
    return <g key={i}><path d={`M0 0 Q${bx.toFixed(1)} ${by.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`} stroke={color} strokeWidth={.9 + rand() * .5} fill="none" strokeLinecap="round" />
      <path d={`M${(ex * .7).toFixed(1)} ${(ey * .7).toFixed(1)} l${((rand() - .5) * size).toFixed(1)} ${((rand() - .5) * size).toFixed(1)}`} stroke={color} strokeWidth=".6" strokeLinecap="round" opacity=".8" /></g>;
  });
  return <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>{arms}
    <path d={blob(0, 0, size * (spindle ? 1.3 : .8), size * (spindle ? .45 : .55), rand, 8, .2)} fill={color} transform={`rotate(${(a * 57.3).toFixed(0)})`} />
    <ellipse rx={size * .3} ry={size * .2} fill="#3e3a4d" opacity=".6" transform={`rotate(${(a * 57.3).toFixed(0)})`} />
  </g>;
}

export function SkinSection({ focus, label }: { focus: SkinFocus; label: string }) {
  const id = useId().replace(/:/g, '');
  const r = rng(7);
  const mole = focus === 'mole';
  const s = (x: number) => surfaceY(x, mole);
  const u = (id2: string) => `url(#${id}${id2})`;

  // 표피 세포: 위로 갈수록 납작하고 옅다(크기·간격 조금씩 다르게)
  const cells: { x: number; y: number; rx: number; ry: number; tone: number; rot: number }[] = [];
  for (let y = SURFACE + 12; y < 132; y += 8 + r() * 1.2) {
    for (let x = r() * 6; x < W + 6; x += 10.5 + r() * 3) {
      const yy = y + (r() - .5) * 3;
      if (yy > junctionY(x) - 9 || yy < s(x) + 9) continue;
      const depth = (yy - SURFACE) / (junctionY(x) - SURFACE);
      cells.push({ x, y: yy, rx: 4.6 + r() * 1.6, ry: 2.1 + depth * 2 + r() * .6, tone: depth, rot: (r() - .5) * 18 });
    }
  }
  // 기저층 세포: 경계선을 따라 한 줄(세로로 긴 세포)
  const basal: { x: number; y: number; a: number; s: number }[] = [];
  for (let x = 2; x < W; x += 5.6 + r() * 1.6) {
    const a = Math.atan2(junctionY(x + 1) - junctionY(x - 1), 2) * 180 / Math.PI;
    basal.push({ x, y: junctionY(x) - 4.4, a, s: .85 + r() * .3 });
  }
  // 콜라겐 다발: 굵기·길이·밝기 제각각
  const fibers = Array.from({ length: 70 }, () => {
    const y = PAPILLARY + 6 + r() * (SUBCUTIS - PAPILLARY - 10);
    const x = r() * (W + 60) - 40; const len = 30 + r() * 80; const amp = 1.5 + r() * 4;
    return { d: `M${x.toFixed(0)} ${y.toFixed(0)} q${(len / 4).toFixed(0)} ${(-amp).toFixed(1)} ${(len / 2).toFixed(0)} ${((r() - .5) * 4).toFixed(1)} t${(len / 2).toFixed(0)} ${((r() - .5) * 4).toFixed(1)}`, w: 1.2 + r() * 2.6, o: .25 + r() * .4, c: r() > .5 ? '#d7a598' : '#e6bdb1' };
  });
  // 진피유두 꼭대기마다 모세혈관 고리(높이·기울기 제각각, 올라가는 쪽은 붉고 내려오는 쪽은 푸르게)
  const papillae: number[] = [];
  for (let x = 6; x < W; x += 1) if (junctionY(x) < junctionY(x - 1) && junctionY(x) <= junctionY(x + 1)) papillae.push(x);
  const loops = papillae.map(x => ({ x, top: junctionY(x) + 9 + r() * 5, lean: (r() - .5) * 6, wid: 1.8 + r() * 1.4, w1: (r() - .5) * 3, w2: (r() - .5) * 3 }));
  // 피하지방: 크기가 다른 지방세포가 소엽으로 모이고, 소엽 사이에 얇은 막
  const fat: { d: string; tone: string }[] = [];
  for (let y = SUBCUTIS + 6; y < H + 14; y += 13 + r() * 4) for (let x = r() * 8 - 8; x < W + 14; x += 13 + r() * 6) {
    const rr = 6 + r() * 4;
    fat.push({ d: blob(x, y + (r() - .5) * 4, rr, rr * (.8 + r() * .3), r, 8, .16), tone: r() > .5 ? '#fbf2d9' : '#f8ebc8' });
  }
  const inZone = (x: number, a: number, b: number) => x > a && x < b;
  const beam = { top: { x: 200, to: junctionY(200) - 2, w: 30 }, mid: { x: 200, to: PAPILLARY - 14, w: 70 }, deep: { x: 200, to: 178, w: 22 }, texture: null, mole: { x: 200, to: s(200) + 12, w: 34 } }[focus];

  // 모낭(x=352): 바깥뿌리집 · 속뿌리집 · 털 · 아래쪽 털망울과 털유두, 옆에 피지샘(여러 소엽)과 털세움근
  const fx = 352;
  const follicle = `M${fx - 10} ${s(fx) + 2} C${fx - 11} 120 ${fx - 13} 190 ${fx - 16} 228 C${fx - 20} 246 ${fx + 20} 246 ${fx + 16} 228 C${fx + 13} 190 ${fx + 11} 120 ${fx + 10} ${s(fx) + 2} Z`;
  const sebaceous = Array.from({ length: 7 }, (_, i) => ({ d: blob(fx - 24 - (i % 3) * 7 + (r() - .5) * 3, 140 + Math.floor(i / 3) * 12 + (i % 2) * 4, 6 + r() * 2.5, 5.5 + r() * 2, r, 8, .2) }));

  return <svg viewBox={`0 0 ${W} ${H}`} className="skin-section" role="img" aria-label={label}>
    <defs>
      <clipPath id={`${id}c`}><rect x="0" y="0" width={W} height={H} rx="12" /></clipPath>
      {/* 조직 전체를 아주 약하게 일렁이게: 반듯한 선·원이 그대로 보이지 않게 */}
      <filter id={`${id}w`} x="-2%" y="-2%" width="104%" height="104%">
        <feTurbulence type="fractalNoise" baseFrequency=".035 .05" numOctaves="2" seed="11" result="t" />
        <feDisplacementMap in="SourceGraphic" in2="t" scale="5" xChannelSelector="R" yChannelSelector="G" result="d" />
        <feGaussianBlur in="d" stdDeviation=".3" />
      </filter>
      <filter id={`${id}t`} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="3" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 .45  0 0 0 0 .28  0 0 0 0 .24  0 0 0 .1 0" />
      </filter>
      <filter id={`${id}b1`} x="-50%" y="-20%" width="200%" height="140%"><feGaussianBlur stdDeviation="1.4" /></filter>
      <filter id={`${id}b2`} x="-80%" y="-20%" width="260%" height="140%"><feGaussianBlur stdDeviation="4.5" /></filter>
      <filter id={`${id}b3`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6" /></filter>
      <filter id={`${id}soft`} x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2.5" /></filter>
      <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" /><stop offset=".55" stopColor="#fff" stopOpacity=".75" /><stop offset="1" stopColor="#fff" stopOpacity=".2" /></linearGradient>
      <mask id={`${id}m`}><rect x="0" y="0" width={W} height={H} fill={u('f')} /></mask>
      <linearGradient id={`${id}h`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#4a5058" /><stop offset=".35" stopColor="#9aa2ab" /><stop offset=".55" stopColor="#d9dde2" /><stop offset="1" stopColor="#555c64" /></linearGradient>
      {/* 층 사이 색이 자연스럽게 이어지게 */}
      <linearGradient id={`${id}d`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f8e4dd" /><stop offset=".3" stopColor="#f3d6cd" /><stop offset=".75" stopColor="#efcfc5" /><stop offset="1" stopColor="#f1d8c4" />
      </linearGradient>
      <linearGradient id={`${id}e`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f7e6db" /><stop offset=".6" stopColor="#f2d9c9" /><stop offset="1" stopColor="#eccab6" />
      </linearGradient>
      <radialGradient id={`${id}bulb`}><stop offset="0" stopColor="#e9a99a" /><stop offset="1" stopColor="#d88f7f" /></radialGradient>
    </defs>
    <g clipPath={u('c')}>
      <rect x="0" y="0" width={W} height={H} fill="#fbfbfc" />
      <g filter={u('w')}>
        {/* 진피 바탕 */}
        <path d={`${curve(junctionY)} L${W} ${H} L0 ${H} Z`} fill={u('d')} />
        {/* 진피유두층은 조금 더 밝고 성기다 */}
        <path d={`${curve(junctionY)} ${back(papBottom)} Z`} fill="#f9e7e1" opacity=".7" filter={u('soft')} />
        {fibers.map((f, i) => <path key={i} d={f.d} fill="none" stroke={f.c} strokeWidth={f.w} strokeLinecap="round" opacity={f.o} />)}
        {/* 피하지방 */}
        <path d={`${curve(subY)} L${W} ${H} L0 ${H} Z`} fill="#ecd8a8" />
        {fat.map((f, i) => <path key={i} d={f.d} fill={f.tone} stroke="#dcc08a" strokeWidth=".7" />)}
        <path d={curve(subY)} fill="none" stroke="#e2c4b0" strokeWidth="3" opacity=".6" filter={u('b1')} />
        {/* 큰 혈관(동맥·정맥): 굵기가 변하고 안쪽이 조금 밝다 */}
        <path d={tube(x => 214 + 10 * Math.sin(x / 70) + 3 * Math.sin(x / 17), x => 5 + 1.5 * Math.sin(x / 23), -10, 330)} fill="#b5443e" />
        <path d={tube(x => 210 + 10 * Math.sin(x / 70) + 3 * Math.sin(x / 17), x => 1.6, -10, 330)} fill="#7d2a26" opacity=".35" filter={u('b1')} />
        <path d={tube(x => 213 + 10 * Math.sin(x / 70) + 3 * Math.sin(x / 17), x => 1.4 + .5 * Math.sin(x / 23), -10, 330)} fill="#e3958c" opacity=".75" />
        <path d={tube(x => 232 + 8 * Math.sin(x / 60 + 1) + 2.5 * Math.sin(x / 19), x => 6.5 + 2 * Math.sin(x / 29), 70, W + 10)} fill="#5f6aa0" />
        <path d={tube(x => 230.5 + 8 * Math.sin(x / 60 + 1) + 2.5 * Math.sin(x / 19), x => 2 + .6 * Math.sin(x / 29), 70, W + 10)} fill="#a3abd2" opacity=".7" />
        {[[60, '#bf5650', 214], [150, '#7480b0', 232], [230, '#bf5650', 214]].map(([bx, c, by]) => { const x = bx as number; const y = (by as number) + 8 * Math.sin(x / 65); return <path key={x} d={`M${x} ${y} C${x + 6} ${y - 18} ${x - 8} ${y - 30} ${x + 4} ${y - 46}`} fill="none" stroke={c as string} strokeWidth="1.6" strokeLinecap="round" opacity=".45" />; })}
        {loops.map(l => { const base = l.top + 18 + r() * 8; const mid = (base + l.top) / 2; return <g key={l.x}>
          <path d={`M${l.x - l.wid - 1} ${base} C${l.x - l.wid + l.w1} ${mid} ${l.x - l.wid * 1.2 + l.lean} ${l.top + 3} ${l.x + l.lean} ${l.top} C${l.x + l.wid * 1.3 + l.lean} ${l.top + 3} ${l.x + l.wid + l.w2} ${mid} ${l.x + l.wid + 1.5} ${base}`} fill="none" stroke="#c4554f" strokeWidth="1" strokeLinecap="round" opacity=".38" />
        </g>; })}
        {/* 모낭 + 피지샘 + 털세움근 */}
        <path d={`M${fx + 9} 128 C${fx + 30} 116 ${fx + 40} ${junctionY(fx + 40) + 10} ${fx + 46} ${junctionY(fx + 46) + 2}`} fill="none" stroke="#c98b84" strokeWidth="3" strokeLinecap="round" opacity=".55" />
        <path d={follicle} fill="#ebc3ad" stroke="#d29f86" strokeWidth=".8" />
        <path d={`M${fx - 6} ${s(fx) + 4} C${fx - 7} 120 ${fx - 8} 190 ${fx - 9} 226 L${fx + 9} 226 C${fx + 8} 190 ${fx + 7} 120 ${fx + 6} ${s(fx) + 4} Z`} fill="#f2d6c1" />
        <path d={`M${fx - 15} 230 C${fx - 18} 246 ${fx + 18} 246 ${fx + 15} 230 C${fx + 10} 222 ${fx - 10} 222 ${fx - 15} 230 Z`} fill="#d79a86" />
        <path d={`M${fx - 5} 244 C${fx - 6} 236 ${fx - 2} 233 ${fx} 233 C${fx + 2} 233 ${fx + 6} 236 ${fx + 5} 244 Z`} fill="#eab3a6" />
        <path d={`M${fx - 2.4} ${s(fx) - 34} C${fx - 3} 100 ${fx - 2.6} 180 ${fx - 2} 232 L${fx + 2.4} 232 C${fx + 2.6} 180 ${fx + 2.8} 100 ${fx + 1.6} ${s(fx) - 34} Z`} fill="#45342c" />
        <path d={`M${fx - .6} ${s(fx) - 30} C${fx - 1} 100 ${fx - .8} 180 ${fx - .4} 228`} stroke="#8a6b5c" strokeWidth=".7" fill="none" opacity=".7" />
        <path d={`M${fx - 9} 150 C${fx - 14} 147 ${fx - 16} 148 ${fx - 18} 150`} stroke="#e1c27a" strokeWidth="3" fill="none" />
        {sebaceous.map((g, i) => <g key={i}><path d={g.d} fill="#f3df9c" stroke="#d6b964" strokeWidth=".7" /></g>)}
        {sebaceous.map((g, i) => <circle key={i} cx={fx - 24 - (i % 3) * 7} cy={140 + Math.floor(i / 3) * 12 + (i % 2) * 4} r=".9" fill="#b39448" opacity=".6" />)}

        {/* 표피 */}
        <path d={`${curve(s)} ${back(junctionY)} Z`} fill={u('e')} />
        {cells.map((c, i) => <g key={i} transform={`translate(${c.x.toFixed(1)} ${c.y.toFixed(1)}) rotate(${c.rot.toFixed(0)})`}>
          <ellipse rx={c.rx} ry={c.ry} fill={c.tone < .3 ? '#f7e8de' : '#f1d4c2'} stroke="#e0b8a1" strokeWidth=".5" />
          {c.tone > .22 && <ellipse rx={.8 + c.tone * .7} ry={.7 + c.tone * .5} fill="#b07f73" opacity=".65" />}
        </g>)}
        {basal.map((b, i) => <g key={i} transform={`translate(${b.x.toFixed(1)} ${b.y.toFixed(1)}) rotate(${b.a.toFixed(0)}) scale(${b.s.toFixed(2)})`}>
          <ellipse rx="2.9" ry="4.6" fill="#e9bfa7" stroke="#d29d85" strokeWidth=".5" />
          <ellipse rx="1.3" ry="1.9" fill="#94645a" />
        </g>)}
        {/* 각질층: 얇은 판이 겹친 모양 */}
        <path d={`${curve(x => s(x) - 3)} ${back(x => s(x) + 4)} Z`} fill="#ecd3c5" />
        {[0, 1.8, 3.6, 5.4].map((o, i) => <path key={o} d={curve(x => s(x) - 2.6 + o + .5 * Math.sin(x / (3 + i)), 0, W, 3)} fill="none" stroke="#d9b5a3" strokeWidth=".55" opacity=".8" />)}
        {/* 정상 멜라닌세포: 기저층에 띄엄띄엄 */}
        {[46, 121, 266, 318].map(x => <Dendritic key={x} x={x} y={junctionY(x) - 5} a={-1.6} size={2.6} color="#7a5446" rand={r} />)}

        {/* 주근깨·흑자: 기저층 멜라닌이 늘어난 자리 */}
        {focus === 'top' && <g>
          {basal.filter(b => inZone(b.x, 140, 262)).map((b, i) => <ellipse key={i} cx={b.x} cy={b.y - 3} rx={2.6 + r() * 1.4} ry={1.6 + r()} fill="#64402f" opacity={.6 + r() * .3} />)}
          {cells.filter(c => inZone(c.x, 140, 262) && c.tone > .5).map((c, i) => <circle key={i} cx={c.x + (r() - .5) * 4} cy={c.y - 1} r={.6 + r() * .9} fill="#7b5040" opacity=".65" />)}
        </g>}
        {/* 기미: 표피 전체에 퍼진 멜라닌 + 진피 위쪽 멜라닌 포식세포 */}
        {focus === 'mid' && <g>
          {basal.filter(b => inZone(b.x, 60, 340)).map((b, i) => <ellipse key={i} cx={b.x} cy={b.y - 3} rx={2.2 + r()} ry={1.4 + r() * .8} fill="#7b5040" opacity={.4 + r() * .3} />)}
          {cells.filter(c => inZone(c.x, 60, 340) && c.tone > .25).map((c, i) => <circle key={i} cx={c.x + (r() - .5) * 4} cy={c.y - 1} r={.5 + r() * .8} fill="#8a5c47" opacity=".5" />)}
          {[88, 134, 176, 214, 252, 296].map((x, i) => { const y = junctionY(x) + 14 + (i % 3) * 5; return <g key={x}>
            <path d={blob(x, y, 6 + r() * 2, 4 + r() * 1.5, r, 8, .25)} fill="#b2856f" opacity=".75" />
            {Array.from({ length: 7 }, (_, k) => <circle key={k} cx={x + (r() - .5) * 9} cy={y + (r() - .5) * 5} r={.5 + r() * .8} fill="#4f3127" />)}
          </g>; })}
        </g>}
        {/* ABNOM: 진피 속에 흩어진 가지 달린 멜라닌세포 */}
        {focus === 'deep' && <g>
          {[[150, 166, .3], [176, 184, -.2], [200, 160, .15], [224, 180, -.35], [246, 164, .25], [166, 200, .1], [212, 200, -.1], [188, 174, .5]].map(([x, y, a]) => <Dendritic key={`${x}-${y}`} x={x} y={y} a={a} size={4.2 + r() * 1.6} color="#6a6580" rand={r} spindle />)}
        </g>}
        {/* 점(모반): 경계부 둥지 + 진피 속 모반세포(깊을수록 작고 옅다) */}
        {focus === 'mole' && <g>
          {Array.from({ length: 46 }, (_, i) => {
            const a = i * 2.39996; const d = Math.sqrt(i) * 4.4; const x = 200 + Math.cos(a) * d * 1.45; const y = junctionY(200) + 12 + Math.sin(a) * d * .85;
            const depth = Math.max(0, (y - junctionY(200)) / 40);
            return <g key={i}><path d={blob(x, y, 3.2 - depth * 1, 2.7 - depth * .8, r, 7, .25)} fill={depth > .55 ? '#b48a73' : '#94634d'} stroke="#6f4636" strokeWidth=".4" />
              <circle cx={x + (r() - .5)} cy={y} r={.9 - depth * .2} fill="#4a2e24" /></g>;
          })}
          {[180, 192, 206, 219].map(x => <path key={x} d={blob(x, junctionY(x) - 6, 4.5, 3.2, r, 8, .3)} fill="#7b4e3d" />)}
        </g>}
      </g>
      {/* 조직 질감 */}
      <rect x="0" y={SURFACE - 4} width={W} height={H} filter={u('t')} />
      {/* 스타룩스 1540: 표면은 두고 피부 속에 아주 가는 열 기둥(미세 치료 구역) */}
      {focus === 'texture' && <g>
        {[120, 160, 200, 240, 280].map(x => <g key={x}>
          <ellipse cx={x} cy={128} rx="5" ry="54" fill="#f6efe9" opacity=".75" filter={u('b1')} />
          <ellipse cx={x} cy={128} rx="2.4" ry="50" fill="#e7b9a4" opacity=".6" filter={u('b1')} />
        </g>)}
        <g mask={u('m')}>
          {[120, 160, 200, 240, 280].map(x => <g key={x}>
            <rect x={x - 4} y="22" width="8" height="160" fill="#8fbaff" opacity=".45" filter={u('b2')} />
            <rect x={x - 1} y="22" width="2" height="156" fill="#ffffff" opacity=".9" filter={u('b1')} />
          </g>)}
        </g>
        <Handpiece id={id} x={200} w={190} />
      </g>}
      {/* 레이저 빛: 손잡이 끝에서 나와 겨냥한 깊이에서 모인다 */}
      {beam && <g>
        <g mask={u('m')}>
          <path d={`M${beam.x - beam.w / 2} 22 H${beam.x + beam.w / 2} L${beam.x + beam.w * .18} ${beam.to} H${beam.x - beam.w * .18} Z`} fill="#8fbaff" opacity=".5" filter={u('b2')} />
          <path d={`M${beam.x - beam.w * .22} 22 H${beam.x + beam.w * .22} L${beam.x + 2} ${beam.to} H${beam.x - 2} Z`} fill="#dbe9ff" opacity=".8" filter={u('b1')} />
        </g>
        <ellipse cx={beam.x} cy={beam.to} rx={beam.w * .5} ry="9" fill="#bcd6ff" opacity=".85" filter={u('b3')} />
        <ellipse cx={beam.x} cy={beam.to} rx={beam.w * .18} ry="3.5" fill="#ffffff" opacity=".95" filter={u('b1')} />
        {/* 빛을 받은 색소가 잘게 부서진 모습 */}
        {focus !== 'mole' && Array.from({ length: 18 }, (_, i) => { const a = i * 2.39; const d = 6 + (i % 6) * 2.6; return <circle key={i} cx={beam.x + Math.cos(a) * d * 1.4} cy={beam.to + Math.sin(a) * d * .55} r={.6 + (i % 3) * .3} fill={focus === 'deep' ? '#5f5a73' : '#6b4434'} opacity=".8" />; })}
        <Handpiece id={id} x={beam.x} w={Math.max(34, beam.w + 14)} />
      </g>}
      {/* 층 이름 */}
      <g className="skin-layer-tags">
        <text x="8" y={SURFACE + 34}>표피</text>
        <text x="8" y={PAPILLARY + 40}>진피</text>
        <text x="8" y={SUBCUTIS + 24}>피하지방</text>
      </g>
    </g>
  </svg>;
}

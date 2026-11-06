import { useState, type ReactNode } from 'react';

// 색소 치료 방법: 고객에게 그림으로 보여 주며 설명하는 4단계.
// 내용은 일반적으로 확립된 피부과 사실만, 과장 없이. (효과·기간은 개인차가 있어 숫자로 약속하지 않는다.)
type StepId = 'where' | 'how' | 'devices' | 'after';
const steps: { id: StepId; title: string; lead: string }[] = [
  { id: 'where', title: '색소는 어디에 있을까', lead: '같은 갈색 반점이라도 피부 속 깊이가 달라요. 깊이에 따라 맞는 치료가 달라져요.' },
  { id: 'how', title: '레이저가 색소를 지우는 원리', lead: '레이저 빛은 색소(멜라닌)에 주로 흡수돼요. 색소만 잘게 부수고, 부서진 조각은 몸이 천천히 치워요.' },
  { id: 'devices', title: '장비마다 닿는 깊이와 역할', lead: '파장과 방식에 따라 닿는 깊이와 다루는 대상이 달라서, 색소 종류에 맞춰 장비를 골라 섞어요.' },
  { id: 'after', title: '치료 후 변화와 관리', lead: '한 번에 지워지기보다 회차를 거치며 조금씩 옅어져요. 치료 사이 관리가 결과에 영향을 줘요.' },
];

type Spot = 'epi' | 'mixed' | 'dermal';
const spots: { id: Spot; name: string; place: string; note: string }[] = [
  { id: 'epi', name: '주근깨 · 흑자 · 잡티', place: '표피(겉층)', note: '얕은 곳에 모여 있어 경계가 또렷한 편이에요.' },
  { id: 'mixed', name: '기미', place: '표피 + 진피 경계', note: '넓게 퍼져 있고, 자외선·자극에 다시 짙어질 수 있어 천천히 여러 번 다뤄요.' },
  { id: 'dermal', name: 'ABNOM · 오타모반', place: '진피(깊은 층)', note: '깊이 있어 회갈색·푸른빛으로 보이고, 깊이 닿는 파장이 필요해요.' },
];

type Beam = 'ipl' | 'alex' | 'toning' | 'pico1064' | 'frac';
const beams: { id: Beam; name: string; depth: string; role: string; x: number; to: number; width: number }[] = [
  { id: 'ipl', name: 'MaxG (빛 치료)', depth: '얕고 넓게', role: '표면의 옅은 잡티와 붉은기를 넓게 정리해요.', x: 90, to: 92, width: 70 },
  { id: 'alex', name: '노블린 755nm', depth: '표피', role: '주근깨·흑자처럼 또렷한 표피 색소를 겨냥해요.', x: 205, to: 112, width: 22 },
  { id: 'toning', name: '레블라이트 · 피코 토닝', depth: '표피 ~ 진피 윗부분', role: '낮은 에너지로 넓게, 여러 번 나눠 기미 같은 퍼진 색소를 조금씩 옅게 해요.', x: 320, to: 175, width: 64 },
  { id: 'pico1064', name: '피코 1064nm', depth: '진피', role: '깊은 층에 있는 색소(ABNOM·오타모반)를 잘게 부숴요.', x: 445, to: 245, width: 22 },
  { id: 'frac', name: '스타룩스 1540', depth: '가는 기둥 모양', role: '색소를 직접 부수기보다 작은 열 기둥으로 재생을 도와 피부결·톤을 다듬어요.', x: 555, to: 215, width: 46 },
];

// 피부 단면 바탕: 표피(위) · 경계 물결선 · 진피(아래)
function SkinBase() {
  return <>
    <rect x="0" y="40" width="640" height="250" fill="#f6ebe4" />
    <path d="M0 40 H640 V112 C600 122 570 102 530 112 S460 124 420 112 S350 100 310 112 S240 124 200 112 S130 100 90 112 S30 122 0 112 Z" fill="#f2dccb" />
    <path d="M0 112 C30 122 60 102 90 112 S160 124 200 112 S270 100 310 112 S380 124 420 112 S490 100 530 112 S600 122 640 112" fill="none" stroke="#e2c4ae" strokeWidth="1.5" />
    <rect x="0" y="36" width="640" height="6" fill="#ecd3c0" />
    <text x="628" y="70" textAnchor="end" className="sk-layer">표피</text>
    <text x="628" y="200" textAnchor="end" className="sk-layer">진피</text>
  </>;
}

function WhereDiagram({ active }: { active: Spot }) {
  const dot = (cx: number, cy: number, r: number, fill: string, key: string) => <circle key={key} cx={cx} cy={cy} r={r} fill={fill} />;
  const cluster = (x: number, y: number, n: number, spread: number, r: number, fill: string, seed: number) => Array.from({ length: n }, (_, i) => {
    const a = (i * 137.5 + seed) * Math.PI / 180, d = spread * Math.sqrt((i + 1) / n);
    return dot(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.55, r, fill, `${seed}-${i}`);
  });
  return <svg viewBox="0 0 640 300" className="sk-svg" role="img" aria-label="피부 단면: 표피의 주근깨·흑자, 표피와 진피 경계의 기미, 진피의 ABNOM·오타모반">
    <SkinBase />
    <g className={`sk-group${active === 'epi' ? ' is-on' : ''}`}>{cluster(110, 100, 22, 34, 4, '#8a5a3c', 3)}<text x="110" y="28" textAnchor="middle" className="sk-label">주근깨·흑자</text><path d="M110 32 V78" className="sk-lead" /></g>
    <g className={`sk-group${active === 'mixed' ? ' is-on' : ''}`}>{cluster(320, 104, 18, 70, 3.4, '#9a6a4a', 11)}{cluster(320, 138, 12, 60, 3, '#8d7066', 29)}<text x="320" y="28" textAnchor="middle" className="sk-label">기미</text><path d="M320 32 V80" className="sk-lead" /></g>
    <g className={`sk-group${active === 'dermal' ? ' is-on' : ''}`}>{cluster(530, 220, 20, 46, 3.6, '#6b7389', 47)}<text x="530" y="28" textAnchor="middle" className="sk-label">ABNOM·오타모반</text><path d="M530 32 V190" className="sk-lead" /></g>
  </svg>;
}

function HowDiagram() {
  const panel = (x: number, title: string, children: ReactNode) => <g transform={`translate(${x} 0)`}>
    <rect x="0" y="40" width="190" height="200" rx="14" fill="#f6ebe4" />
    <rect x="0" y="40" width="190" height="70" rx="14" fill="#f2dccb" />
    {children}
    <text x="95" y="270" textAnchor="middle" className="sk-step">{title}</text>
  </g>;
  return <svg viewBox="0 0 640 300" className="sk-svg" role="img" aria-label="1 빛이 색소에 흡수됨, 2 색소가 잘게 부서짐, 3 몸이 천천히 치움">
    {panel(10, '① 빛이 색소에 흡수', <>
      <path d="M95 0 L95 92" stroke="#e8a33c" strokeWidth="10" strokeLinecap="round" opacity=".55" />
      <circle cx="95" cy="104" r="16" fill="#8a5a3c" /><circle cx="95" cy="104" r="24" fill="none" stroke="#e8a33c" strokeWidth="2" strokeDasharray="4 4" />
    </>)}
    {panel(225, '② 색소가 잘게 부서짐', <>
      {[[80, 96], [104, 92], [92, 112], [112, 110], [74, 114], [98, 126], [118, 128], [84, 130]].map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="4.5" fill="#8a5a3c" />)}
    </>)}
    {panel(440, '③ 몸이 천천히 치워요', <>
      {[[70, 150], [118, 176], [90, 196]].map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="3" fill="#b08870" opacity=".55" />)}
      <circle cx="104" cy="152" r="18" fill="#dfe6ef" stroke="#a9b9cf" strokeWidth="2" /><circle cx="99" cy="150" r="3" fill="#b08870" />
      <path d="M60 230 C80 214 112 214 132 230" fill="none" stroke="#a9b9cf" strokeWidth="2" strokeDasharray="3 4" />
    </>)}
    <path d="M204 140 h14" stroke="#b6bcc4" strokeWidth="2" markerEnd="url(#arr)" /><path d="M419 140 h14" stroke="#b6bcc4" strokeWidth="2" markerEnd="url(#arr)" />
    <defs><marker id="arr" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#b6bcc4" /></marker></defs>
  </svg>;
}

function DevicesDiagram({ active }: { active: Beam }) {
  return <svg viewBox="0 0 640 300" className="sk-svg" role="img" aria-label="장비별로 닿는 깊이: MaxG 얕고 넓게, 노블린 755 표피, 토닝 표피에서 진피 윗부분, 피코 1064 진피, 스타룩스 1540 가는 기둥">
    <SkinBase />
    {beams.map(beam => {
      const on = beam.id === active;
      const color = on ? '#2f6fd6' : '#9aa6b5';
      if (beam.id === 'frac') return <g key={beam.id} className={`sk-beam${on ? ' is-on' : ''}`}>
        {[-18, -6, 6, 18].map(dx => <rect key={dx} x={beam.x + dx - 2.5} y={36} width="5" height={beam.to - 36} rx="2.5" fill={color} opacity={on ? .55 : .3} />)}
      </g>;
      return <g key={beam.id} className={`sk-beam${on ? ' is-on' : ''}`}>
        <path d={`M${beam.x - beam.width / 2} 0 L${beam.x + beam.width / 2} 0 L${beam.x + beam.width / 2 * (beam.id === 'ipl' ? 1.1 : .55)} ${beam.to} L${beam.x - beam.width / 2 * (beam.id === 'ipl' ? 1.1 : .55)} ${beam.to} Z`} fill={color} opacity={on ? .32 : .16} />
        <path d={`M${beam.x - 8} ${beam.to} h16`} stroke={color} strokeWidth="3" strokeLinecap="round" />
      </g>;
    })}
  </svg>;
}

function AfterPanel() {
  return <div className="tm-after">
    <div className="tm-flow">
      <h4>점 · 잡티 치료</h4>
      <ol><li><b>시술 직후</b><span>색이 잠시 더 진해 보여요</span></li><li><b>며칠 뒤</b><span>얇은 딱지가 생겨요</span></li><li><b>딱지가 떨어지면</b><span>색이 옅어져 있어요</span></li></ol>
    </div>
    <div className="tm-flow">
      <h4>토닝 (기미 · 퍼진 색소)</h4>
      <ol><li><b>시술 당일</b><span>큰 딱지 없이 가볍게 붉어질 수 있어요</span></li><li><b>회차마다</b><span>조금씩 옅어져요</span></li><li><b>마친 뒤에도</b><span>자외선·자극에 다시 짙어질 수 있어 관리가 이어져요</span></li></ol>
    </div>
    <div className="tm-care">
      <h4>치료 기간 관리</h4>
      <ul><li>자외선 차단제를 꼼꼼히, 자주 덧발라요</li><li>딱지는 억지로 떼지 않아요</li><li>세게 문지르거나 각질 제거는 잠시 쉬어요</li></ul>
      <p>피부 반응에 따라 일시적으로 색이 짙어지는 경우가 있어, 그때는 간격과 강도를 조절해요.</p>
    </div>
  </div>;
}

export function TreatmentMethod() {
  const [step, setStep] = useState<StepId>('where');
  const [spot, setSpot] = useState<Spot>('mixed');
  const [beam, setBeam] = useState<Beam>('toning');
  const current = steps.find(s => s.id === step)!;
  return <article className="tm">
    <nav className="tm-steps" aria-label="설명 단계">
      {steps.map((s, i) => <button key={s.id} type="button" aria-pressed={step === s.id} onClick={() => setStep(s.id)}><span>{i + 1}</span>{s.title}</button>)}
    </nav>
    <div className="tm-body">
      <header><h2>{current.title}</h2><p>{current.lead}</p></header>
      {step === 'where' && <>
        <WhereDiagram active={spot} />
        <div className="tm-chips">{spots.map(s => <button key={s.id} type="button" aria-pressed={spot === s.id} onClick={() => setSpot(s.id)}>{s.name}</button>)}</div>
        {(() => { const s = spots.find(x => x.id === spot)!; return <p className="tm-note"><b>{s.name}</b> · {s.place} — {s.note}</p>; })()}
      </>}
      {step === 'how' && <><HowDiagram /><p className="tm-note">부서진 색소는 피부가 새로 바뀌는 흐름과 몸의 정리 과정으로 천천히 빠져요. 그래서 한 번보다 <b>여러 번에 나눠</b> 옅게 하는 경우가 많아요.</p></>}
      {step === 'devices' && <>
        <DevicesDiagram active={beam} />
        <div className="tm-chips">{beams.map(b => <button key={b.id} type="button" aria-pressed={beam === b.id} onClick={() => setBeam(b.id)}>{b.name}</button>)}</div>
        {(() => { const b = beams.find(x => x.id === beam)!; return <p className="tm-note"><b>{b.name}</b> · {b.depth} — {b.role}</p>; })()}
      </>}
      {step === 'after' && <AfterPanel />}
    </div>
  </article>;
}

import { useRef, useState } from 'react';
import { Columns3, Expand, FolderOpen, LayoutGrid, Microscope, Shrink } from 'lucide-react';
import { TreatmentMethod } from './TreatmentMethod';
import { FinderMain, FinderPath } from './FinderFrame';
import { ToneDot, ToneFolder } from './ToneFolder';
import { findProgram, guideCategories, sessionCells, treatments, type GuideProgram } from '../programGuide';
import { formatWonAmount } from '../prepaid';
import { readWon } from '../koreanAmount';

// 상담 중 고객에게 보여 주는 프로그램 안내. 카테고리 폴더 → 프로그램 목록 → 한 화면 브리핑 / 한눈에 비교.
type View = { kind: 'root' } | { kind: 'category'; id: string } | { kind: 'program'; id: string } | { kind: 'compare'; id: string } | { kind: 'method'; id: string };

const Money = ({ won }: { won: number }) => <span className="pg-money"><b>{formatWonAmount(won)}</b><em>{readWon(won)}</em></span>;

function SessionStrip({ program }: { program: GuideProgram }) {
  const cells = sessionCells(program);
  return <div className="pg-strip" role="img" aria-label={program.parts.map(part => `${treatments[part.treatment].name} ${part.count}회`).join(', ')}>
    {cells.map((id, index) => <i key={index} data-tone={treatments[id].tone} />)}
  </div>;
}

// 치료 원리: 이 프로그램이 다루는 고민을 카드 몇 장으로. 그림 한 장 + 큰 이름 + 한 줄. 순서(회차)는 확정 자료가 없어 번호·화살표를 쓰지 않는다.
type Depth = 'top' | 'mid' | 'deep' | 'texture' | 'mole';
const goals: { ids: string[]; title: string; line: string; depth: Depth }[] = [
  { ids: ['maxgAlex'], title: '또렷한 잡티', line: '겉에 있는 잡티를 겨냥해요', depth: 'top' },
  { ids: ['maxgPico1064'], title: '깊은 색소', line: '피부 깊은 층까지 닿아요', depth: 'deep' },
  { ids: ['revlite', 'pico'], title: '기미 · 톤', line: '여러 번 나눠 조금씩 옅게', depth: 'mid' },
  { ids: ['starlux'], title: '피부결', line: '피부 재생을 도와요', depth: 'texture' },
  { ids: ['co2'], title: '점', line: '점을 얇게 깎아 없애요', depth: 'mole' },
];

function MiniSkin({ depth }: { depth: Depth }) {
  const beamTo = { top: 34, mid: 50, deep: 82, texture: 70, mole: 22 }[depth];
  return <svg viewBox="0 0 160 100" className="pg-mini" aria-hidden="true">
    <rect x="0" y="16" width="160" height="30" fill="#eef1f5" />
    <rect x="0" y="46" width="160" height="54" fill="#f7f8fa" />
    <line x1="0" y1="16" x2="160" y2="16" stroke="#c9d0d9" />
    {depth === 'top' && [58, 72, 90, 104].map(x => <circle key={x} cx={x} cy={30} r="3.2" fill="#a07f68" />)}
    {depth === 'mid' && [40, 60, 80, 100, 120].map((x, k) => <ellipse key={x} cx={x} cy={k % 2 ? 46 : 42} rx="7" ry="2.6" fill="#a07f68" opacity=".55" />)}
    {depth === 'deep' && [62, 80, 98].map(x => <circle key={x} cx={x} cy={78} r="3.4" fill="#7c7f97" />)}
    {depth === 'mole' && <ellipse cx="80" cy="18" rx="9" ry="5" fill="#8a6d5c" />}
    {depth === 'texture'
      ? [56, 68, 80, 92, 104].map(x => <line key={x} x1={x} y1="16" x2={x} y2={beamTo} stroke="#2f6fd6" strokeWidth="2.4" strokeLinecap="round" opacity=".55" />)
      : <path d={`M70 0 H90 L${depth === 'mid' ? 100 : 84} ${beamTo} H${depth === 'mid' ? 60 : 76} Z`} fill="#2f6fd6" opacity=".18" />}
  </svg>;
}

function Principle({ program }: { program: GuideProgram }) {
  const ids = [...program.parts.map(part => part.treatment), ...(program.included ?? [])];
  const count = (goalIds: string[]) => program.parts.filter(part => goalIds.includes(part.treatment)).reduce((sum, part) => sum + part.count, 0);
  const cards = goals.filter(goal => goal.ids.some(id => ids.includes(id)));
  return <div className="pg-goals" style={{ ['--n' as string]: cards.length }}>
    {cards.map(goal => { const n = count(goal.ids); const names = goal.ids.filter(id => ids.includes(id)).map(id => treatments[id].name.replace(/ \+ 비타민$/, '')).join(' · ');
      return <section key={goal.title} className="pg-goal">
        <MiniSkin depth={goal.depth} />
        <h3>{goal.title}</h3>
        <p>{goal.line}</p>
        <small>{names} <b>{n ? `${n}회` : '포함'}</b></small>
      </section>; })}
  </div>;
}

function Briefing({ program, category }: { program: GuideProgram; category: string }) {
  const [tab, setTab] = useState<'plan' | 'principle'>('plan');
  const average = Math.round(program.price / program.sessions);
  return <article className="pg-brief">
    <header className="pg-brief-head">
      <div>
        <p className="pg-kicker"><ToneDot name={category} />{category}</p>
        <h2>{program.name}{program.tag && <span className="pg-tag">{program.tag}</span>}</h2>
        <p className="pg-summary">{program.summary}</p>
      </div>
      <div className="pg-price">
        <span>총 {program.sessions}회</span>
        <Money won={program.price} />
        <small>1회 평균 {formatWonAmount(average)}</small>
      </div>
    </header>
    <div className="pg-tabs" role="tablist" aria-label="보기">
      <button type="button" role="tab" aria-selected={tab === 'plan'} onClick={() => setTab('plan')}>구성 · 금액</button>
      <button type="button" role="tab" aria-selected={tab === 'principle'} onClick={() => setTab('principle')}>치료 원리</button>
    </div>
    {tab === 'principle' ? <Principle program={program} /> : <>
    <section className="pg-block">
      <h3>구성 <small>{program.sessions}회 · 색은 시술 종류</small></h3>
      <SessionStrip program={program} />
    </section>
    <section className="pg-block">
      <h3>포함 시술</h3>
      <div className="pg-treatments">
        {program.parts.map(part => { const t = treatments[part.treatment]; return <div key={part.treatment} className="pg-treat" data-tone={t.tone}>
          <div className="pg-treat-head"><i /><b>{t.name}</b><span>{part.count}회</span></div>
          <p>{t.role}</p>
        </div>; })}
        {program.included?.map(id => { const t = treatments[id]; return <div key={id} className="pg-treat" data-tone={t.tone}>
          <div className="pg-treat-head"><i /><b>{t.name}</b><span>기본 포함</span></div>
          <p>{t.role}</p>
        </div>; })}
      </div>
    </section>
    {program.extras && <section className="pg-block pg-extras">
      <h3>추가 선택 <small>{program.extras.note}</small></h3>
      <div className="pg-extra-rows">{program.extras.options.map(option => <div key={option.label}><span>{option.label}</span><Money won={option.price} /></div>)}</div>
    </section>}
    </>}
  </article>;
}

function Compare({ programs, category }: { programs: GuideProgram[]; category: string }) {
  return <div className="pg-compare" style={{ ['--cols' as string]: programs.length }}>
    <div className="pg-compare-row pg-compare-names"><span />{programs.map(p => <b key={p.id}>{p.name}{p.tag && <span className="pg-tag">{p.tag}</span>}</b>)}</div>
    <div className="pg-compare-row"><span>횟수</span>{programs.map(p => <div key={p.id}>총 {p.sessions}회</div>)}</div>
    <div className="pg-compare-row"><span>금액</span>{programs.map(p => <div key={p.id}><Money won={p.price} /></div>)}</div>
    <div className="pg-compare-row"><span>구성</span>{programs.map(p => <div key={p.id}><SessionStrip program={p} /></div>)}</div>
    <div className="pg-compare-row pg-compare-list"><span>포함 시술</span>{programs.map(p => <ul key={p.id}>
      {p.parts.map(part => <li key={part.treatment} data-tone={treatments[part.treatment].tone}><i />{treatments[part.treatment].name}<em>{part.count}회</em></li>)}
      {p.included?.map(id => <li key={id} data-tone={treatments[id].tone}><i />{treatments[id].name}<em>포함</em></li>)}
    </ul>)}</div>
    <div className="pg-compare-row"><span>추가 선택</span>{programs.map(p => <div key={p.id} className="pg-muted">{p.extras ? p.extras.options.map(o => `${o.label.replace('추가 치료 ', '')} ${readWon(o.price)}`).join(' · ') : '—'}</div>)}</div>
    <p className="pg-muted pg-compare-note"><ToneDot name={category} />{category} 프로그램 {programs.length}가지</p>
  </div>;
}

export function ProgramGuide() {
  const [history, setHistory] = useState<{ list: View[]; at: number }>({ list: [{ kind: 'root' }], at: 0 });
  const view = history.list[history.at];
  const go = (next: View) => setHistory(({ list, at }) => ({ list: [...list.slice(0, at + 1), next], at: at + 1 }));
  const step = (delta: number) => setHistory(({ list, at }) => ({ list, at: Math.min(list.length - 1, Math.max(0, at + delta)) }));
  const root = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const toggleFull = () => {
    const el = root.current;
    if (!document.fullscreenElement && el?.requestFullscreen) void el.requestFullscreen().then(() => setFull(true)).catch(() => setFull(!full));
    else if (document.fullscreenElement) void document.exitFullscreen().then(() => setFull(false));
    else setFull(!full); // 전체화면을 못 쓰는 브라우저: 메뉴만 가린다
  };

  const category = view.kind === 'category' || view.kind === 'compare' || view.kind === 'method' ? guideCategories.find(c => c.id === view.id) : view.kind === 'program' ? findProgram(view.id)?.category : undefined;
  const program = view.kind === 'program' ? findProgram(view.id)?.program : undefined;
  const title = program?.name ?? (view.kind === 'compare' ? `${category?.name} 비교` : view.kind === 'method' ? `${category?.name} 치료 방법` : category?.name ?? '프로그램 안내');
  const parts = [{ icon: <FolderOpen size={14} strokeWidth={1.7} />, label: '프로그램 안내', onClick: view.kind !== 'root' ? () => go({ kind: 'root' }) : undefined }];
  if (category) parts.push({ icon: <ToneDot name={category.name} />, label: category.name, onClick: view.kind !== 'category' ? () => go({ kind: 'category', id: category.id }) : undefined });
  if (program) parts.push({ icon: <LayoutGrid size={14} strokeWidth={1.7} />, label: program.name, onClick: undefined });
  if (view.kind === 'method') parts.push({ icon: <Microscope size={14} strokeWidth={1.7} />, label: '치료 방법', onClick: undefined });
  const count = view.kind === 'root' ? guideCategories.length : category?.programs.length;

  const tools = <>
    {category?.id === 'pigment' && view.kind !== 'method' && <button type="button" title="치료 방법" aria-label="치료 방법" onClick={() => go({ kind: 'method', id: category.id })}><Microscope size={19} strokeWidth={1.6} /></button>}
    {category && view.kind !== 'compare' && view.kind !== 'method' && <button type="button" title="한눈에 비교" aria-label="한눈에 비교" onClick={() => go({ kind: 'compare', id: category.id })}><Columns3 size={19} strokeWidth={1.6} /></button>}
    <button type="button" title={full ? '작게 보기' : '크게 보기'} aria-label={full ? '작게 보기' : '크게 보기'} onClick={toggleFull}>{full ? <Shrink size={19} strokeWidth={1.6} /> : <Expand size={19} strokeWidth={1.6} />}</button>
  </>;

  return <div ref={root} className={`program-guide${full ? ' is-full' : ''}`}>
    <FinderMain title={title} tools={tools} path={<FinderPath parts={parts} />}
      onBack={history.at > 0 ? () => step(-1) : undefined} onForward={history.at < history.list.length - 1 ? () => step(1) : undefined}
      status={view.kind === 'program' || view.kind === 'method' ? '' : `${count ?? 0}개 항목`}>
      {view.kind === 'root' && <div className="finder-grid" style={{ ['--finder-scale' as string]: 1 }}>
        {guideCategories.map(c => <button key={c.id} type="button" className="desktop-icon" onClick={() => go({ kind: 'category', id: c.id })}>
          <div className="desktop-folder-art"><ToneFolder /></div><span><ToneDot name={c.name} />{c.name}</span>
        </button>)}
      </div>}
      {view.kind === 'category' && category && <div className="pg-list">
        {category.id === 'pigment' && <button type="button" className="pg-card pg-method-card" onClick={() => go({ kind: 'method', id: category.id })}>
          <div className="pg-card-head"><Microscope size={18} strokeWidth={1.6} /><b>색소 치료 방법</b></div>
          <p>색소가 피부 어디에 있는지, 레이저가 어떻게 지우는지, 장비마다 닿는 깊이를 그림으로 보여 줘요.</p>
          <div className="pg-card-foot"><span>그림 설명 4단계</span><span>보기 ›</span></div>
        </button>}
        {category.programs.map(p => <button key={p.id} type="button" className="pg-card" onClick={() => go({ kind: 'program', id: p.id })}>
          <div className="pg-card-head"><b>{p.name}</b>{p.tag && <span className="pg-tag">{p.tag}</span>}</div>
          <p>{p.summary}</p>
          <SessionStrip program={p} />
          <div className="pg-card-foot"><span>총 {p.sessions}회</span><Money won={p.price} /></div>
        </button>)}
      </div>}
      {view.kind === 'program' && program && category && <Briefing program={program} category={category.name} />}
      {view.kind === 'compare' && category && <Compare programs={category.programs} category={category.name} />}
      {view.kind === 'method' && <TreatmentMethod />}
    </FinderMain>
  </div>;
}

import { useRef, useState } from 'react';
import { Columns3, Expand, FolderOpen, LayoutGrid, Microscope, Shrink } from 'lucide-react';
import { ProgramDiagram, TreatmentMethod, type Beam } from './TreatmentMethod';
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

// 이 프로그램이 색소를 다루는 방식: 어떤 색소(대상) ← 어떤 시술, 그리고 시술 종류별로 옅어지는 모습.
function Principle({ program }: { program: GuideProgram }) {
  const ids = [...program.parts.map(part => part.treatment), ...(program.included ?? [])];
  const used = ids.map(id => treatments[id]);
  const show = [...new Set(used.flatMap(t => t.beams))] as Beam[];
  const has = (...keys: string[]) => ids.some(id => keys.includes(id));
  const flows = [
    has('maxgAlex', 'maxgPico1064') && { title: '또렷한 잡티 · 깊은 색소', text: '잠시 진해 보이다가 얇은 딱지가 생기고, 떨어지며 옅어져요.' },
    has('revlite', 'pico') && { title: '넓게 퍼진 색소', text: '큰 딱지 없이 회차마다 조금씩 옅어져요. 자외선에 다시 짙어질 수 있어 관리가 함께 필요해요.' },
    has('starlux') && { title: '피부결 · 재생', text: '피부가 새로 차오르며 결과 톤이 서서히 정돈돼요.' },
    has('co2') && { title: '점', text: '얇게 깎아낸 자리에 딱지가 앉았다가 떨어지며 아물어요.' },
  ].filter(Boolean) as { title: string; text: string }[];
  const count = (id: string) => program.parts.find(part => part.treatment === id)?.count;
  return <div className="pg-principle">
    <div className="pg-principle-figure">
      <ProgramDiagram show={show} co2={has('co2')} label={`${program.name}에 들어간 시술이 닿는 깊이`} />
      <p className="pg-muted">파란 빛줄기: 이 프로그램에 들어간 시술이 닿는 깊이</p>
    </div>
    <div className="pg-principle-text">
      <h3>무엇을 무엇으로</h3>
      <ul className="pg-targets">{used.map(t => <li key={t.id} data-tone={t.tone}>
        <i /><div><b>{t.target}</b><span>{t.name}{count(t.id) ? ` · ${count(t.id)}회` : ' · 기본 포함'}</span></div>
      </li>)}</ul>
    </div>
    <div className="pg-principle-flows">
      <h3>이렇게 옅어져요</h3>
      <ul className="pg-flows">{flows.map(flow => <li key={flow.title}><b>{flow.title}</b><span>{flow.text}</span></li>)}</ul>
    </div>
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

import { Paperclip, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { askConfirm } from './AlertDialog';
import { LoadingBox, SavingMark } from './Feedback';
import { StaffAvatar } from './staffTone';
import { staffGet } from '../staffApi';
import type { StaffMember } from '../staffRules';
import { EDU_DAYS, EDU_GOALS, EDU_PRINCIPLES, EDU_STAGES, type EduDay, type EduDoc, type EduTrainee, itemKey, progressOf, stageOf } from '../eduPlan';

// 신입교육(2026-11-14 사용자 지정) — 사용자가 보낸 '피부팀 신입 직원 20일 교육 일정'을 그대로 체크리스트로.
// 일차마다 팀장 교육 / 직원 교육을 나누고, 팀장 항목은 '팀장', 직원 항목은 가르친 직원 이름을 적어 체크한다.
// 평가일(5·9·12·15·20일차)은 통과 / 추가 교육. 항목마다 매뉴얼 자료(사진·PDF)를 붙여 두면 모든 신입이 같이 본다.
type State = { trainees: EduTrainee[]; docs: EduDoc[] };

async function api(path: string, method = 'GET', body?: unknown): Promise<State & { id?: number }> {
  const res = await fetch(`/api/edu${path}`, { method, cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || '처리하지 못했어요.');
  return data;
}
const docSrc = (id: number) => `/api/edu/docs/${id}/file`;
const md = (at?: number | null) => { if (!at) return ''; const d = new Date(at); return `${d.getMonth() + 1}/${d.getDate()}`; };
const mdOf = (date?: string | null) => (date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : '');
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

export default function StaffTraining() {
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<number | null>(null);
  const [stage, setStage] = useState<number | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState('');
  const [edit, setEdit] = useState<EduTrainee | 'new' | null>(null);
  const [teach, setTeach] = useState<{ key: string; text: string } | null>(null);
  const [view, setView] = useState<EduDoc | null>(null);
  const [rules, setRules] = useState(false);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2400); return () => clearTimeout(t); }, [toast]);

  const load = useCallback(async () => {
    try { const s = await api('/state'); setData(s); setError(''); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); staffGet('/list', { include_retired: 0 }).then(l => setStaff(l as StaffMember[])).catch(() => undefined); }, [load]);

  const list = data?.trainees || [];
  const cur = list.find(t => t.id === sel) || list.find(t => !progressOf(t).finished) || list[0] || null;
  const prog = cur ? progressOf(cur) : null;
  const stageN = stage ?? (prog?.current ? stageOf(prog.current).n : 1);
  const days = EDU_DAYS.filter(d => d.day >= EDU_STAGES[stageN - 1].from && d.day <= EDU_STAGES[stageN - 1].to);
  const docsBy = useMemo(() => {
    const m: Record<string, EduDoc[]> = {};
    for (const d of data?.docs || []) (m[d.item_key] ||= []).push(d);
    return m;
  }, [data?.docs]);

  const run = async (tag: string, fn: () => Promise<State>, msg?: string) => {
    setBusy(tag);
    try { setData(await fn()); if (msg) setToast(msg); } catch (e) { setToast((e as Error).message); }
    setBusy('');
  };
  const check = (key: string, on: boolean, teacher?: string) => cur && run(key, () => api('/check', 'POST', { trainee_id: cur.id, key, on, teacher }));
  const evalDay = (day: number, result: 'pass' | 'more' | null) => cur && run(`e${day}`, () => api('/eval', 'POST', { trainee_id: cur.id, day, result }));
  const upload = async (key: string, file?: File) => {
    if (!file) return;
    const fd = new FormData(); fd.set('item_key', key); fd.set('file', file); fd.set('name', file.name);
    setBusy(`doc-${key}`);
    try {
      const res = await fetch('/api/edu/docs', { method: 'POST', body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || '올리지 못했어요.');
      setData(d); setToast('자료를 붙였어요.');
    } catch (e) { setToast((e as Error).message); }
    setBusy('');
  };
  const dropDoc = async (doc: EduDoc) => {
    if (!await askConfirm({ title: '', message: doc.name, kind: 'delete' })) return;
    setView(null);
    await run('doc', () => api(`/docs/${doc.id}`, 'DELETE'), '자료를 지웠어요.');
  };

  if (error && !data) return <div className="sf-wrap ed-wrap"><div className="pending-screen"><strong>불러오지 못했어요</strong><p>{error}</p></div></div>;
  if (!data) return <div className="sf-wrap ed-wrap"><LoadingBox label="신입교육 불러오는 중" /></div>;

  const going = list.filter(t => !progressOf(t).finished), done = list.filter(t => progressOf(t).finished);
  const Person = ({ t }: { t: EduTrainee }) => { const p = progressOf(t); return <li><button type="button" aria-current={cur?.id === t.id} onClick={() => { setSel(t.id); setStage(null); }}>
    <StaffAvatar id={t.id + 100} name={t.name} size={32} />
    <span className="ed-pname"><b>{t.name}</b><small>{[t.start_date ? `${mdOf(t.start_date)} 시작` : '', p.finished ? '완료' : `${p.current}일차`].filter(Boolean).join(' · ')}</small></span>
  </button></li>; };

  return <div className="sf-wrap ed-wrap">
    <div className="ed-split">
      <nav className="ed-list" aria-label="신입 목록">
        {going.length > 0 && <><p className="ed-gt">교육 중</p><ul>{going.map(t => <Person key={t.id} t={t} />)}</ul></>}
        {done.length > 0 && <><p className="ed-gt">교육 끝</p><ul>{done.map(t => <Person key={t.id} t={t} />)}</ul></>}
        <button type="button" className="sf-btn ed-add" onClick={() => setEdit('new')}><Plus size={15} strokeWidth={2} />신입 추가</button>
      </nav>

      {!cur ? <section className="ed-main ed-empty"><p>기록 없음</p></section> : <section className="ed-main">
        <header className="ed-head">
          <div><div className="ed-title"><h2>{cur.name}</h2><span className="ed-tag">{prog!.finished ? '완료' : `${prog!.current}일차`}</span></div>
            <p className="ed-sub">{[cur.start_date ? `${mdOf(cur.start_date)} 교육 시작` : '', '20일 과정'].filter(Boolean).join(' · ')}</p></div>
          <div className="ed-head-btns"><button type="button" className="sf-btn" onClick={() => setRules(true)}>교육 원칙 · 최종 목표</button><button type="button" className="sf-btn" onClick={() => setEdit(cur)}>정보</button></div>
        </header>
        <dl className="ed-stats">
          <div><dt>진행</dt><dd><b className="iv-num">{prog!.done}</b><small className="iv-unit">/ 20일</small></dd></div>
          <div><dt>지금 단계</dt><dd className="is-text">{prog!.current ? `${stageOf(prog!.current).n}단계 ${stageOf(prog!.current).title}` : '완료'}</dd></div>
          <div><dt>다음 평가</dt><dd>{prog!.nextEval ? <><b className="iv-num">{prog!.nextEval}</b><small className="iv-unit">일차</small></> : '—'}</dd></div>
        </dl>
        <div className="sf-pills ed-stages" role="tablist" aria-label="교육 단계">
          {EDU_STAGES.map(s => <button key={s.n} type="button" role="tab" aria-selected={stageN === s.n} aria-pressed={stageN === s.n} onClick={() => setStage(s.n)}>{s.n} {s.title}<small>{s.from}~{s.to}</small></button>)}
        </div>
        <div className="ed-days">
          {days.map(d => <Day key={d.day} d={d} t={cur} isDone={prog!.dayDone(d)} isCur={prog!.current === d.day} docsBy={docsBy} busy={busy}
            onCheck={(key, role, text) => {
              if (cur.checks[key]) return void check(key, false);
              if (role === 'lead') return void check(key, true);
              setTeach({ key, text });
            }}
            onEval={evalDay} onUpload={upload} onView={setView} />)}
        </div>
      </section>}
    </div>

    {teach && <TeacherPick text={teach.text} staff={staff} onClose={() => setTeach(null)} onPick={async name => { const k = teach.key; setTeach(null); await check(k, true, name); }} />}
    {edit && <TraineeForm t={edit === 'new' ? null : edit} staff={staff} onClose={() => setEdit(null)}
      onSave={async (name, start) => {
        if (edit === 'new') { setBusy('t'); try { const s = await api('/trainees', 'POST', { name, start_date: start || null }); setData(s); setSel(s.id ?? null); setStage(null); setEdit(null); setToast('신입을 추가했어요.'); } catch (e) { setToast((e as Error).message); } setBusy(''); }
        else { await run('t', () => api(`/trainees/${edit.id}`, 'PATCH', { name, start_date: start || null }), '저장했어요.'); setEdit(null); }
      }}
      onDelete={edit === 'new' ? undefined : async () => {
        if (!await askConfirm({ title: '', message: `${edit.name} · 교육 기록`, kind: 'delete' })) return;
        await run('t', () => api(`/trainees/${edit.id}`, 'DELETE'), '지웠어요.'); setEdit(null); setSel(null);
      }} busy={busy === 't'} />}
    {view && <div className="ed-view" role="dialog" aria-modal="true" aria-label={view.name} onClick={e => { if (e.target === e.currentTarget) setView(null); }}>
      <header><strong>{view.name}</strong><span><button type="button" className="sf-btn" onClick={() => void dropDoc(view)}>삭제</button><a className="sf-btn" href={docSrc(view.id)} target="_blank" rel="noopener noreferrer">원본 열기</a><button type="button" className="iv-icon-btn" aria-label="닫기" onClick={() => setView(null)}><X size={20} /></button></span></header>
      {view.mime === 'application/pdf' ? <iframe src={docSrc(view.id)} title={view.name} /> : <img src={docSrc(view.id)} alt={view.name} />}
    </div>}
    {rules && <div className="sf-modal" role="dialog" aria-modal="true" aria-label="교육 원칙 · 최종 목표">
      <div className="sf-modal-back" onClick={() => setRules(false)} />
      <div className="sf-modal-panel ed-rules"><div className="sf-modal-head"><strong>교육 원칙 · 최종 목표</strong><button type="button" className="iv-icon-btn" aria-label="닫기" onClick={() => setRules(false)}><X size={18} /></button></div>
        <h4>공통 교육 원칙</h4><ol>{EDU_PRINCIPLES.map(p => <li key={p}>{p}</li>)}</ol>
        <h4>20일차 최종 교육 목표</h4><ul>{EDU_GOALS.map(g => <li key={g}>{g}</li>)}</ul>
      </div></div>}
    {toast && <div className="sf-toast" role="status">{toast}</div>}
  </div>;
}

function Day({ d, t, isDone, isCur, docsBy, busy, onCheck, onEval, onUpload, onView }: {
  d: EduDay; t: EduTrainee; isDone: boolean; isCur: boolean; docsBy: Record<string, EduDoc[]>; busy: string;
  onCheck: (key: string, role: 'lead' | 'staff', text: string) => void; onEval: (day: number, r: 'pass' | 'more' | null) => void;
  onUpload: (key: string, f?: File) => void; onView: (d: EduDoc) => void;
}) {
  const ev = t.evals[String(d.day)];
  const Group = ({ role, items }: { role: 'lead' | 'staff'; items: string[] }) => items.length ? <div className="ed-grp">
    <span className={`ed-role is-${role}`}>{role === 'lead' ? '팀장' : '직원'}</span>
    <ul>{items.map((text, i) => { const key = itemKey(d.day, role, i); const c = t.checks[key]; const docs = docsBy[key] || [];
      return <li key={key} className={c ? 'is-on' : ''}>
        <button type="button" className="ed-ck" role="checkbox" aria-checked={!!c} aria-label={text} disabled={busy === key} onClick={() => onCheck(key, role, text)}>{busy === key ? <SavingMark /> : c ? '✓' : ''}</button>
        <span className="ed-text">{text}
          {docs.length > 0 && <span className="ed-docs">{docs.map(doc => <button key={doc.id} type="button" className="ed-doc" onClick={() => onView(doc)}>{doc.mime === 'application/pdf' ? '📄' : '📷'} {doc.name}</button>)}</span>}</span>
        <label className="ed-clip" title="자료 붙이기" aria-label={`${text} 자료 붙이기`}>{busy === `doc-${key}` ? <SavingMark /> : <Paperclip size={15} strokeWidth={1.8} />}
          <input type="file" accept="image/*,application/pdf" onChange={e => { onUpload(key, e.target.files?.[0]); e.currentTarget.value = ''; }} /></label>
        <span className={`ed-who${c ? "" : " is-none"}`}>{c ? `${c.teacher} · ${md(c.at)}` : "—"}</span>
      </li>; })}</ul>
  </div> : null;
  return <article className={`ed-day${isDone ? ' is-done' : ''}${isCur ? ' is-cur' : ''}`}>
    <div className="ed-dh"><b>{d.day}일차</b>{d.evalItems && <span className="ed-ev">평가</span>}{d.title && <span className="ed-dt">{d.title}</span>}
      <span className="ed-dr">{isCur ? '진행 중' : isDone ? '끝' : ''}</span></div>
    <Group role="lead" items={d.lead} />
    <Group role="staff" items={d.staff} />
    {d.evalItems && <div className="ed-evbox"><b>평가</b><span>{d.evalItems}</span>
      <span className="ed-evbtn">{(['pass', 'more'] as const).map(r => <button key={r} type="button" aria-pressed={ev?.result === r} disabled={busy === `e${d.day}`} onClick={() => onEval(d.day, ev?.result === r ? null : r)}>{r === 'pass' ? '통과' : '추가 교육'}</button>)}</span>
      {ev && <small>{md(ev.at)}</small>}</div>}
  </article>;
}

function TeacherPick({ text, staff, onClose, onPick }: { text: string; staff: StaffMember[]; onClose: () => void; onPick: (name: string) => void }) {
  const [typed, setTyped] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const short = (n: string) => (n.length >= 3 ? n.slice(1) : n);
  return <div className="sf-modal" role="dialog" aria-modal="true" aria-label="가르친 직원">
    <div className="sf-modal-back" onClick={onClose} />
    <div className="sf-modal-panel ed-teach"><div className="sf-modal-head"><strong>가르친 직원</strong><button type="button" className="iv-icon-btn" aria-label="닫기" onClick={onClose}><X size={18} /></button></div>
      <p className="ed-teach-item">{text}</p>
      <div className="ed-teach-names">{staff.filter(s => !s.is_leader).map(s => <button key={s.id} type="button" className="sf-btn" onClick={() => onPick(short(s.name))}><StaffAvatar id={s.id} name={s.name} size={24} />{short(s.name)}</button>)}</div>
      <label className="sf-input"><span>직접 적기</span><input ref={ref} value={typed} maxLength={40} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && typed.trim()) onPick(typed.trim()); }} /></label>
      <div className="sf-modal-foot"><button type="button" className="sf-btn" onClick={onClose}>닫기</button><button type="button" className="sf-btn is-primary" disabled={!typed.trim()} onClick={() => onPick(typed.trim())}>확인</button></div>
    </div></div>;
}

function TraineeForm({ t, staff, onClose, onSave, onDelete, busy }: { t: EduTrainee | null; staff: StaffMember[]; onClose: () => void; onSave: (name: string, start: string) => void; onDelete?: () => void; busy: boolean }) {
  const [name, setName] = useState(t?.name || '');
  const [start, setStart] = useState(t?.start_date || today());
  return <div className="sf-modal" role="dialog" aria-modal="true" aria-label={t ? '신입 정보' : '신입 추가'}>
    <div className="sf-modal-back" onClick={onClose} />
    <div className="sf-modal-panel ed-form"><div className="sf-modal-head"><strong>{t ? '신입 정보' : '신입 추가'}</strong><button type="button" className="iv-icon-btn" aria-label="닫기" onClick={onClose}><X size={18} /></button></div>
      <div className="ed-form-grid">
        <label className="sf-input"><span>이름</span><input value={name} maxLength={40} list="ed-staff-names" onChange={e => setName(e.target.value)} /></label>
        <label className="sf-input"><span>교육 시작일</span><input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
        <datalist id="ed-staff-names">{staff.map(s => <option key={s.id} value={s.name.length >= 3 ? s.name.slice(1) : s.name} />)}</datalist>
      </div>
      <div className="sf-modal-foot">{onDelete && <button type="button" className="sf-btn ed-del" onClick={onDelete}>삭제</button>}
        <button type="button" className="sf-btn" onClick={onClose}>닫기</button>
        <button type="button" className="sf-btn is-primary" disabled={busy || !name.trim()} onClick={() => onSave(name.trim(), start)}>{busy && <SavingMark />}저장</button></div>
    </div></div>;
}

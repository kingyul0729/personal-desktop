import { SavingMark } from './Feedback';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, FileText, GalleryHorizontal, ImagePlus, List, Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import '../../styles/work.css';
import { StudyNoteText } from './StudyNoteText';

// B · 다채움피부과 업무 공간: 피부팀 업무 매뉴얼과 환자 상담자료. Stored in /api/work only,
// separate from the personal study archive (/api/study); search covers these documents only.
export type WorkKind = 'manual' | 'consult';
type Attachment = { id: string; name: string; mime: string; size: number; url: string };
export type WorkDoc = { id: string; kind: WorkKind; title: string; summary: string; content: string; createdAt: number; updatedAt: number; trashedAt: number | null; attachments: Attachment[] };
type Editor = { id: string; kind: WorkKind; title: string; summary: string; content: string; version: number; attachments: Attachment[] };
type Filter = 'all' | WorkKind | 'trash';

export const kindLabel: Record<WorkKind, string> = { manual: '업무 매뉴얼', consult: '상담자료' };
const newId = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
const dateLabel = (time: number) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(time).replace(/\s/g, '').replace(/\.$/, '');
const sizeLabel = (size: number) => size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`;
const plain = (text: string) => text.replace(/[#*_=|>-]+/g, ' ').replace(/\s+/g, ' ').trim();
const parse = async (response: Response) => {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || '연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  return data;
};

// Matches title, description, body and attachment names of one document.
export function matchesWorkDoc(doc: Pick<WorkDoc, 'title' | 'summary' | 'content' | 'attachments' | 'kind'>, query: string) {
  const q = query.trim().toLocaleLowerCase('ko');
  if (!q) return true;
  return `${doc.title} ${doc.summary} ${doc.content} ${kindLabel[doc.kind]} ${doc.attachments.map(file => file.name).join(' ')}`.toLocaleLowerCase('ko').includes(q);
}

// Offset of a slide from the selected one, wrapping so the carousel loops.
export function slideOffset(index: number, selected: number, count: number) {
  if (count <= 0) return 0;
  let offset = index - selected;
  if (offset > count / 2) offset -= count;
  if (offset < -count / 2) offset += count;
  return offset;
}

function SlideFace({ doc }: { doc: WorkDoc }) {
  const cover = doc.attachments.find(file => file.mime.startsWith('image/'));
  if (cover) return <img src={cover.url} alt="" loading="lazy" draggable={false} />;
  const pdf = doc.attachments.find(file => file.mime === 'application/pdf');
  return <div className="wl-paper">
    <span className="wl-paper-kind">{kindLabel[doc.kind]}</span>
    <strong>{doc.title}</strong>
    <p>{plain(doc.content || doc.summary).slice(0, 180) || (pdf ? 'PDF 자료' : '내용을 추가해 주세요.')}</p>
    {pdf && <span className="wl-paper-pdf"><FileText size={14} />{pdf.name}</span>}
  </div>;
}

export function WorkLibrary({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [docs, setDocs] = useState<WorkDoc[]>([]);
  const [ready, setReady] = useState(false), [authenticated, setAuthenticated] = useState(false);
  const [filter, setFilter] = useState<Filter>('all'), [query, setQuery] = useState('');
  const [view, setView] = useState<'slide' | 'list'>('slide');
  const [selected, setSelected] = useState(0);
  const [readingId, setReadingId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null), [baseline, setBaseline] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [removing, setRemoving] = useState<WorkDoc | null>(null);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const busyRef = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const swipe = useRef<{ x: number; id: number } | null>(null);
  const dirty = !!editor && (JSON.stringify(editor) !== baseline || files.length > 0);
  useEffect(() => { onDirtyChange?.(dirty || busy); return () => onDirtyChange?.(false); }, [dirty, busy, onDirtyChange]);

  const load = async (signal?: AbortSignal) => {
    setError('');
    try {
      const data = await parse(await fetch('/api/work', { cache: 'no-store', signal }));
      setDocs(data.docs); setAuthenticated(data.authenticated); setReady(true);
    } catch (e) { if ((e as Error).name !== 'AbortError') { setError((e as Error).message); setReady(true); } }
  };
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, []);

  const active = docs.filter(doc => !doc.trashedAt);
  const counts = { all: active.length, manual: active.filter(doc => doc.kind === 'manual').length, consult: active.filter(doc => doc.kind === 'consult').length, trash: docs.length - active.length };
  const visible = useMemo(() => docs.filter(doc => (filter === 'trash' ? !!doc.trashedAt : !doc.trashedAt && (filter === 'all' || doc.kind === filter)) && matchesWorkDoc(doc, query))
    .sort((a, b) => b.updatedAt - a.updatedAt), [docs, filter, query]);
  const current = visible[Math.min(selected, Math.max(0, visible.length - 1))];
  const reading = docs.find(doc => doc.id === readingId) ?? null;
  useEffect(() => { setSelected(0); }, [filter, query]);

  const move = (delta: number) => { if (visible.length) setSelected(index => (index + delta + visible.length) % visible.length); };
  const leave = (next: () => void) => {
    if (busyRef.current) return;
    if (!dirty || window.confirm('저장하지 않은 변경 사항이 있습니다. 저장하지 않고 이동할까요?')) { setEditor(null); setFiles([]); setError(''); next(); }
  };
  const openDoc = (doc: WorkDoc) => { if (doc.trashedAt) return; setReadingId(doc.id); setNotice(''); setError(''); };
  const edit = (doc?: WorkDoc) => leave(() => {
    const value: Editor = doc ? { id: doc.id, kind: doc.kind, title: doc.title, summary: doc.summary, content: doc.content, version: doc.updatedAt, attachments: doc.attachments }
      : { id: newId(), kind: filter === 'consult' ? 'consult' : 'manual', title: '', summary: '', content: '', version: 0, attachments: [] };
    setEditor(value); setBaseline(JSON.stringify(value)); setFiles([]); setNotice('');
  });
  const field = <K extends keyof Editor>(key: K, value: Editor[K]) => setEditor(state => state ? { ...state, [key]: value } : state);
  const replace = (doc: WorkDoc) => setDocs(items => [doc, ...items.filter(item => item.id !== doc.id)]);

  const addFiles = (added: File[]) => {
    if (!editor || busyRef.current) return;
    if (files.length + added.length + editor.attachments.length > 12) { setError('한 자료에 최대 12개까지 첨부할 수 있습니다.'); return; }
    if (added.some(file => !/\.(png|jpe?g|webp|pdf)$/i.test(file.name) || file.size > 10 * 1024 * 1024 || !file.size)) { setError('파일당 10MB 이하의 JPG, PNG, WEBP 또는 PDF를 선택해 주세요.'); return; }
    if ([...files, ...added].reduce((sum, file) => sum + file.size, 0) > 25 * 1024 * 1024) { setError('한 번에 추가하는 파일은 총 25MB 이하로 선택해 주세요.'); return; }
    setFiles(list => [...list, ...added]); setError('');
    if (!editor.title && added[0]) field('title', added[0].name.replace(/\.[^.]+$/, '').slice(0, 100));
  };
  const save = async () => {
    if (!editor || busyRef.current || !authenticated) return;
    if (!editor.title.trim()) { setError('제목을 입력해 주세요.'); return; }
    busyRef.current = true; setBusy(true); setError('');
    const form = new FormData();
    for (const key of ['kind', 'title', 'summary', 'content', 'version'] as const) form.set(key, String(editor[key]));
    form.set('keep', JSON.stringify(editor.attachments.map(file => file.id)));
    for (const file of files) form.append('files', file);
    try {
      const data: WorkDoc = await parse(await fetch(`/api/work/docs/${editor.id}`, { method: 'PUT', body: form }));
      replace(data); setEditor(null); setFiles([]); setReadingId(data.id); setNotice('자료를 저장했습니다.');
    } catch (e) { setError((e as Error).message); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const mutate = async (doc: WorkDoc, action: 'trash' | 'restore') => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const data: WorkDoc = await parse(await fetch(`/api/work/docs/${doc.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, version: doc.updatedAt }) }));
      replace(data); setRemoving(null); if (action === 'trash') setReadingId(null);
      setNotice(action === 'trash' ? '삭제한 자료로 옮겼습니다. 복원할 수 있습니다.' : '자료를 복원했습니다.');
    } catch (e) { setError((e as Error).message); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const onSwipeStart = (event: PointerEvent<HTMLDivElement>) => { swipe.current = { x: event.clientX, id: event.pointerId }; };
  const onSwipeEnd = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current; swipe.current = null;
    if (!start || start.id !== event.pointerId) return;
    const delta = event.clientX - start.x;
    if (Math.abs(delta) > 48) move(delta < 0 ? 1 : -1);
  };

  const header = <header className="wl-header">
    <div><h1>{editor ? editor.version ? '자료 수정' : '새 자료' : '업무 매뉴얼 · 상담자료'}</h1></div>
    {!editor && !reading && <div className="wl-header-tools">
      <label className="wl-search"><Search size={16} /><input type="search" aria-label="업무 자료 검색" value={query} onChange={event => setQuery(event.target.value)} placeholder="제목, 설명, 본문 검색" /></label>
      <div className="wl-view-toggle" role="group" aria-label="보기 방식">
        <button type="button" aria-pressed={view === 'slide'} onClick={() => setView('slide')}><GalleryHorizontal size={16} />슬라이드</button>
        <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={16} />목록</button>
      </div>
      <button type="button" className="wl-primary" onClick={() => edit()} disabled={!ready || !authenticated}><Plus size={17} />자료 추가</button>
    </div>}
  </header>;

  return <div className="work-library" onKeyDown={event => {
    if (editor && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
  }}>
    {header}
    {error && <div className="wl-alert" role="alert">{error}{!editor && <button type="button" onClick={() => void load()} disabled={busy}>다시 불러오기</button>}</div>}
    {notice && <div className="wl-notice" role="status">{notice}</div>}

    {!ready ? <div className="wl-empty"><strong>자료를 불러오는 중…</strong></div>
    : !authenticated ? <div className="wl-empty"><strong>로그인 후 업무 자료를 등록하고 열람할 수 있습니다.</strong><a className="wl-primary" href="/signin-with-chatgpt?return_to=%2F" target="_top">로그인</a></div>
    : editor ? <form className="wl-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy}>
        <div className="wl-kind-choice" role="group" aria-label="자료 종류">
          {(['manual', 'consult'] as WorkKind[]).map(kind => <button key={kind} type="button" aria-pressed={editor.kind === kind} onClick={() => field('kind', kind)}>{kindLabel[kind]}</button>)}
        </div>
        <label>제목<input value={editor.title} onChange={event => field('title', event.target.value)} maxLength={100} required placeholder="예: 레이저 토닝 시술 준비 순서" /></label>
        <label>간단한 설명<textarea value={editor.summary} onChange={event => field('summary', event.target.value)} maxLength={1000} rows={2} placeholder="슬라이드 아래에 표시할 한두 줄 설명" /></label>
        <label>본문<textarea className="wl-body-input" value={editor.content} onChange={event => field('content', event.target.value)} maxLength={100000} rows={10} placeholder={'## 소제목\n- 순서나 안내 문구를 정리해 주세요.\n| 항목 | 내용 |'} /></label>
        <div className="wl-attach-head"><strong>첨부 자료</strong><span>{editor.attachments.length + files.length} / 12 · JPG, PNG, WEBP, PDF · 파일당 10MB</span></div>
        <div className="wl-dropzone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addFiles(Array.from(event.dataTransfer.files)); }}>
          <button type="button" onClick={() => fileInput.current?.click()}><Upload size={18} />이미지 또는 PDF 추가</button>
          <input ref={fileInput} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf" onChange={event => { addFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
        </div>
        {(editor.attachments.length > 0 || files.length > 0) && <ul className="wl-files">
          {editor.attachments.map(file => <li key={file.id}><FileText size={16} /><span>{file.name}<small>{sizeLabel(file.size)} · 저장됨</small></span><button type="button" aria-label={`${file.name} 첨부 해제`} onClick={() => field('attachments', editor.attachments.filter(item => item.id !== file.id))}><X size={15} /></button></li>)}
          {files.map((file, index) => <li key={`${file.name}-${index}`}><ImagePlus size={16} /><span>{file.name}<small>{sizeLabel(file.size)} · 저장 시 첨부</small></span><button type="button" aria-label={`${file.name} 선택 취소`} onClick={() => setFiles(list => list.filter((_, i) => i !== index))}><X size={15} /></button></li>)}
        </ul>}
      </fieldset>
      <footer className="wl-editor-actions"><button type="button" onClick={() => leave(() => {})} disabled={busy}>취소</button><button type="submit" className="wl-primary" disabled={busy}>{busy ? <><SavingMark />저장 중…</> : '저장'}</button></footer>
    </form>
    : reading ? <article className="wl-reader">
      <div className="wl-reader-bar">
        <button type="button" onClick={() => { setReadingId(null); setNotice(''); }}><ArrowLeft size={16} />자료 목록</button>
        <div><button type="button" onClick={() => edit(reading)} disabled={busy}><Pencil size={15} />수정</button><button type="button" onClick={() => setRemoving(reading)} disabled={busy}><Trash2 size={15} />삭제</button></div>
      </div>
      <div className="wl-reader-scroll">
        <header><span className="wl-chip">{kindLabel[reading.kind]}</span><h2>{reading.title}</h2>{reading.summary && <p>{reading.summary}</p>}<time>최근 수정 {dateLabel(reading.updatedAt)}</time></header>
        {reading.content.trim() ? <div className="wl-reader-body"><StudyNoteText text={reading.content} /></div> : !reading.attachments.length && <p className="wl-muted">본문이 없습니다. 수정에서 내용을 추가해 주세요.</p>}
        {reading.attachments.length > 0 && <div className="wl-materials">{reading.attachments.map(file => file.mime.startsWith('image/')
          ? <figure key={file.id}><button type="button" onClick={() => setPreview(file)} aria-label={`${file.name} 크게 보기`}><img src={file.url} alt={file.name} loading="lazy" /></button><figcaption>{file.name}</figcaption></figure>
          : <figure key={file.id} className="wl-pdf"><iframe src={file.url} title={file.name} loading="lazy" /><figcaption><span>{file.name}</span><a href={file.url} target="_blank" rel="noopener noreferrer">새 창에서 열기</a></figcaption></figure>)}</div>}
      </div>
    </article>
    : <>
      <nav className="wl-kinds" aria-label="자료 분류">
        {([['all', '전체'], ['manual', '업무 매뉴얼'], ['consult', '상담자료'], ['trash', '삭제한 자료']] as [Filter, string][]).map(([id, label]) =>
          <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}<span>{counts[id]}</span></button>)}
      </nav>
      {!visible.length ? <div className="wl-empty"><strong>{query ? '검색 결과가 없습니다.' : filter === 'trash' ? '삭제한 자료가 없습니다.' : '등록된 자료가 없습니다.'}</strong>
        <span>{query ? '다른 단어로 검색해 보세요.' : filter === 'trash' ? '' : '자료 추가에서 매뉴얼이나 상담자료를 등록해 주세요.'}</span></div>
      : view === 'slide' && filter !== 'trash' ? <section className="wl-slider" aria-roledescription="carousel" aria-label="업무 자료 슬라이드">
        <div className="wl-stage" onPointerDown={onSwipeStart} onPointerUp={onSwipeEnd} onPointerCancel={() => { swipe.current = null; }}
          onKeyDown={event => { if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); } if (event.key === 'ArrowRight') { event.preventDefault(); move(1); } }}>
          <span className="wl-backdrop-title" aria-hidden="true">{current ? kindLabel[current.kind] : ''}</span>
          {visible.map((doc, index) => {
            const offset = slideOffset(index, selected, visible.length);
            if (Math.abs(offset) > 2) return null;
            const center = offset === 0;
            return <button key={doc.id} type="button" className={`wl-slide${center ? ' is-center' : ''}`} data-offset={offset}
              style={{ ['--offset' as string]: offset, ['--distance' as string]: Math.abs(offset) }}
              aria-label={center ? `${doc.title} 열기` : `${doc.title} 보기`} aria-current={center ? 'true' : undefined}
              tabIndex={center ? 0 : -1} onClick={() => center ? openDoc(doc) : setSelected(index)}>
              <SlideFace doc={doc} />
            </button>;
          })}
          <button type="button" className="wl-arrow wl-arrow-prev" aria-label="이전 자료" onClick={() => move(-1)} disabled={visible.length < 2}><ChevronLeft size={22} /></button>
          <button type="button" className="wl-arrow wl-arrow-next" aria-label="다음 자료" onClick={() => move(1)} disabled={visible.length < 2}><ChevronRight size={22} /></button>
        </div>
        {current && <div className="wl-caption" aria-live="polite">
          <div className="wl-caption-meta"><span className="wl-chip">{kindLabel[current.kind]}</span><span>{String(selected + 1).padStart(2, '0')} / {String(visible.length).padStart(2, '0')}</span></div>
          <h2>{current.title}</h2>
          <p>{current.summary || plain(current.content).slice(0, 90) || '설명이 없습니다.'}</p>
          <div className="wl-progress" role="group" aria-label="자료 위치">
            {visible.length <= 24 ? visible.map((doc, index) => <button key={doc.id} type="button" aria-label={`${index + 1}번째 자료: ${doc.title}`} aria-pressed={index === selected} onClick={() => setSelected(index)} />)
              : <input type="range" min={1} max={visible.length} value={selected + 1} aria-label="자료 위치" onChange={event => setSelected(Number(event.target.value) - 1)} />}
          </div>
          <button type="button" className="wl-open" onClick={() => openDoc(current)}>자료 열기</button>
        </div>}
      </section>
      : <div className="wl-list-wrap"><table className="wl-list">
        <thead><tr><th scope="col">종류</th><th scope="col">제목</th><th scope="col" className="wl-col-summary">설명</th><th scope="col">수정일</th><th scope="col"><span className="sr-only">작업</span></th></tr></thead>
        <tbody>{visible.map(doc => <tr key={doc.id}>
          <td><span className="wl-chip">{kindLabel[doc.kind]}</span></td>
          <th scope="row">{doc.trashedAt ? doc.title : <button type="button" className="wl-link" onClick={() => openDoc(doc)}>{doc.title}</button>}</th>
          <td className="wl-col-summary">{doc.summary || plain(doc.content).slice(0, 60)}</td>
          <td className="wl-nowrap">{dateLabel(doc.updatedAt)}</td>
          <td className="wl-nowrap">{doc.trashedAt ? <button type="button" className="wl-small" onClick={() => void mutate(doc, 'restore')} disabled={busy}>복원</button>
            : <><button type="button" className="wl-small" onClick={() => edit(doc)} disabled={busy}>수정</button><button type="button" className="wl-small" onClick={() => setRemoving(doc)} disabled={busy}>삭제</button></>}</td>
        </tr>)}</tbody>
      </table></div>}
    </>}

    {removing && <div className="wl-modal-backdrop"><div className="wl-modal" role="dialog" aria-modal="true" aria-labelledby="wl-remove-title">
      <h2 id="wl-remove-title">자료를 삭제할까요?</h2><p>‘{removing.title}’을 삭제한 자료로 옮깁니다. 다시 복원할 수 있습니다.</p>
      <footer><button type="button" onClick={() => setRemoving(null)} disabled={busy}>취소</button><button type="button" className="wl-primary" onClick={() => void mutate(removing, 'trash')} disabled={busy}>{busy ? <><SavingMark />이동 중…</> : '삭제한 자료로 이동'}</button></footer>
    </div></div>}
    {preview && <div className="wl-preview" role="dialog" aria-modal="true" aria-label={preview.name} onClick={event => { if (event.target === event.currentTarget) setPreview(null); }}>
      <header><strong>{preview.name}</strong><button type="button" onClick={() => setPreview(null)} aria-label="미리보기 닫기"><X size={20} /></button></header>
      <img src={preview.url} alt={preview.name} />
    </div>}
  </div>;
}

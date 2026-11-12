import { askConfirm } from './AlertDialog';
import { SavingMark } from './Feedback';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ArrowLeft, FileText, Folder, ImagePlus, Pencil, Plus, Presentation, Search, Trash2, Upload, X } from 'lucide-react';
import { FinderMain, FinderPath } from './FinderFrame';
import { ToneFolder } from './ToneFolder';
import { announceTrash, useTrashChange } from '../trash';
import '../../styles/work.css';
import { StudyNoteText } from './StudyNoteText';

// B · 다채움피부과 업무 공간: 피부팀 업무 매뉴얼과 환자 상담자료. Stored in /api/work only,
// separate from the personal study archive (/api/study); search covers these documents only.
export type WorkKind = 'manual' | 'consult';
type Attachment = { id: string; name: string; mime: string; size: number; url: string };
export type WorkDoc = { id: string; kind: WorkKind; title: string; summary: string; content: string; createdAt: number; updatedAt: number; trashedAt: number | null; attachments: Attachment[] };
type Editor = { id: string; kind: WorkKind; title: string; summary: string; content: string; version: number; attachments: Attachment[] };
type Filter = 'all' | WorkKind;

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


export function WorkLibrary({ onDirtyChange, onSubs, goto, onLocation }: { onDirtyChange?: (dirty: boolean) => void; onSubs?: (list: { id: string; name: string; count?: number }[]) => void; goto?: { id: string; n: number }; onLocation?: (id: string) => void }) {
  const [docs, setDocs] = useState<WorkDoc[]>([]);
  const [ready, setReady] = useState(false), [authenticated, setAuthenticated] = useState(false);
  const [filter, setFilter] = useState<Filter>('all'), [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [scale, setScale] = useState(100);
  const [readingId, setReadingId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null), [baseline, setBaseline] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [removing, setRemoving] = useState<WorkDoc | null>(null);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const busyRef = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
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
  useTrashChange('work', () => void load());

  const active = docs.filter(doc => !doc.trashedAt);
  const counts = { all: active.length, manual: active.filter(doc => doc.kind === 'manual').length, consult: active.filter(doc => doc.kind === 'consult').length };
  // 왼쪽 메뉴 아코디언: 업무 매뉴얼 · 상담자료
  useEffect(() => { onSubs?.([{ id: 'manual', name: '업무 매뉴얼', count: counts.manual }, { id: 'consult', name: '상담자료', count: counts.consult }]); }, [counts.manual, counts.consult]);
  useEffect(() => { onLocation?.(filter); }, [filter]);
  const visible = useMemo(() => docs.filter(doc => !doc.trashedAt && (filter === 'all' || doc.kind === filter) && matchesWorkDoc(doc, query))
    .sort((a, b) => b.updatedAt - a.updatedAt), [docs, filter, query]);
  const reading = docs.find(doc => doc.id === readingId && !doc.trashedAt) ?? null;
  const leave = async (next: () => void) => {
    if (busyRef.current) return;
    if (!dirty || await askConfirm({ title: '저장하지 않고 이동할까요?', message: '저장하지 않은 변경 사항이 있어요.' })) { setEditor(null); setFiles([]); setError(''); next(); }
  };
  useEffect(() => { if (goto) leave(() => { setReadingId(null); setFilter(goto.id as Filter); }); }, [goto?.n]);
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
      announceTrash('work');
      setNotice(action === 'trash' ? '휴지통으로 옮겼습니다. 휴지통에서 복원할 수 있습니다.' : '자료를 복원했습니다.');
    } catch (e) { setError((e as Error).message); }
    finally { busyRef.current = false; setBusy(false); }
  };
  // 휴지통으로 옮기기 전 확인 팝업(AlertDialog, 2026-11-12 사용자 지정 모양)
  useEffect(() => {
    if (!removing) return;
    let live = true;
    void askConfirm({ title: '자료를 삭제할까요?', message: `‘${removing.title}’ · 휴지통에서 복원할 수 있어요.`, kind: 'delete' }).then(ok => { if (!live) return; if (ok) void mutate(removing, 'trash').finally(() => setRemoving(null)); else setRemoving(null); });
    return () => { live = false; };
  }, [removing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Finder 모양: 처음엔 분류 폴더(업무 매뉴얼·상담자료), 폴더를 열면 자료 썸네일. ‹ 는 한 단계 위로.
  const inFolder = filter !== 'all';
  const showingFolders = !inFolder && !query.trim();
  const title = editor ? (editor.version ? '자료 수정' : '새 자료') : reading ? reading.title : query.trim() ? '검색 결과' : inFolder ? kindLabel[filter] : '업무 자료';
  const up = editor ? () => leave(() => {}) : reading ? () => { setReadingId(null); setNotice(''); } : query.trim() ? () => { setQuery(''); setSearching(false); } : inFolder ? () => setFilter('all') : undefined;
  const pathParts = [{ icon: <Presentation size={14} strokeWidth={1.7} />, label: '업무 자료', onClick: inFolder || reading || editor ? () => leave(() => { setReadingId(null); setFilter('all'); }) : undefined },
    ...(inFolder ? [{ icon: <Folder size={14} strokeWidth={1.7} />, label: kindLabel[filter], onClick: reading ? () => setReadingId(null) : undefined }] : []),
    ...(reading ? [{ icon: <FileText size={14} strokeWidth={1.7} />, label: reading.title }] : [])];
  const tools = editor || reading ? undefined : <>
    {authenticated && <button type="button" aria-label="자료 추가" title="자료 추가" onClick={() => edit()} disabled={!ready}><Plus size={20} strokeWidth={1.6} /></button>}
    {searching || query ? <label className="finder-search"><Search size={15} /><input autoFocus type="search" aria-label="업무 자료 검색" placeholder="검색" value={query}
      onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setQuery(''); setSearching(false); } }} onBlur={() => { if (!query) setSearching(false); }} />
      {query && <button type="button" aria-label="검색어 지우기" onClick={() => { setQuery(''); setSearching(false); }}><X size={14} /></button>}</label>
      : <button type="button" className="finder-search-button" aria-label="검색" title="검색" onClick={() => setSearching(true)}><Search size={19} strokeWidth={1.6} /></button>}
  </>;
  const count = showingFolders ? 2 : visible.length;

  return <FinderMain title={title} onBack={up} tools={tools} path={<FinderPath parts={pathParts} />}
    status={editor || reading ? undefined : <>{count}개 항목{notice ? ` · ${notice}` : ''}</>} scale={editor || reading ? undefined : scale} onScale={setScale}>
  <div className="work-library wl-finder" onKeyDown={event => {
    if (editor && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
  }}>
    {error && <div className="wl-alert" role="alert">{error}{!editor && <button type="button" onClick={() => void load()} disabled={busy}>다시 불러오기</button>}</div>}
    {notice && (editor || reading) && <div className="wl-notice" role="status">{notice}</div>}

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
        <button type="button" onClick={() => { setReadingId(null); setNotice(''); }}><ArrowLeft size={16} />{kindLabel[reading.kind]}</button>
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
    : <div className={showingFolders ? 'finder-grid' : 'finder-grid pf-thumb-grid'} style={{ ['--finder-scale' as string]: scale / 100 }}>
      {showingFolders ? (['manual', 'consult'] as WorkKind[]).map(kind => <button key={kind} type="button" className="desktop-icon" onClick={() => setFilter(kind)}>
        <div className="desktop-folder-art"><ToneFolder /></div>
        <span>{kindLabel[kind]}<small className="wl-folder-count">{counts[kind]}</small></span>
      </button>)
      : !visible.length ? <p className="finder-empty">{query ? '검색 결과가 없습니다.' : '자료가 없습니다. 위쪽 + 버튼으로 추가해 주세요.'}</p>
      : visible.map(doc => { const cover = doc.attachments.find(file => file.mime.startsWith('image/')); return <div key={doc.id} className="pf-thumb">
        <button type="button" className="pf-thumb-open" onClick={() => openDoc(doc)} aria-label={`${doc.title} 열기`}>
          <span className="pf-thumb-image wl-thumb">{cover ? <img src={cover.url} alt="" loading="lazy" /> : <span className="wl-thumb-paper"><FileText size={22} strokeWidth={1.5} /><span>{doc.summary || plain(doc.content).slice(0, 70) || (doc.attachments.length ? 'PDF 자료' : '')}</span></span>}</span>
          <span className="pf-thumb-name">{doc.title}</span>
          {query.trim() && <span className="pf-thumb-folder">{kindLabel[doc.kind]}</span>}
        </button>
      </div>; })}
    </div>}

    {preview && <div className="wl-preview" role="dialog" aria-modal="true" aria-label={preview.name} onClick={event => { if (event.target === event.currentTarget) setPreview(null); }}>
      <header><strong>{preview.name}</strong><button type="button" onClick={() => setPreview(null)} aria-label="미리보기 닫기"><X size={20} /></button></header>
      <img src={preview.url} alt={preview.name} />
    </div>}
  </div>
  </FinderMain>;
}

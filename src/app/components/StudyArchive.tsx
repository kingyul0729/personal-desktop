import { askConfirm } from './AlertDialog';
import { DownloadMark, SavingMark } from './Feedback';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, Eraser, FileText, FolderOpen, ImagePlus, LayoutGrid, Layers, Pencil, Plus, Search, Star, Trash2, Undo2, Upload, X } from 'lucide-react';
import '../../styles/study.css';
import { StudyNoteText } from './StudyNoteText';
import { INK_COLORS, InkLayer, NOTE_W, parseInk, type InkTool, type Stroke } from './StudyInk';
import { announceTrash, useTrashChange } from '../trash';
import { FinderMain, FinderPath } from './FinderFrame';
import { ToneDot, ToneFolder } from './ToneFolder';

type Attachment = { id: string; name: string; mime: string; size: number; url: string };
type RecordItem = { id: string; title: string; category: string; studiedOn: string; content: string; tags: string; keywords: string; summary: string; ink?: string; favorite: number; createdAt: number; updatedAt: number; trashedAt: number | null; attachments: Attachment[] };
type Editor = { id: string; title: string; category: string; studiedOn: string; content: string; tags: string; keywords: string; summary: string; version: number; attachments: Attachment[] };
export const STUDY_CATEGORIES = ['피부 기초', '색소·레이저', '홍조·혈관', '여드름·흉터', '리프팅', '스킨부스터', '상담·기타'];
const newRecordId = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dateLabel = (date: string) => date.replaceAll('-', '.');
const sizeLabel = (size: number) => size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`;
const parse = async (response: Response) => {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || '연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  return data;
};
// 자료 유형: 첨부가 있으면 이미지·PDF, 없으면 노트.
export const studyType = (item: Pick<RecordItem, 'attachments'>) => {
  const image = item.attachments.some(file => file.mime.startsWith('image/')), pdf = item.attachments.some(file => file.mime === 'application/pdf');
  return image && pdf ? '이미지·PDF' : image ? '이미지 자료' : pdf ? 'PDF 자료' : '공부 노트';
};

// Stacked cards: the selected card sits in front, the others fan out behind it on both sides.

const toEditor = (item: RecordItem): Editor => ({ id: item.id, title: item.title, category: item.category, studiedOn: item.studiedOn, content: item.content, tags: item.tags, keywords: item.keywords || '', summary: item.summary || '', version: item.updatedAt, attachments: item.attachments });

export function StudyArchive({ onDirtyChange, onSubs, goto, onLocation }: { onDirtyChange?: (dirty: boolean) => void; onSubs?: (list: { id: string; name: string; count?: number }[]) => void; goto?: { id: string; n: number }; onLocation?: (id: string) => void }) {
  const [readingId, setReadingId] = useState<string | null>(null);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [ready, setReady] = useState(false), [authenticated, setAuthenticated] = useState(false);
  const [category, setCategory] = useState(''), [filter, setFilter] = useState<'all' | 'favorite' | 'trash'>('all');
  const [query, setQuery] = useState(''), [sort, setSort] = useState('date');
  const [editor, setEditor] = useState<Editor | null>(null), [baseline, setBaseline] = useState('');
  const [files, setFiles] = useState<File[]>([]), [preview, setPreview] = useState<Attachment | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [removing, setRemoving] = useState<RecordItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const [readingSize, setReadingSize] = useState(16);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const reading = records.find(item => item.id === readingId && !item.trashedAt);
  const busyRef = useRef(false);
  // 노트 종이는 폭 NOTE_W로 고정해 놓고 화면 폭에 맞춰 통째로 줄인다(글 줄바꿈이 기기마다 같아야 펜 필기가 제자리에 보임). 휴대폰 폭은 한 단으로 흘려 보내고 펜은 숨긴다.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fitW, setFitW] = useState(0);
  const flow = fitW > 0 && fitW < 520;
  const zoom = flow || !fitW ? 1 : Math.min(1.15, fitW / NOTE_W) * readingSize / 16;
  const [pen, setPen] = useState<InkTool | null>(null), [ink, setInk] = useState<Stroke[]>([]);
  const inkJob = useRef<{ id: string; text: string } | null>(null), inkBusy = useRef(false), inkTimer = useRef(0), recordsRef = useRef(records);
  recordsRef.current = records;
  const flushInk = async () => {
    if (inkBusy.current) return;
    inkBusy.current = true;
    try {
      while (inkJob.current) {
        const job = inkJob.current; inkJob.current = null;
        const record = recordsRef.current.find(item => item.id === job.id); if (!record || record.trashedAt) break;
        const data = await parse(await fetch(`/api/study/records/${job.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ink', ink: job.text, version: record.updatedAt }) }));
        recordsRef.current = recordsRef.current.map(item => item.id === data.id ? data : item); setRecords(items => items.map(item => item.id === data.id ? data : item));
      }
    } catch (e) { setError((e as Error).message); }
    finally { inkBusy.current = false; }
  };
  const changeInk = (next: Stroke[]) => {
    if (!readingId) return;
    setInk(next); inkJob.current = { id: readingId, text: next.length ? JSON.stringify(next) : '' };
    window.clearTimeout(inkTimer.current); inkTimer.current = window.setTimeout(() => void flushInk(), 700);
  };
  useEffect(() => {
    setInk(parseInk(recordsRef.current.find(item => item.id === readingId)?.ink)); setPen(null);
    return () => { window.clearTimeout(inkTimer.current); void flushInk(); };
  }, [readingId]);
  const readerOpen = !!reading && !editor;
  useEffect(() => {
    const box = scrollRef.current; if (!box || typeof ResizeObserver === 'undefined') return;
    const measure = () => { const style = getComputedStyle(box); setFitW(Math.max(0, box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))); };
    const watch = new ResizeObserver(measure); watch.observe(box); measure(); return () => watch.disconnect();
  }, [readerOpen]);
  const dirty = !!editor && (JSON.stringify(editor) !== baseline || files.length > 0);
  useEffect(() => { onDirtyChange?.(dirty || busy); return () => onDirtyChange?.(false); }, [dirty, busy, onDirtyChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || busyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const load = async (signal?: AbortSignal) => {
    setError('');
    try {
      const data = await parse(await fetch('/api/study', { cache: 'no-store', signal }));
      setRecords(data.records); setAuthenticated(data.authenticated); setReady(true);
    } catch (e) { if ((e as Error).name !== 'AbortError') setError((e as Error).message); }
  };
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, []);
  useTrashChange('study', () => void load());
  const active = records.filter(item => !item.trashedAt);
  const folders = [...new Set([...STUDY_CATEGORIES, ...records.map(item => item.category)])];
  const counts = new Map(folders.map(name => [name, active.filter(item => item.category === name).length]));
  // 왼쪽 메뉴 아코디언: 주제 목록을 알리고, 메뉴에서 고른 주제로 이동
  const subKey = folders.map(name => `${name}:${counts.get(name)}`).join('|');
  useEffect(() => { onSubs?.(folders.map(name => ({ id: `cat:${name}`, name, count: counts.get(name) }))); }, [subKey]);
  useEffect(() => { onLocation?.(filter === 'all' ? (category ? `cat:${category}` : 'all') : filter); }, [filter, category]);
  const filtered = useMemo(() => records.filter(item => {
    if (filter === 'trash' ? !item.trashedAt : !!item.trashedAt) return false;
    if (filter === 'favorite' && !item.favorite) return false;
    if (category && item.category !== category) return false;
    return `${item.title} ${item.content} ${item.keywords || ''} ${item.summary || ''} ${item.category} ${item.tags} ${item.attachments.map(file => file.name).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'ko') : sort === 'updated' ? b.updatedAt - a.updatedAt : b.studiedOn.localeCompare(a.studiedOn) || b.updatedAt - a.updatedAt), [records, filter, category, query, sort]);
  const leave = async (next: () => void) => { if (busyRef.current) return; if (!dirty || await askConfirm({ title: '저장하지 않고 이동할까요?', message: '저장하지 않은 변경 사항이 있어요.' })) { setEditor(null); setFiles([]); setError(''); next(); } };
  const open = (record?: RecordItem) => leave(() => {
    setReadingId(record?.id || null);
    const value: Editor = record ? toEditor(record) : { id: newRecordId(), title: '', category: category || STUDY_CATEGORIES[0], studiedOn: today(), content: '', tags: '', keywords: '', summary: '', version: 0, attachments: [] };
    setEditor(value); setBaseline(JSON.stringify(value)); setFiles([]); setNotice('');
  });
  const navigate = (next: typeof filter, folder = '') => leave(() => { setReadingId(null); setFilter(next); setCategory(folder); setNotice(''); });
  useEffect(() => { if (!goto) return; if (goto.id.startsWith('cat:')) navigate('all', goto.id.slice(4)); else navigate(goto.id as typeof filter); }, [goto?.n]);
  const field = (key: keyof Editor, value: string) => setEditor(current => current ? { ...current, [key]: value } : current);
  const updateRecord = (record: RecordItem) => setRecords(items => [record, ...items.filter(item => item.id !== record.id)]);
  const mutate = async (record: RecordItem, action: 'trash' | 'restore' | 'favorite') => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const data = await parse(await fetch(`/api/study/records/${record.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, version: record.updatedAt }) }));
      updateRecord(data); setRemoving(null);
      if (action !== 'favorite') announceTrash('study');
      setNotice(action === 'trash' ? '휴지통으로 옮겼습니다. 휴지통에서 복원할 수 있어요.' : action === 'restore' ? '공부 기록을 복원했습니다.' : data.favorite ? '즐겨찾기에 추가했습니다.' : '즐겨찾기에서 해제했습니다.');
    } catch (e) { setError((e as Error).message); }
    finally { busyRef.current = false; setBusy(false); }
  };
  // 휴지통으로 옮기기 전 확인 팝업(AlertDialog, 2026-11-12 사용자 지정 모양)
  useEffect(() => {
    if (!removing) return;
    let live = true;
    void askConfirm({ title: '기록을 삭제할까요?', message: `‘${removing.title}’ · 첨부 자료도 함께 옮겨요. 휴지통에서 복원할 수 있어요.`, kind: 'delete' }).then(ok => { if (!live) return; if (ok) void mutate(removing, 'trash').finally(() => setRemoving(null)); else setRemoving(null); });
    return () => { live = false; };
  }, [removing]); // eslint-disable-line react-hooks/exhaustive-deps
  const addFiles = (added: File[]) => {
    if (!editor || busyRef.current) return;
    if (files.length + added.length + editor.attachments.length > 12) { setError('한 기록에 최대 12개까지 첨부할 수 있습니다.'); return; }
    if (added.some(file => !/\.(png|jpe?g|webp|pdf)$/i.test(file.name) || file.size > 10 * 1024 * 1024 || !file.size)) { setError('파일당 10MB 이하의 JPG, PNG, WEBP 또는 PDF를 선택해 주세요.'); return; }
    if ([...files, ...added].reduce((sum, file) => sum + file.size, 0) > 25 * 1024 * 1024) { setError('한 번에 추가하는 파일은 총 25MB 이하로 선택해 주세요.'); return; }
    setFiles(current => [...current, ...added]); setError('');
    // 정리한 노트 사진만 올릴 때: 제목이 비어 있으면 첫 파일 이름으로 채운다(고칠 수 있음)
    if (added[0]) setEditor(current => current && !current.title.trim() ? { ...current, title: added[0].name.replace(/\.[^.]+$/, '').slice(0, 100) || '노트' } : current);
    if (!editor.title && added[0]) field('title', added[0].name.replace(/\.[^.]+$/, '').slice(0, 100));
  };
  const save = async () => {
    if (!editor || busyRef.current || !authenticated) return;
    if (!editor.title.trim() || !editor.category.trim() || !editor.studiedOn) { setError('제목, 분류와 공부 날짜를 입력해 주세요.'); return; }
    busyRef.current = true; setBusy(true); setError('');
    const form = new FormData();
    for (const key of ['title', 'category', 'studiedOn', 'content', 'tags', 'keywords', 'summary', 'version'] as const) form.set(key, String(editor[key]));
    form.set('keep', JSON.stringify(editor.attachments.map(file => file.id)));
    for (const file of files) form.append('files', file);
    try {
      const data = await parse(await fetch(`/api/study/records/${editor.id}`, { method: 'PUT', body: form }));
      updateRecord(data); setReadingId(data.id); setEditor(null); setFiles([]); setFilter('all'); setCategory(data.category); setQuery(''); setNotice('공부 기록을 저장했습니다.');
    } catch (e) { setError((e as Error).message); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const importText = async (file?: File) => {
    if (!file || !editor || busyRef.current) return;
    if (!/\.(md|markdown|txt)$/i.test(file.name) || file.size > 800 * 1024) {
      setError('800KB 이하의 Markdown 또는 텍스트 파일을 선택해 주세요.'); return;
    }
    if (editor.content.trim() && !await askConfirm({ title: '본문을 바꿀까요?', message: '현재 본문을 가져온 파일 내용으로 바꿔요.' })) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const content = (await file.text()).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
      if (content.length > 100000 || content.includes('\u0000')) throw new Error('본문은 10만 자 이하의 텍스트여야 합니다.');
      setEditor(current => current ? { ...current, content, title: current.title || file.name.replace(/\.[^.]+$/, '').slice(0, 100) } : current);
    } catch (error) { setError((error as Error).message || '파일을 읽지 못했습니다.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const insertNoteFormat = (value: string) => {
    if (!editor || busyRef.current) return;
    const input = noteRef.current;
    const start = input?.selectionStart ?? editor.content.length;
    const end = input?.selectionEnd ?? start;
    const content = editor.content.slice(0, start) + value + editor.content.slice(end);
    if (content.length > 100000) { setError('본문은 10만 자 이하로 작성해 주세요.'); return; }
    field('content', content); input?.focus();
  };
  // Finder 모양(가격표와 같게): 처음엔 주제 폴더, 폴더를 열면 기록 썸네일. ‹ 는 한 단계 위로.
  const [searching, setSearching] = useState(false);
  const [scale, setScale] = useState(100);
  const inFolder = !!category || filter === 'favorite';
  const showingFolders = !inFolder && !query.trim() && !editor && !reading;
  const place = category || (filter === 'favorite' ? '즐겨찾기' : '');
  const finderTitle = editor ? (editor.version ? '기록 수정' : '새 공부 기록') : reading ? reading.title : query.trim() ? '검색 결과' : place || '공부 보관함';
  const up = editor ? () => leave(() => {}) : reading ? () => { setReadingId(null); setNotice(''); } : query.trim() ? () => { setQuery(''); setSearching(false); } : inFolder ? () => navigate('all') : undefined;
  const pathParts = [{ icon: <BookOpen size={14} strokeWidth={1.7} />, label: '공부 보관함', onClick: inFolder || reading || editor ? () => leave(() => { setReadingId(null); setFilter('all'); setCategory(''); }) : undefined },
    ...(place ? [{ icon: <FolderOpen size={14} strokeWidth={1.7} />, label: place, onClick: reading ? () => setReadingId(null) : undefined }] : []),
    ...(reading ? [{ icon: <FileText size={14} strokeWidth={1.7} />, label: reading.title }] : [])];
  const favorites = active.filter(item => item.favorite).length;
  const tools = editor || reading || !authenticated ? undefined : <>
    <button type="button" aria-label="기록 추가" title="기록 추가" onClick={() => open()} disabled={!ready}><Plus size={20} strokeWidth={1.6} /></button>
    {searching || query ? <label className="finder-search"><Search size={15} /><input autoFocus type="search" aria-label="공부 기록 검색" placeholder="검색" value={query}
      onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setQuery(''); setSearching(false); } }} onBlur={() => { if (!query) setSearching(false); }} />
      {query && <button type="button" aria-label="검색어 지우기" onClick={() => { setQuery(''); setSearching(false); }}><X size={14} /></button>}</label>
      : <button type="button" className="finder-search-button" aria-label="검색" title="검색" onClick={() => setSearching(true)}><Search size={19} strokeWidth={1.6} /></button>}
  </>;
  const itemCount = showingFolders ? folders.length + (favorites ? 1 : 0) : filtered.length;

  return <FinderMain title={finderTitle} onBack={up} tools={tools} path={<FinderPath parts={pathParts} />}
    status={editor || reading ? undefined : <>{itemCount}개 항목{notice ? ` · ${notice}` : ''}</>} scale={editor || reading ? undefined : scale} onScale={setScale}>
  <div className={`study-archive study-finder${reading && !editor ? ' study-reading' : ''}`} onKeyDown={event => { if (editor && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); } }}>
    <main className="study-main">
      {error && <div className="study-alert" role="alert">{error}{!editor && <button onClick={() => void load()} disabled={busy}>목록 새로고침</button>}</div>}
      {notice && (editor || reading) && <div className="study-notice" role="status"><Check size={16} />{notice}</div>}
      {!ready ? <div className="study-empty"><BookOpen size={32} /><strong>{error ? '보관함을 불러오지 못했어요' : '보관함을 불러오는 중…'}</strong></div>
      : !authenticated ? <div className="study-empty"><img src="/icons/pink-folder-ribbon.png" alt="" /><h2>나만의 공부 기록을 시작해요</h2><p>이미지·PDF와 공부 메모를 저장하고<br />다른 기기에서도 같은 계정으로 열어보세요.</p><a className="study-primary" href="/signin-with-chatgpt?return_to=%2F" target="_top">로그인하고 시작하기</a></div>
      : editor ? <form className="study-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="study-editor-bar"><button type="button" onClick={() => leave(() => {})} disabled={busy}><ArrowLeft size={16} />{reading ? '노트로 돌아가기' : '목록으로'}</button><span>{dirty ? '저장 전' : editor.version ? '저장된 기록' : '새 기록'}</span><button type="submit" className="study-primary" disabled={busy}>{busy ? <><SavingMark />저장 중…</> : '기록 저장'}</button></div>
        <fieldset disabled={busy}>
          <label className="study-title-label">제목<input value={editor.title} onChange={event => field('title', event.target.value)} placeholder="어떤 내용을 공부했나요?" maxLength={100} required /></label>
          <div className="study-fields"><label>분류<input value={editor.category} onChange={event => field('category', event.target.value)} list="study-categories" maxLength={40} placeholder="선택하거나 새 분류 입력" required /><datalist id="study-categories">{folders.map(name => <option key={name} value={name} />)}</datalist></label><label>공부 날짜<input type="date" value={editor.studiedOn} onChange={event => field('studiedOn', event.target.value)} required /></label></div>
          <label>태그<input value={editor.tags} onChange={event => field('tags', event.target.value)} placeholder="예: 피부 구조, 복습, 원리 정리" maxLength={300} /></label>
          <label>핵심 키워드 · 질문<textarea value={editor.keywords} onChange={event => field('keywords', event.target.value)} placeholder="핵심 개념이나 복습 질문을 한 줄씩 적어 주세요." maxLength={5000} rows={3} /></label>
          <div className="study-section-label"><strong>첨부 자료</strong><span>{editor.attachments.length + files.length} / 12</span></div>
          <div className="study-upload" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addFiles(Array.from(event.dataTransfer.files)); }}>
            <button type="button" onClick={() => inputRef.current?.click()}><Upload size={20} /><strong>이미지 또는 PDF 추가</strong><span>눌러서 선택하거나 파일을 끌어 놓으세요</span></button>
            <small>JPG · PNG · WEBP · PDF / 파일당 10MB</small>
            <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf" multiple hidden onChange={event => { addFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
          </div>
          {(editor.attachments.length > 0 || files.length > 0) && <div className="study-files">
            {editor.attachments.map(file => <div key={file.id} className="study-file"><button type="button" className="study-file-open" onClick={() => setPreview(file)}>{file.mime.startsWith('image/') ? <img src={file.url} alt="" /> : <FileText size={26} />}<span><strong>{file.name}</strong><small>{sizeLabel(file.size)} · 저장됨</small></span></button><button type="button" aria-label={`${file.name} 첨부 해제`} onClick={() => setEditor(current => current ? { ...current, attachments: current.attachments.filter(item => item.id !== file.id) } : current)}><X size={16} /></button></div>)}
            {files.map((file, index) => <div key={`${file.name}-${index}`} className="study-file"><ImagePlus size={24} /><span><strong>{file.name}</strong><small>{sizeLabel(file.size)} · 저장 시 첨부</small></span><button type="button" aria-label={`${file.name} 선택 취소`} onClick={() => setFiles(items => items.filter((_, i) => i !== index))}><X size={16} /></button></div>)}
          </div>}
          <div className="study-format-tools" aria-label="본문 서식">
            <button type="button" onClick={() => insertNoteFormat('\n# 1강 제목\n')}>강</button>
            <button type="button" onClick={() => insertNoteFormat('\n## 소제목\n')}>소제목</button>
            <button type="button" onClick={() => insertNoteFormat('\n### 작은 소제목\n')}>작은 소제목</button>
            <button type="button" onClick={() => insertNoteFormat('\n- 내용\n')}>목록</button>
            <button type="button" onClick={() => insertNoteFormat('\n핵심: 꼭 기억할 내용\n')}>핵심</button>
            <button type="button" onClick={() => insertNoteFormat('\n| 항목 | 설명 |\n| --- | --- |\n| 개념 | 내용 |\n')}>비교표</button>
            <button type="button" onClick={() => textInputRef.current?.click()}>텍스트 가져오기</button>
            <input ref={textInputRef} type="file" accept=".md,.markdown,.txt" hidden onChange={event => { void importText(event.target.files?.[0]); event.target.value = ''; }} />
          </div>
          <div className="study-ink-tools" aria-label="글자 강조"><span>본문에서 글자를 선택한 뒤</span>{[['**', '중요 · 빨강'], ['__', '암기 · 파랑'], ['==', '강조 · 회색']].map(([mark, label]) => <button key={mark} type="button" onClick={() => {
            const input = noteRef.current; if (!input) return;
            const start = input.selectionStart, end = input.selectionEnd;
            if (start === end) { input.focus(); setError('강조할 본문 글자를 먼저 선택해 주세요.'); return; }
            const text = input.value; const selected = text.slice(start, end).split('\n').map(line => line ? mark + line + mark : '').join('\n');
            field('content', text.slice(0, start) + selected + text.slice(end)); setError(''); input.focus();
          }}>{label}</button>)}</div>
          <label className="study-note-label">학습 내용<textarea ref={noteRef} value={editor.content} onChange={event => field('content', event.target.value)} placeholder={'배운 내용, 핵심 개념, 헷갈렸던 부분을 자유롭게 정리해 보세요.\n\n자료만 첨부해 보관해도 괜찮아요.'} maxLength={100000} rows={9} /></label>
          <label>한눈에 요약<textarea value={editor.summary} onChange={event => field('summary', event.target.value)} placeholder="이 노트에서 꼭 기억할 내용을 짧게 정리해 주세요." maxLength={10000} rows={3} /></label>
        </fieldset>
        <p className="study-save-hint">‘기록 저장’을 누르면 자료와 메모가 함께 저장됩니다.</p>
      </form> : reading ? <>
        <div className="study-reader-toolbar"><button onClick={() => { setReadingId(null); setNotice(''); }}><ArrowLeft size={17} />{reading.category}</button><span>노트 읽기</span><label className="study-reading-size">글자 크기<select aria-label="본문 글자 크기" value={readingSize} onChange={event => setReadingSize(Number(event.target.value))}>{[14, 16, 18, 20].map(size => <option key={size} value={size}>{size}</option>)}</select></label>{!flow && <button onClick={() => setPen(pen ? null : { kind: 'pen', color: INK_COLORS[0][0] })} className={pen ? 'is-favorite' : ''} aria-pressed={!!pen}><Pencil size={15} />펜</button>}<button onClick={() => void mutate(reading, 'favorite')} className={reading.favorite ? 'is-favorite' : ''} aria-pressed={!!reading.favorite} disabled={busy}><Star size={16} fill={reading.favorite ? 'currentColor' : 'none'} />즐겨찾기</button><button onClick={() => { setRemoving(reading); setError(''); }} disabled={busy}><Trash2 size={15} />삭제</button><button className="study-primary" onClick={() => open(reading)}>수정</button></div>
        {pen && <div className="note-pen-bar" role="toolbar" aria-label="펜">
          {INK_COLORS.map(([color, name]) => <button key={color} type="button" className={`note-pen-dot${pen.kind === 'pen' && pen.color === color ? ' is-on' : ''}`} aria-label={name} aria-pressed={pen.kind === 'pen' && pen.color === color} onClick={() => setPen({ kind: 'pen', color })}><i style={{ background: color }} /></button>)}
          <button type="button" className={pen.kind === 'erase' ? 'is-on' : ''} aria-pressed={pen.kind === 'erase'} onClick={() => setPen({ kind: 'erase' })}><Eraser size={16} />지우개</button>
          <button type="button" disabled={!ink.length} onClick={() => changeInk(ink.slice(0, -1))}><Undo2 size={16} />되돌리기</button>
        </div>}
        <div className="study-reader-scroll" ref={scrollRef}>
          <article className={`note-page${flow ? ' is-flow' : ''}`} aria-label="공부 노트" style={flow ? { fontSize: readingSize } : { width: NOTE_W, zoom }}>
            <header className="note-head"><h1>{reading.title}</h1><p>{[reading.category, dateLabel(reading.studiedOn), ...(reading.tags || '').split(/[,#]+/).map(tag => tag.trim()).filter(Boolean).map(tag => `#${tag}`)].filter(Boolean).join(' · ')}</p></header>
            {reading.keywords?.trim() && <section className="note-terms"><h2>용어</h2><StudyNoteText text={reading.keywords} /></section>}
            <section className="note-body">{reading.content && <StudyNoteText text={reading.content} />}
              {reading.attachments.length > 0 && <div className="cornell-materials" aria-label="학습 이미지와 자료">{reading.attachments.map(file => file.mime.startsWith('image/') ? <figure key={file.id}><button onClick={() => setPreview(file)} aria-label={`${file.name} 크게 보기`}><img src={file.url} alt={file.name} loading="lazy" /></button><figcaption>{file.name}</figcaption></figure> : <figure className="cornell-pdf" key={file.id}><iframe src={file.url} title={file.name} loading="lazy" /><figcaption><span>{file.name}</span><button onClick={() => setPreview(file)}>PDF 크게 보기</button><a href={file.url} target="_blank" rel="noopener noreferrer">새 창에서 열기</a></figcaption></figure>)}</div>}
              {!reading.content && !reading.attachments.length && <p className="note-empty">기록 없음</p>}
            </section>
            {reading.summary?.trim() && <section className="note-key note-key-box"><b>핵심</b><StudyNoteText text={reading.summary} /></section>}
            {!flow && <InkLayer strokes={ink} tool={pen} onChange={changeInk} scroller={() => scrollRef.current} />}
          </article>
        </div>
      </> : <div className={showingFolders ? 'finder-grid' : 'finder-grid pf-thumb-grid'} style={{ ['--finder-scale' as string]: scale / 100 }}>
        {showingFolders ? <>
          {folders.map(name => <button key={name} type="button" className="desktop-icon" onClick={() => navigate('all', name)}>
            <div className="desktop-folder-art"><ToneFolder /></div>
            <span><ToneDot name={name} />{name}<small className="wl-folder-count">{counts.get(name) ?? 0}</small></span>
          </button>)}
          {favorites > 0 && <button type="button" className="desktop-icon" onClick={() => navigate('favorite')}>
            <div className="desktop-folder-art"><ToneFolder /></div>
            <span><Star size={12} fill="currentColor" className="study-fav-mark" />즐겨찾기<small className="wl-folder-count">{favorites}</small></span>
          </button>}
        </>
        : !filtered.length ? <p className="finder-empty">{query ? '검색한 기록이 없어요. 다른 제목이나 태그로 검색해 보세요.' : filter === 'favorite' ? '기록을 열고 즐겨찾기를 누르면 여기에 모여요.' : '기록이 없어요. 위쪽 + 버튼으로 첫 기록을 남겨 보세요.'}</p>
        : filtered.map(item => { const cover = item.attachments.find(file => file.mime.startsWith('image/')); return <div key={item.id} className="pf-thumb">
          <button type="button" className="pf-thumb-open" onClick={() => { setReadingId(item.id); setNotice(''); setError(''); }} aria-label={`${item.title} 열기`}>
            <span className="pf-thumb-image wl-thumb">{cover ? <img src={cover.url} alt="" loading="lazy" /> : <span className="wl-thumb-paper"><FileText size={22} strokeWidth={1.5} /><span>{item.summary?.trim() || item.content.replace(/\s+/g, ' ').slice(0, 70) || (item.attachments.length ? 'PDF 자료' : '공부 메모')}</span></span>}</span>
            <span className="pf-thumb-name">{item.favorite && <Star size={11} fill="currentColor" className="study-fav-mark" />}{item.title}</span>
            <span className="pf-thumb-folder">{query.trim() ? `${item.category} · ` : ''}{dateLabel(item.studiedOn)}</span>
          </button>
        </div>; })}
      </div>}
    </main>
    {preview && <div className="study-preview" role="dialog" aria-modal="true" aria-label={preview.name} onKeyDown={event => { if (event.key === 'Escape') setPreview(null); }}><header><strong>{preview.name}</strong><a href={`${preview.url}?download=1`} target="_blank" rel="noopener noreferrer"><DownloadMark />다운로드</a><button onClick={() => setPreview(null)} aria-label="미리보기 닫기"><X size={22} /></button></header>{preview.mime.startsWith('image/') ? <img src={preview.url} alt={preview.name} /> : <div className="study-pdf"><a href={preview.url} target="_blank" rel="noopener noreferrer">PDF가 보이지 않으면 새 창에서 열기</a><iframe src={preview.url} title={preview.name} /></div>}</div>}
  </div>
  </FinderMain>;
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, CalendarDays, Check, Download, FileText, FolderOpen, Heart, ImagePlus, LockKeyhole, Plus, Search, Star, Trash2, Upload, X } from 'lucide-react';
import '../../styles/study.css';
import { StudyNoteText } from './StudyNoteText';

type Attachment = { id: string; name: string; mime: string; size: number; url: string };
type RecordItem = { id: string; title: string; category: string; studiedOn: string; content: string; tags: string; keywords: string; summary: string; favorite: number; createdAt: number; updatedAt: number; trashedAt: number | null; attachments: Attachment[] };
type Editor = { id: string; title: string; category: string; studiedOn: string; content: string; tags: string; keywords: string; summary: string; version: number; attachments: Attachment[] };
const categories = ['피부 기초', '색소·레이저', '홍조·혈관', '여드름·흉터', '리프팅', '스킨부스터', '상담·기타'];
const newRecordId = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dateLabel = (date: string) => date.replaceAll('-', '.');
const sizeLabel = (size: number) => size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`;
const parse = async (response: Response) => {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || '연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  return data;
};
const toEditor = (item: RecordItem): Editor => ({ id: item.id, title: item.title, category: item.category, studiedOn: item.studiedOn, content: item.content, tags: item.tags, keywords: item.keywords || '', summary: item.summary || '', version: item.updatedAt, attachments: item.attachments });

export function StudyArchive({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
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
  const active = records.filter(item => !item.trashedAt);
  const folders = [...new Set([...categories, ...records.map(item => item.category)])];
  const counts = new Map(folders.map(name => [name, active.filter(item => item.category === name).length]));
  const filtered = useMemo(() => records.filter(item => {
    if (filter === 'trash' ? !item.trashedAt : !!item.trashedAt) return false;
    if (filter === 'favorite' && !item.favorite) return false;
    if (category && item.category !== category) return false;
    return `${item.title} ${item.content} ${item.keywords || ''} ${item.summary || ''} ${item.category} ${item.tags} ${item.attachments.map(file => file.name).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'ko') : sort === 'updated' ? b.updatedAt - a.updatedAt : b.studiedOn.localeCompare(a.studiedOn) || b.updatedAt - a.updatedAt), [records, filter, category, query, sort]);
  const leave = (next: () => void) => { if (busyRef.current) return; if (!dirty || window.confirm('저장하지 않은 변경 사항이 있습니다. 저장하지 않고 이동할까요?')) { setEditor(null); setFiles([]); setError(''); next(); } };
  const open = (record?: RecordItem) => leave(() => {
    setReadingId(record?.id || null);
    const value: Editor = record ? toEditor(record) : { id: newRecordId(), title: '', category: category || categories[0], studiedOn: today(), content: '', tags: '', keywords: '', summary: '', version: 0, attachments: [] };
    setEditor(value); setBaseline(JSON.stringify(value)); setFiles([]); setNotice('');
  });
  const navigate = (next: typeof filter, folder = '') => leave(() => { setReadingId(null); setFilter(next); setCategory(folder); setNotice(''); });
  const field = (key: keyof Editor, value: string) => setEditor(current => current ? { ...current, [key]: value } : current);
  const updateRecord = (record: RecordItem) => setRecords(items => [record, ...items.filter(item => item.id !== record.id)]);
  const mutate = async (record: RecordItem, action: 'trash' | 'restore' | 'favorite') => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const data = await parse(await fetch(`/api/study/records/${record.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, version: record.updatedAt }) }));
      updateRecord(data); setRemoving(null);
      setNotice(action === 'trash' ? '삭제한 기록으로 이동했습니다. 언제든 복원할 수 있어요.' : action === 'restore' ? '공부 기록을 복원했습니다.' : data.favorite ? '즐겨찾기에 추가했습니다.' : '즐겨찾기에서 해제했습니다.');
    } catch (e) { setError((e as Error).message); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const addFiles = (added: File[]) => {
    if (!editor || busyRef.current) return;
    if (files.length + added.length + editor.attachments.length > 12) { setError('한 기록에 최대 12개까지 첨부할 수 있습니다.'); return; }
    if (added.some(file => !/\.(png|jpe?g|webp|pdf)$/i.test(file.name) || file.size > 10 * 1024 * 1024 || !file.size)) { setError('파일당 10MB 이하의 JPG, PNG, WEBP 또는 PDF를 선택해 주세요.'); return; }
    if ([...files, ...added].reduce((sum, file) => sum + file.size, 0) > 25 * 1024 * 1024) { setError('한 번에 추가하는 파일은 총 25MB 이하로 선택해 주세요.'); return; }
    setFiles(current => [...current, ...added]); setError('');
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
    if (editor.content.trim() && !window.confirm('현재 본문을 가져온 파일 내용으로 바꿀까요?')) return;
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
  const heading = category || (filter === 'favorite' ? '즐겨찾기' : filter === 'trash' ? '삭제한 기록' : '전체 공부 기록');

  return <div className={`study-archive${reading && !editor ? ' study-reading' : ''}`} onKeyDown={event => { if (editor && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); } }}>
    <aside className="study-sidebar">
      <div className="study-brand"><img src="/icons/pink-folder-ribbon.png" alt="" /><div><strong>나의 공부 보관함</strong><span>배운 것을 차곡차곡</span></div></div>
      <nav aria-label="공부 보관함 분류">
        <button className={!category && filter === 'all' ? 'selected' : ''} onClick={() => navigate('all')}><BookOpen size={17} />전체 기록<span>{active.length}</span></button>
        <button className={filter === 'favorite' ? 'selected' : ''} onClick={() => navigate('favorite')}><Star size={17} />즐겨찾기<span>{active.filter(item => item.favorite).length}</span></button>
        <p className="study-nav-label">주제별 보관함</p>
        {folders.map(name => <button key={name} className={category === name ? 'selected' : ''} onClick={() => navigate('all', name)}><FolderOpen size={16} />{name}<span>{counts.get(name)}</span></button>)}
        <button className={`study-trash-nav ${filter === 'trash' ? 'selected' : ''}`} onClick={() => navigate('trash')}><Trash2 size={16} />삭제한 기록<span>{records.filter(item => item.trashedAt).length}</span></button>
      </nav>
      <div className="study-private"><LockKeyhole size={14} /><span>로그인한 나만 보는<br />개인 공부 기록</span></div>
    </aside>
    <main className="study-main">
      {(!reading || editor) && <header className="study-heading">
        <div><p>MY STUDY ARCHIVE</p><h1>{editor ? editor.version ? '공부 기록 수정' : '새 공부 기록' : heading}</h1><span>{editor ? '자료와 함께 배운 내용을 남겨 보세요.' : '이미지와 PDF, 나의 메모를 한곳에 모아두세요.'}</span></div>
        {!editor && <button className="study-primary" onClick={() => open()} disabled={!ready || !authenticated}><Plus size={18} />기록 추가</button>}
      </header>}
      {error && <div className="study-alert" role="alert">{error}<button onClick={() => void load()} disabled={busy}>목록 새로고침</button></div>}
      {notice && <div className="study-notice" role="status"><Check size={16} />{notice}</div>}
      {!ready ? <div className="study-empty"><BookOpen size={32} /><strong>{error ? '보관함을 불러오지 못했어요' : '보관함을 불러오는 중…'}</strong></div>
      : !authenticated ? <div className="study-empty"><img src="/icons/pink-folder-ribbon.png" alt="" /><h2>나만의 공부 기록을 시작해요</h2><p>이미지·PDF와 공부 메모를 저장하고<br />다른 기기에서도 같은 계정으로 열어보세요.</p><a className="study-primary" href="/signin-with-chatgpt?return_to=%2F" target="_top">로그인하고 시작하기</a></div>
      : editor ? <form className="study-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="study-editor-bar"><button type="button" onClick={() => leave(() => {})} disabled={busy}><ArrowLeft size={16} />{reading ? '노트로 돌아가기' : '목록으로'}</button><span>{dirty ? '저장 전' : editor.version ? '저장된 기록' : '새 기록'}</span><button type="submit" className="study-primary" disabled={busy}>{busy ? '저장 중…' : '기록 저장'}</button></div>
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
            <button type="button" onClick={() => insertNoteFormat('\n## 소제목\n')}>소제목</button>
            <button type="button" onClick={() => insertNoteFormat('\n- 핵심 내용\n')}>목록</button>
            <button type="button" onClick={() => insertNoteFormat('\n| 항목 | 설명 |\n| --- | --- |\n| 개념 | 내용 |\n')}>비교표</button>
            <button type="button" onClick={() => textInputRef.current?.click()}>텍스트 가져오기</button>
            <input ref={textInputRef} type="file" accept=".md,.markdown,.txt" hidden onChange={event => { void importText(event.target.files?.[0]); event.target.value = ''; }} />
          </div>
          <div className="study-ink-tools" aria-label="필기 색상"><span>본문에서 글자를 선택한 뒤</span>{[['**', '중요 · 빨강'], ['__', '암기 · 파랑'], ['==', '형광펜']].map(([mark, label]) => <button key={mark} type="button" onClick={() => {
            const input = noteRef.current; if (!input) return;
            const start = input.selectionStart, end = input.selectionEnd;
            if (start === end) { input.focus(); setError('색을 표시할 본문 글자를 먼저 선택해 주세요.'); return; }
            const text = input.value; const selected = text.slice(start, end).split('\n').map(line => line ? mark + line + mark : '').join('\n');
            field('content', text.slice(0, start) + selected + text.slice(end)); setError(''); input.focus();
          }}>{label}</button>)}</div>
          <label className="study-note-label">학습 내용<textarea ref={noteRef} value={editor.content} onChange={event => field('content', event.target.value)} placeholder={'배운 내용, 핵심 개념, 헷갈렸던 부분을 자유롭게 정리해 보세요.\n\n자료만 첨부해 보관해도 괜찮아요.'} maxLength={100000} rows={9} /></label>
          <label>한눈에 요약<textarea value={editor.summary} onChange={event => field('summary', event.target.value)} placeholder="이 노트에서 꼭 기억할 내용을 짧게 정리해 주세요." maxLength={10000} rows={3} /></label>
        </fieldset>
        <p className="study-save-hint">‘기록 저장’을 누르면 자료와 메모가 함께 저장됩니다.</p>
      </form> : reading ? <>
        <div className="study-reader-toolbar"><button onClick={() => { setReadingId(null); setNotice(''); }}><ArrowLeft size={17} />보관함</button><span>노트 읽기</span><label className="study-reading-size">글자 크기<select aria-label="본문 글자 크기" value={readingSize} onChange={event => setReadingSize(Number(event.target.value))}>{[14, 16, 18, 20].map(size => <option key={size} value={size}>{size}</option>)}</select></label><button className="study-primary" onClick={() => open(reading)}>수정</button></div>
        <div className="study-reader-scroll">
          <article className="cornell-page" aria-label="코넬식 공부 노트" style={{ fontSize: readingSize }}>
            <header className="cornell-title"><div><span>{reading.category}</span><time>{dateLabel(reading.studiedOn)}</time></div><h1>{reading.title}</h1>{reading.tags && <p>{reading.tags.split(/[,#]+/).map(tag => tag.trim()).filter(Boolean).map((tag, i) => <span key={i}>#{tag}</span>)}</p>}</header>
            <div className="cornell-body">
              <aside className="cornell-cues"><h2>핵심 키워드<span>KEYWORDS & QUESTIONS</span></h2>{reading.keywords?.trim() ? <StudyNoteText text={reading.keywords} /> : reading.tags?.trim() ? <ul>{reading.tags.split(/[,#]+/).map(tag => tag.trim()).filter(Boolean).map((tag, i) => <li key={i}>{tag}</li>)}</ul> : <p className="cornell-empty">핵심 개념과 질문을<br />여기에 정리해 보세요.</p>}</aside>
              <section className="cornell-content"><h2>학습 내용<span>STUDY NOTES</span></h2>{reading.content && <StudyNoteText text={reading.content} />}
                {reading.attachments.length > 0 && <div className="cornell-materials" aria-label="학습 이미지와 자료">{reading.attachments.map(file => file.mime.startsWith('image/') ? <figure key={file.id}><button onClick={() => setPreview(file)} aria-label={`${file.name} 크게 보기`}><img src={file.url} alt={file.name} loading="lazy" /></button><figcaption>{file.name} <span>눌러서 확대</span></figcaption></figure> : <figure className="cornell-pdf" key={file.id}><iframe src={file.url} title={file.name} loading="lazy" /><figcaption><span>{file.name}</span><button onClick={() => setPreview(file)}>PDF 크게 보기</button><a href={file.url} target="_blank" rel="noopener noreferrer">새 창에서 열기</a></figcaption></figure>)}</div>}
                {!reading.content && !reading.attachments.length && <p className="cornell-empty">수정을 눌러 학습 내용을 작성해 주세요.</p>}
              </section>
            </div>
            <section className="cornell-summary"><h2>한눈에 요약<span>SUMMARY</span></h2>{reading.summary?.trim() ? <StudyNoteText text={reading.summary} /> : <p className="cornell-empty">아직 작성한 요약이 없습니다. 수정에서 핵심 내용을 남길 수 있어요.</p>}</section>
          </article>
        </div>
      </> : <>
        <div className="study-toolbar"><label className="study-search"><Search size={17} /><input aria-label="공부 기록 검색" value={query} onChange={event => setQuery(event.target.value)} placeholder="제목, 메모, 태그 검색" />{query && <button onClick={() => setQuery('')} aria-label="검색어 지우기"><X size={16} /></button>}</label><select aria-label="정렬" value={sort} onChange={event => setSort(event.target.value)}><option value="date">공부 날짜순</option><option value="updated">최근 수정순</option><option value="title">제목순</option></select></div>
        <div className="study-results-line"><span>{filtered.length}개의 기록</span>{filter === 'trash' && <span>삭제한 기록은 여기에서 복원할 수 있어요.</span>}</div>
        <div className="study-results">
          {filtered.length ? <div className="study-grid">{filtered.map(item => {
            const cover = item.attachments.find(file => file.mime.startsWith('image/'));
            return <article className="study-card" key={item.id}>
              <button className="study-card-main" onClick={() => { setReadingId(item.id); setNotice(''); setError(''); }} disabled={!!item.trashedAt || busy} aria-label={`${item.title} 열기`}>
                <div className="study-card-cover">{cover && !item.trashedAt ? <img src={cover.url} loading="lazy" alt="" /> : <div className="study-card-paper"><FileText size={25} /><span>{item.content ? item.content.slice(0, 110) : item.attachments.length ? 'PDF · 학습 자료' : '나의 공부 메모'}</span></div>}<span className="study-category-chip">{item.category}</span></div>
                <div className="study-card-content"><h2>{item.title}</h2><p>{item.content.trim() ? item.content.replace(/\s+/g, ' ').slice(0, 80) : '첨부 자료를 열어 확인해 보세요.'}</p><div className="study-card-meta"><span><CalendarDays size={13} />{dateLabel(item.studiedOn)}</span><span>자료 {item.attachments.length}개</span></div>{item.tags && <div className="study-tags">{item.tags.split(/[,#]+/).map(tag => tag.trim()).filter(Boolean).slice(0, 3).map((tag, i) => <span key={i}>#{tag}</span>)}</div>}</div>
              </button>
              <div className="study-card-actions">{item.trashedAt ? <button onClick={() => void mutate(item, 'restore')} disabled={busy}>기록 복원</button> : <><button onClick={() => void mutate(item, 'favorite')} className={item.favorite ? 'is-favorite' : ''} aria-label={`${item.title} 즐겨찾기 ${item.favorite ? '해제' : '추가'}`} aria-pressed={!!item.favorite} disabled={busy}><Star size={16} fill={item.favorite ? 'currentColor' : 'none'} />즐겨찾기</button><button onClick={() => { setRemoving(item); setError(''); }} aria-label={`${item.title} 삭제`} disabled={busy}><Trash2 size={15} /></button></>}</div>
            </article>;
          })}</div> : <div className="study-empty"><img src="/icons/pink-folder-ribbon.png" alt="" /><h2>{query ? '검색한 기록이 없어요' : filter === 'favorite' ? '다시 보고 싶은 기록을 모아보세요' : filter === 'trash' ? '삭제한 기록이 없어요' : '오늘 배운 것을 첫 기록으로'}</h2><p>{query ? '다른 제목이나 태그로 검색해 보세요.' : filter === 'favorite' ? '기록의 별을 누르면 이곳에서 모아볼 수 있어요.' : filter === 'trash' ? '삭제한 공부 기록은 여기에서 복원할 수 있어요.' : '공부한 이미지·PDF를 올리고\n나만의 메모를 함께 남겨보세요.'}</p>{filter === 'all' && !query && <button className="study-primary" onClick={() => open()}><Plus size={17} />첫 기록 남기기</button>}</div>}
        </div>
      </>}
      <footer className="study-footer"><Heart size={12} /><span>조금씩 쌓이는 나의 공부 기록</span><span>{authenticated ? '계정에 저장' : '로그인 후 이용'}</span></footer>
    </main>
    {removing && <div className="study-modal-backdrop"><div className="study-modal" role="dialog" aria-modal="true" aria-labelledby="study-delete-title"><h2 id="study-delete-title">기록을 삭제할까요?</h2><p>‘{removing.title}’ 기록과 첨부 자료를<br />삭제한 기록으로 옮깁니다. 다시 복원할 수 있어요.</p>{error && <p role="alert">{error}</p>}<div><button onClick={() => setRemoving(null)} disabled={busy}>취소</button><button className="study-primary" onClick={() => void mutate(removing, 'trash')} disabled={busy}>{busy ? '이동 중…' : '삭제한 기록으로 이동'}</button></div></div></div>}
    {preview && <div className="study-preview" role="dialog" aria-modal="true" aria-label={preview.name} onKeyDown={event => { if (event.key === 'Escape') setPreview(null); }}><header><strong>{preview.name}</strong><a href={`${preview.url}?download=1`} target="_blank" rel="noopener noreferrer"><Download size={18} />다운로드</a><button onClick={() => setPreview(null)} aria-label="미리보기 닫기"><X size={22} /></button></header>{preview.mime.startsWith('image/') ? <img src={preview.url} alt={preview.name} /> : <div className="study-pdf"><a href={preview.url} target="_blank" rel="noopener noreferrer">PDF가 보이지 않으면 새 창에서 열기</a><iframe src={preview.url} title={preview.name} /></div>}</div>}
  </div>;
}

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { ArrowLeft, BookOpen, Check, FilePlus2, Folder, FolderPlus, ImagePlus, Pencil, Search, Trash2, Undo2, Upload } from 'lucide-react';
import { KittyDialog } from './KittyDialog';
import { StudyDocument } from './StudyDocument';
import { emptyStudy, newStudyId, studyChanged, studyDate, studyRequest, studyWrite, type StudyFolder, type StudyNote, type StudyState, type StudySummary } from '../study';
import '../../styles/study.css';

export function StudyLibrary({ closeGuard, onClose }: { closeGuard: MutableRefObject<(() => void) | null>; onClose: () => void }) {
  const [data, setData] = useState<StudyState>(emptyStudy);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [folder, setFolder] = useState('');
  const [query, setQuery] = useState('');
  const [trash, setTrash] = useState(false);
  const [version, setVersion] = useState(0);
  const [view, setView] = useState<'library' | 'reader' | 'editor' | 'preview'>('library');
  const [saved, setSaved] = useState<StudyNote | null>(null);
  const [draft, setDraft] = useState<StudyNote | null>(null);
  const [fontSize, setFontSize] = useState(18);
  const [folderEdit, setFolderEdit] = useState<{ id?: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<StudySummary | StudyNote | null>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const reader = useRef<HTMLDivElement>(null);
  const dirty = (view === 'editor' || view === 'preview') && studyChanged(draft, saved);
  const refresh = () => setVersion(value => value + 1);
  const folderName = (id: string | null) => data.folders.find(item => item.id === id)?.name ?? '미분류';

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query, ...(folder ? { folder } : {}), ...(trash ? { trash: '1' } : {}) });
      void studyRequest<StudyState>(`?${params}`, { signal: controller.signal }).then(value => {
        setData(value); setReady(true);
      }).catch(e => { if (e.name !== 'AbortError') setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, query ? 200 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [folder, query, trash, version]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const guard = (action: () => void) => { if (busyRef.current) return; if (dirty) setPending(() => action); else action(); };
  useEffect(() => { closeGuard.current = () => guard(onClose); return () => { closeGuard.current = null; }; });
  useEffect(() => { reader.current?.scrollTo({ top: 0 }); }, [view, saved?.id]);

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try { return await action(); } catch (e) { setError((e as Error).message); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const open = (id: string) => void run(async () => {
    const note = await studyRequest<StudyNote>(`/notes/${id}`);
    setSaved(note); setDraft(note); setView('reader');
  });
  const create = (title = '', content = '') => {
    setSaved(null); setDraft({ id: newStudyId(), title, content, folderId: folder && folder !== 'unfiled' ? folder : null, revision: 0, createdAt: 0, updatedAt: 0, trashedAt: null });
    setView('editor'); setError(''); setNotice('');
  };
  const save = async () => {
    if (!draft) return false;
    const result = await run(async () => {
      const note = await studyWrite<StudyNote>(`/notes/${draft.id}`, 'PUT', draft);
      setSaved(note); setDraft(note); setView('reader'); setNotice('저장했습니다.'); refresh(); return true;
    });
    return result === true;
  };
  const change = (values: Partial<StudyNote>) => setDraft(current => current ? { ...current, ...values } : current);
  const insert = (snippet: string) => {
    const area = textArea.current;
    const start = area?.selectionStart ?? draft?.content.length ?? 0;
    const end = area?.selectionEnd ?? start;
    setDraft(current => current ? { ...current, content: current.content.slice(0, start) + snippet + current.content.slice(end) } : current);
    requestAnimationFrame(() => { area?.focus(); area?.setSelectionRange(start + snippet.length, start + snippet.length); });
  };
  const importNote = (file: File) => void run(async () => {
    if (!/\.(md|markdown|txt)$/i.test(file.name)) throw new Error('Markdown(.md) 또는 텍스트(.txt) 파일을 선택해 주세요.');
    if (file.size > 800000) throw new Error('800KB 이하의 텍스트 파일을 선택해 주세요.');
    const content = await file.text();
    if (!content.trim() || content.length > 200000) throw new Error('내용이 있는 20만 자 이하 파일을 선택해 주세요.');
    create(file.name.replace(/\.[^.]+$/, '').slice(0, 100), content);
  });
  const uploadImage = (file: File) => void run(async () => {
    if (file.size > 8 * 1024 * 1024) throw new Error('8MB 이하 이미지를 선택해 주세요.');
    const form = new FormData(); form.set('file', file);
    const result = await studyRequest<{ src: string }>('/assets', { method: 'POST', body: form });
    insert(`\n\n![${file.name.replace(/[\[\]\\\r\n]/g, '').slice(0, 100)}](${result.src})\n\n`);
  });
  const editFolder = (item?: StudyFolder) => { setError(''); setFolderEdit({ id: item?.id, name: item?.name ?? '' }); };
  const storeFolder = () => void run(async () => {
    if (!folderEdit) return;
    await studyWrite(folderEdit.id ? `/folders/${folderEdit.id}` : '/folders', folderEdit.id ? 'PATCH' : 'POST', { name: folderEdit.name });
    setFolderEdit(null); refresh();
  });
  const deleteFolder = () => void run(async () => {
    if (!folderEdit?.id) return;
    await studyWrite(`/folders/${folderEdit.id}`, 'DELETE');
    if (folder === folderEdit.id) setFolder(''); setFolderEdit(null); refresh();
  });
  const moveToTrash = () => void run(async () => {
    if (!removing) return;
    await studyWrite(`/notes/${removing.id}`, 'PATCH', { action: 'trash', revision: removing.revision });
    setRemoving(null); setSaved(null); setDraft(null); setView('library'); setNotice('공부 휴지통으로 이동했습니다.'); refresh();
  });
  const restore = (note: StudySummary | StudyNote) => void run(async () => {
    await studyWrite(`/notes/${note.id}`, 'PATCH', { action: 'restore', revision: note.revision });
    setView('library'); setNotice('원래 폴더로 복원했습니다.'); refresh();
  });
  const back = () => guard(() => { setView('library'); setError(''); setNotice(''); });
  const resolvePending = async (saveFirst: boolean) => {
    const action = pending;
    if (saveFirst && !(await save())) return;
    setPending(null); action?.();
  };
  const activeNote = view === 'preview' ? draft : saved;

  return <div className="study-app" onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && (view === 'editor' || view === 'preview')) { event.preventDefault(); void save(); }
  }}>
    {view === 'library' ? <>
      <header className="study-library-header"><div><span className="study-eyebrow">MY STUDY</span><h2>공부 보관함</h2><p>배운 내용을 모아두고, 한 편씩 차분하게 읽어요.</p></div><BookOpen size={36} /></header>
      <div className="study-library-body">
        <nav className="study-folders" aria-label="공부 폴더">
          <button aria-pressed={!folder && !trash} onClick={() => { setFolder(''); setTrash(false); }}><BookOpen size={18} /><span>전체 노트</span><small>{data.counts.total}</small></button>
          <button aria-pressed={folder === 'unfiled' && !trash} onClick={() => { setFolder('unfiled'); setTrash(false); }}><Folder size={18} /><span>미분류</span><small>{data.counts.unfiled}</small></button>
          <div className="study-folder-heading"><span>내 폴더</span><button aria-label="새 공부 폴더" disabled={!data.authenticated || busy} onClick={() => editFolder()}><FolderPlus size={17} /></button></div>
          {data.folders.map(item => <div className="study-folder-row" key={item.id}><button aria-pressed={folder === item.id && !trash} onClick={() => { setFolder(item.id); setTrash(false); }}><Folder size={17} /><span>{item.name}</span><small>{item.count}</small></button><button aria-label={`${item.name} 폴더 정리`} disabled={busy} onClick={() => editFolder(item)}><Pencil size={13} /></button></div>)}
          <button className="study-trash-link" aria-pressed={trash} onClick={() => { setFolder(''); setTrash(true); }}><Trash2 size={17} /><span>공부 휴지통</span><small>{data.counts.trash}</small></button>
        </nav>
        <section className="study-list-area" aria-label="공부 자료 목록">
          <div className="study-list-tools"><label className="study-search"><Search size={17} /><input aria-label="공부 자료 검색" placeholder="제목·본문 검색" type="search" value={query} onChange={event => setQuery(event.target.value)} maxLength={200} /></label>
            <div>{data.authenticated && !trash && <><button disabled={busy} onClick={() => importInput.current?.click()}><Upload size={16} />가져오기</button><button className="study-primary" disabled={busy} onClick={() => create()}><FilePlus2 size={16} />새 노트</button></>}</div>
          </div>
          <input type="file" ref={importInput} hidden accept=".md,.markdown,.txt,text/plain,text/markdown" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) importNote(file); }} />
          <div className="study-list-caption"><strong>{trash ? '공부 휴지통' : folder ? folderName(folder === 'unfiled' ? null : folder) : '전체 노트'}</strong><span>{loading ? '검색 중…' : `${data.notes.length}개의 노트`}</span></div>
          {trash && <p className="study-hint">삭제한 공부노트를 원래 폴더로 복원할 수 있습니다.</p>}
          {loading ? <div className="study-empty" role="status">공부 자료를 불러오는 중…</div> : !data.authenticated && ready ? <div className="study-empty"><BookOpen size={38} /><h3>나만의 공부 기록을 시작하세요</h3><p>로그인하면 공부노트를 저장하고 다른 기기에서도 읽을 수 있습니다.</p><a href="/signin-with-chatgpt?return_to=%2F" target="_top">로그인하기</a></div> : !data.notes.length ? <div className="study-empty"><BookOpen size={38} /><h3>{error ? '자료를 불러오지 못했습니다' : query ? '검색 결과가 없습니다' : trash ? '공부 휴지통이 비어 있습니다' : '첫 공부노트를 남겨보세요'}</h3><p>{query ? '다른 검색어 또는 전체 노트를 확인해 주세요.' : !trash && !error ? '새 노트를 작성하거나 .md · .txt 자료를 가져올 수 있습니다.' : ''}</p></div> :
            <div className="study-note-list">{data.notes.map(note => <div className="study-note-row" key={note.id}><button className="study-note-open" disabled={busy} onClick={() => open(note.id)}><BookOpen size={22} /><div><small>{folderName(note.folderId)}</small><h3>{note.title}</h3><p>{note.preview.replace(/[#*`|>]/g, '')}</p><time>{studyDate(note.updatedAt)}</time></div></button><button className="study-row-action" disabled={busy} aria-label={`${note.title} ${trash ? '복원' : '휴지통으로 이동'}`} onClick={() => trash ? restore(note) : setRemoving(note)}>{trash ? <Undo2 size={17} /> : <Trash2 size={17} />}</button></div>)}</div>}
        </section>
      </div>
    </> : <>
      <div className="study-document-toolbar"><button onClick={back} disabled={busy}><ArrowLeft size={17} />보관함</button><span className="study-mode">{view === 'editor' ? '노트 작성' : view === 'preview' ? '미리보기' : '읽기'}</span>
        <div>{(view === 'reader' || view === 'preview') && <label className="study-font-size">글자 크기<select aria-label="본문 글자 크기" value={fontSize} onChange={event => setFontSize(Number(event.target.value))}><option value={16}>작게</option><option value={18}>보통</option><option value={21}>크게</option></select></label>}
          {view === 'reader' ? saved?.trashedAt ? <button disabled={busy} onClick={() => restore(saved)}><Undo2 size={16} />복원</button> : <button disabled={busy} onClick={() => { setDraft(saved); setView('editor'); setNotice(''); }}><Pencil size={16} />편집</button> : <><button disabled={busy} onClick={() => setView(view === 'editor' ? 'preview' : 'editor')}>{view === 'editor' ? '미리보기' : '편집으로'}</button><button className="study-primary" disabled={busy || !draft?.title.trim() || !draft?.content.trim()} onClick={() => void save()}><Check size={16} />{busy ? '처리 중…' : '저장'}</button></>}
        </div>
      </div>
      {view === 'editor' && draft ? <div className="study-editor">
        <div className="study-editor-meta"><label>저장할 폴더<select aria-label="노트 폴더" disabled={busy} value={draft.folderId ?? ''} onChange={event => change({ folderId: event.target.value || null })}><option value="">미분류</option>{data.folders.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><span>{dirty ? '저장하지 않은 변경사항' : '저장된 내용'}</span></div>
        <input className="study-title-input" aria-label="공부노트 제목" placeholder="공부노트 제목" value={draft.title} maxLength={100} disabled={busy} onChange={event => change({ title: event.target.value })} />
        <div className="study-format-tools" role="group" aria-label="본문 서식"><button disabled={busy} onClick={() => insert('\n\n## 소제목\n\n')}>소제목</button><button disabled={busy} onClick={() => insert('**중요 내용**')}>굵게</button><button disabled={busy} onClick={() => insert('\n\n- 핵심 내용\n- 추가 내용\n\n')}>목록</button><button disabled={busy} onClick={() => insert('\n\n| 구분 | 설명 |\n| --- | --- |\n| 항목 1 | 내용 |\n| 항목 2 | 내용 |\n\n')}>비교표</button><button disabled={busy} onClick={() => imageInput.current?.click()}><ImagePlus size={15} />이미지</button></div>
        <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) uploadImage(file); }} />
        <textarea ref={textArea} aria-label="공부노트 내용" value={draft.content} maxLength={200000} disabled={busy} onChange={event => change({ content: event.target.value })} placeholder={'배운 내용을 적어 주세요.\n\n위 서식 버튼으로 소제목·표·이미지를 넣고 미리보기에서 읽는 모습을 확인할 수 있습니다.'} />
        <footer><span>Markdown 서식 지원 · 이미지는 8MB까지</span><span>{draft.content.length.toLocaleString()} / 200,000자</span></footer>
      </div> : activeNote && <div className="study-reading-scroll" ref={reader} tabIndex={0} aria-label="공부노트 읽기 영역"><StudyDocument note={activeNote} folder={folderName(activeNote.folderId)} fontSize={fontSize} /></div>}
    </>}
    {error && !folderEdit && !removing && !pending && <div className="study-error" role="alert">{error}{view === 'library' && <button onClick={refresh} disabled={busy}>다시 불러오기</button>}</div>}
    {notice && <div className="study-notice" role="status">{notice}</div>}
    {folderEdit && <KittyDialog title={folderEdit.id ? '폴더 정리' : '새 공부 폴더'} busy={busy} onClose={() => { setFolderEdit(null); setError(''); }}><form onSubmit={event => { event.preventDefault(); storeFolder(); }}><label className="kitty-field">폴더 이름<input autoFocus required maxLength={100} disabled={busy} value={folderEdit.name} onChange={event => setFolderEdit({ ...folderEdit, name: event.target.value })} /></label>{error && <p className="kitty-error" role="alert">{error}</p>}<footer className="kitty-dialog-actions">{folderEdit.id && <button type="button" disabled={busy} onClick={deleteFolder}>빈 폴더 삭제</button>}<button type="button" disabled={busy} onClick={() => { setFolderEdit(null); setError(''); }}>취소</button><button className="kitty-primary" disabled={busy || !folderEdit.name.trim()}>저장</button></footer></form></KittyDialog>}
    {removing && <KittyDialog title="공부 휴지통으로 이동" busy={busy} onClose={() => { setRemoving(null); setError(''); }}><p className="kitty-question">‘{removing.title}’ 노트를 휴지통으로 옮길까요? 나중에 복원할 수 있습니다.</p>{error && <p role="alert" className="kitty-error">{error}</p>}<footer className="kitty-dialog-actions"><button disabled={busy} onClick={() => { setRemoving(null); setError(''); }}>취소</button><button className="kitty-primary" disabled={busy} onClick={moveToTrash}>휴지통으로 이동</button></footer></KittyDialog>}
    {pending && <KittyDialog title="작성 중인 노트" busy={busy} onClose={() => { setPending(null); setError(''); }}><p className="kitty-question">저장하지 않은 변경사항이 있습니다.</p>{error && <p role="alert" className="kitty-error">{error}</p>}<footer className="kitty-dialog-actions"><button disabled={busy} onClick={() => { setPending(null); setError(''); }}>계속 작성</button><button disabled={busy} onClick={() => void resolvePending(false)}>저장하지 않고 나가기</button><button className="kitty-primary" disabled={busy || !draft?.title.trim() || !draft?.content.trim()} onClick={() => void resolvePending(true)}>저장 후 나가기</button></footer></KittyDialog>}
  </div>;
}

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Folder, FolderInput, FolderOpen, FolderPlus, ImagePlus, Pencil, Search, Trash2, X } from 'lucide-react';
import { FinderMain, FinderPath } from './FinderFrame';
import { ToneDot, ToneFolder } from './ToneFolder';
import { ImageDocumentViewer } from './ImageDocumentViewer';
import { KittyDialog } from './KittyDialog';
import { LoadingBox, SavingMark } from './Feedback';
import { announceTrash, useTrashChange } from '../trash';
import { initialPriceFiles, type PriceFiles, type PriceFolder, type PriceImage } from '../priceFiles';

type Editor = { type: 'folder'; folder?: PriceFolder } | { type: 'image'; image: PriceImage } | { type: 'upload'; file: File } | { type: 'delete'; image: PriceImage };

// 가격표 보관함은 Finder처럼: 처음엔 카테고리 폴더들, 폴더를 열면 가격표 썸네일. ‹ › 는 폴더 단위로 오간다.
// 왼쪽 메뉴의 가격표 아래에 폴더 이름을 보여 주고(onFolders), 거기서 고른 폴더로 바로 이동한다(goto: 누를 때마다 n이 바뀜).
export function FileExplorer({ onFolders, goto, onLocation }: { onFolders?: (folders: { id: string; name: string }[]) => void; goto?: { id: string; n: number }; onLocation?: (id: string) => void } = {}) {
  const [files, setFiles] = useState<PriceFiles>(initialPriceFiles);
  const [history, setHistory] = useState<{ list: string[]; at: number }>({ list: ['root'], at: 0 });
  const location = history.list[history.at];
  const [searching, setSearching] = useState(false);
  const [scale, setScale] = useState(() => { try { const v = Number(localStorage.getItem('price-finder-scale')); return v >= 80 && v <= 130 ? v : 100; } catch { return 100; } });
  useEffect(() => { try { localStorage.setItem('price-finder-scale', String(scale)); } catch { /* 이 기기에서만 쓰는 편의 설정 */ } }, [scale]);
  const [gallery, setGallery] = useState<{ images: PriceImage[]; index: number } | null>(null);
  const opened = gallery?.images[gallery.index] ?? null;
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState('');
  const variant: PriceFolder['variant'] = 'heart'; // 폴더 그림은 하나로 통일 (모양 선택 없음)
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Only a failed list load offers reloading; other messages are not fixed by it.
  const [canRetry, setCanRetry] = useState(false);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState('');
  const upload = useRef<HTMLInputElement>(null);
  const bundle = useRef<HTMLInputElement>(null);
  const currentFolder = files.folders.find(folder => folder.id === location);

  async function refresh(signal?: AbortSignal) {
    setLoading(true); setError(''); setCanRetry(false);
    try {
      const response = await fetch('/api/price-files', { signal, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setFiles(data);
      const resolveFolder = (value: string) => data.folders.find((folder: PriceFolder) => folder.id === value || folder.id.endsWith(`:${value}`))?.id ?? value;
      setHistory(current => ({ ...current, list: current.list.map(resolveFolder) }));
    } catch (e) { if ((e as Error).name !== 'AbortError') { setError('가격표를 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.'); setCanRetry(true); } }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, []);
  useTrashChange('price', () => { void refresh(); });
  useEffect(() => {
    if (editor?.type !== 'upload') { setPreview(''); return; }
    const src = URL.createObjectURL(editor.file); setPreview(src);
    return () => URL.revokeObjectURL(src);
  }, [editor]);

  useEffect(() => { onFolders?.(files.folders.map(folder => ({ id: folder.id, name: folder.name }))); }, [files.folders]);
  useEffect(() => { onLocation?.(location); }, [location]);
  useEffect(() => { if (goto) navigate(goto.id); }, [goto?.n]);
  const navigate = (next: string) => {
    setGallery(null); setQuery(''); setSearching(false);
    if (next !== location) setHistory(({ list, at }) => ({ list: [...list.slice(0, at + 1), next], at: at + 1 }));
  };
  const step = (delta: number) => { setGallery(null); setQuery(''); setSearching(false); setHistory(({ list, at }) => ({ list, at: Math.min(list.length - 1, Math.max(0, at + delta)) })); };
  const openEditor = (next: Editor) => {
    setError(''); setCanRetry(false); setNotice(''); setEditor(next);
    setName(next.type === 'folder' ? next.folder?.name ?? '' : next.type === 'upload' ? next.file.name.replace(/\.[^.]+$/, '') : next.image.name);
    setFolderId(next.type === 'image' ? next.image.folderId : currentFolder?.id ?? files.folders[0]?.id ?? '');
    // 폴더 그림은 하나로 통일되어 모양은 고르지 않는다.
  };
  const closeEditor = () => { if (!pending) { setEditor(null); setError(''); } };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!editor || pending) return;
    setPending(true); setError('');
    try {
      let response: Response;
      if (editor.type === 'upload') {
        const form = new FormData(); form.set('file', editor.file); form.set('name', name); form.set('folderId', folderId);
        response = await fetch('/api/price-images', { method: 'POST', body: form });
      } else {
        const body = editor.type === 'folder' ? { action: editor.folder ? 'rename-folder' : 'create-folder', id: editor.folder?.id, name, variant }
          : editor.type === 'delete' ? { action: 'delete-image', id: editor.image.id }
            : { action: 'edit-image', id: editor.image.id, name, folderId };
        response = await fetch('/api/price-files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      // A gateway can answer with an HTML error page; never show its parse error.
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw new Error(data?.error || '저장하지 못했습니다. 다시 시도해 주세요.');
      setFiles(data); setNotice(editor.type === 'delete' ? '휴지통으로 이동했습니다.' : '저장했습니다.'); if (editor.type === 'delete') announceTrash('price'); setEditor(null);
    } catch (e) { setError((e as Error).message || '저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setPending(false); }
  };

  // 묶음 파일로 넣기(2026-11-13 사용자 '각 가격표 탭 페이지에 구분해서 올려줘'): Claude가 가격표 사진을 폴더별로 묶어 만든 파일
  // { format: 'dachaeum-pricelist', folders: [{ name, images: [{ name, type, data(base64) }] }] } 을 한 번 올리면
  // 폴더가 없으면 만들고(같은 이름이 있으면 거기에), 사진을 순서대로 넣는다. 같은 폴더에 같은 이름이 이미 있으면 건너뛴다.
  // 저장은 화면에서 하나씩 올릴 때와 같은 길(create-folder → POST /api/price-images). 가격표 사진·묶음 파일은 저장소에 넣지 않는다.
  const importBundle = async (file?: File) => {
    if (!file || pending) return;
    setPending(true); setError(''); setCanRetry(false);
    let added = 0, skipped = 0, current = files;
    const read = async (response: Response) => { const data = await response.json().catch(() => null); if (!response.ok || !data) throw new Error(data?.error || '저장하지 못했습니다. 다시 시도해 주세요.'); return data as PriceFiles; };
    try {
      const j = JSON.parse(await file.text());
      if (j?.format !== 'dachaeum-pricelist' || !Array.isArray(j.folders)) throw new Error('가격표 묶음 파일이 아니에요.');
      const total = j.folders.reduce((n: number, f: { images?: unknown[] }) => n + (f.images?.length ?? 0), 0);
      for (const f of j.folders as { name: string; images: { name: string; type: string; data: string }[] }[]) {
        let folder = current.folders.find(x => x.name === f.name);
        if (!folder) {
          current = await read(await fetch('/api/price-files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create-folder', name: f.name, variant }) }));
          folder = current.folders.find(x => x.name === f.name);
          if (!folder) throw new Error(`'${f.name}' 폴더를 만들지 못했어요.`);
        }
        for (const image of f.images || []) {
          if (current.images.some(x => x.folderId === folder!.id && x.name === image.name)) { skipped++; continue; }
          const bytes = Uint8Array.from(atob(image.data), c => c.charCodeAt(0));
          const form = new FormData(); form.set('file', new File([bytes], `${image.name}.${(image.type || 'image/webp').split('/')[1]}`, { type: image.type || 'image/webp' })); form.set('name', image.name); form.set('folderId', folder.id);
          current = await read(await fetch('/api/price-images', { method: 'POST', body: form }));
          added++; setFiles(current); setNotice(`${added + skipped}/${total}`);
        }
      }
      setFiles(current); setNotice(skipped ? `${added}장 넣음 · 이미 있는 ${skipped}장` : `${added}장 넣었습니다.`);
    } catch (e) { setFiles(current); setError(`${(e as Error).message || '파일을 읽지 못했어요.'}${added ? ` (${added}장까지 넣음)` : ''}`); }
    finally { setPending(false); }
  };

  const normalizedQuery = query.trim().toLocaleLowerCase('ko');
  const folderName = (id: string) => files.folders.find(folder => folder.id === id)?.name ?? '';
  // 검색은 보관함 전체(폴더 이름 포함)에서, 검색이 없으면 연 폴더 안의 가격표만.
  const visibleImages = normalizedQuery
    ? files.images.filter(image => `${image.name} ${folderName(image.folderId)}`.toLocaleLowerCase('ko').includes(normalizedQuery))
    : currentFolder ? files.images.filter(image => image.folderId === currentFolder.id) : [];
  const showingFolders = !normalizedQuery && !currentFolder;
  const count = showingFolders ? files.folders.length : visibleImages.length;
  const title = normalizedQuery ? '검색 결과' : currentFolder?.name ?? '가격표';
  const path = opened ? `${folderName(opened.folderId) || '가격표'} / ${opened.name}` : title;

  function renderFolders() {
    if (!files.folders.length) return loading ? <div className="pf-loading"><LoadingBox label="가격표 불러오는 중…" /></div>
      : <p className="finder-empty">{files.authenticated ? '폴더가 없습니다. 위쪽 새 폴더 버튼으로 만들어 주세요.' : '폴더가 없습니다.'}</p>;
    return files.folders.map(folder => <button key={folder.id} type="button" className="desktop-icon" onClick={() => navigate(folder.id)}>
      <div className="desktop-folder-art"><ToneFolder /></div>
      <span><ToneDot name={folder.name} />{folder.name}</span>
    </button>);
  }
  function renderImages() {
    if (!visibleImages.length) return loading ? <div className="pf-loading"><LoadingBox label="가격표 불러오는 중…" /></div>
      : <p className="finder-empty">{query ? '검색 결과가 없습니다. 시술명이나 폴더 이름으로 검색해 보세요.' : files.authenticated ? '가격표가 없습니다. 위쪽 이미지 추가 버튼으로 올려 주세요.' : '가격표가 없습니다.'}</p>;
    return visibleImages.map((image, index) => <div key={image.id} className="pf-thumb">
      <button type="button" className="pf-thumb-open" onClick={() => setGallery({ images: visibleImages, index })} aria-label={`${image.name} 열기`}>
        <span className="pf-thumb-image"><img src={image.src} alt="" loading="lazy" /></span>
        <span className="pf-thumb-name">{image.name}</span>
        {normalizedQuery && <span className="pf-thumb-folder">{folderName(image.folderId)}</span>}
      </button>
      {files.authenticated && <div className="pf-thumb-actions"><button type="button" aria-label={`${image.name} 이름·폴더 변경`} onClick={() => openEditor({ type: 'image', image })}><Pencil size={13} />정리</button><button type="button" aria-label={`${image.name} 삭제`} onClick={() => openEditor({ type: 'delete', image })}><Trash2 size={13} />삭제</button></div>}
    </div>);
  }

  const tools = <>
    {files.authenticated ? <>
      {currentFolder && !normalizedQuery && <button type="button" aria-label="폴더 이름 변경" title="폴더 이름 변경" onClick={() => openEditor({ type: 'folder', folder: currentFolder })}><Pencil size={18} strokeWidth={1.6} /></button>}
      <button type="button" aria-label="새 폴더" title="새 폴더" onClick={() => openEditor({ type: 'folder' })}><FolderPlus size={19} strokeWidth={1.6} /></button>
      <button type="button" aria-label="이미지 추가" title="이미지 추가" onClick={() => upload.current?.click()}><ImagePlus size={19} strokeWidth={1.6} /></button>
      <button type="button" aria-label="묶음 파일로 넣기" title="묶음 파일로 넣기" disabled={pending} onClick={() => bundle.current?.click()}><FolderInput size={19} strokeWidth={1.6} /></button>
    </> : <a className="finder-login" href="/signin-with-chatgpt?return_to=%2F" target="_top">로그인 후 정리</a>}
    {searching || query ? <label className="finder-search"><Search size={15} /><input autoFocus type="search" aria-label="가격표 검색" placeholder="검색" value={query}
      onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setQuery(''); setSearching(false); } }} onBlur={() => { if (!query) setSearching(false); }} />
      {query && <button type="button" aria-label="검색어 지우기" onClick={() => { setQuery(''); setSearching(false); }}><X size={14} /></button>}</label>
      : <button type="button" className="finder-search-button" aria-label="검색" title="검색" onClick={() => setSearching(true)}><Search size={19} strokeWidth={1.6} /></button>}
    <input ref={bundle} type="file" accept="application/json,.json" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void importBundle(file); }} />
    <input ref={upload} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { setError('10MB 이하의 이미지를 선택해 주세요.'); setCanRetry(false); return; }
      openEditor({ type: 'upload', file });
    }} />
  </>;
  const pathParts = [{ icon: <FolderOpen size={14} strokeWidth={1.7} />, label: '가격표', onClick: currentFolder || normalizedQuery ? () => navigate('root') : undefined },
    ...(currentFolder && !normalizedQuery ? [{ icon: <Folder size={14} strokeWidth={1.7} />, label: currentFolder.name }] : []),
    ...(normalizedQuery ? [{ icon: <Search size={14} strokeWidth={1.7} />, label: `‘${query.trim()}’ 검색` }] : [])];

  return <div className="file-explorer price-file-manager" aria-label={path}>
    {opened && gallery ? <ImageDocumentViewer name={opened.name} src={opened.src} variants={opened.variants} index={gallery.index} count={gallery.images.length}
      onNavigate={index => setGallery(current => current && index >= 0 && index < current.images.length ? { ...current, index } : current)}
      onBack={() => setGallery(null)} />
      : <FinderMain title={title} tools={tools}
        onBack={history.at > 0 ? () => step(-1) : undefined} onForward={history.at < history.list.length - 1 ? () => step(1) : undefined}
        path={<FinderPath parts={pathParts} />}
        status={<>{count}개 항목{notice && !loading ? ` · ${notice}` : ''}</>} scale={scale} onScale={setScale}>
        {error && !editor && <div role="alert" className="pf-feedback">{error}{canRetry && <button type="button" onClick={() => void refresh()}>다시 불러오기</button>}</div>}
        <div className={showingFolders ? 'finder-grid' : 'finder-grid pf-thumb-grid'} style={{ ['--finder-scale' as string]: scale / 100 }}>
          {showingFolders ? renderFolders() : renderImages()}
        </div>
      </FinderMain>}
    {editor && <KittyDialog title={editor.type === 'delete' ? '휴지통으로 이동' : editor.type === 'folder' && !editor.folder ? '새 폴더' : '저장 확인'} onClose={closeEditor} busy={pending}>
      <form onSubmit={save}>
        {editor.type === 'delete' ? <p className="kitty-question">‘{editor.image.name}’ 가격표를 휴지통으로 옮길까요?<br />휴지통에서 복원할 수 있습니다.</p> : <>
          {editor.type === 'upload' && preview && <img className="pf-upload-preview" src={preview} alt="추가할 가격표" />}
          <label className="kitty-field">{editor.type === 'folder' ? '폴더 이름' : '가격표 이름'}<input autoFocus required maxLength={100} value={name} onChange={event => setName(event.target.value)} disabled={pending} /></label>
          {editor.type !== 'folder' && <label className="kitty-field">저장할 폴더<select value={folderId} onChange={event => setFolderId(event.target.value)} disabled={pending} required>{files.folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>}
        </>}
        {error && <p className="kitty-error" role="alert">{error}</p>}
        <footer className="kitty-dialog-actions"><button type="button" onClick={closeEditor} disabled={pending}>취소</button><button type="submit" className="kitty-primary" disabled={pending || (editor.type !== 'delete' && !name.trim())}>{pending ? <><SavingMark />처리 중…</> : editor.type === 'delete' ? '휴지통으로 이동' : '저장'}</button></footer>
      </form>
    </KittyDialog>}
  </div>;
}

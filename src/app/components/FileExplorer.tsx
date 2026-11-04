import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Home, Search, FolderPlus, Plus, Pencil, Trash2 } from 'lucide-react';
import { ImageDocumentViewer } from './ImageDocumentViewer';
import { PinkFolderIcon } from './PinkFolderIcon';
import { KittyDialog } from './KittyDialog';
import { LoadingBox } from './Feedback';
import { announceTrash, useTrashChange } from '../trash';
import { initialPriceFiles, type PriceFiles, type PriceFolder, type PriceImage } from '../priceFiles';

type Editor = { type: 'folder'; folder?: PriceFolder } | { type: 'image'; image: PriceImage } | { type: 'upload'; file: File } | { type: 'delete'; image: PriceImage };

export function FileExplorer() {
  const [files, setFiles] = useState<PriceFiles>(initialPriceFiles);
  const [location, setLocation] = useState('folders');
  const [gallery, setGallery] = useState<{ images: PriceImage[]; index: number } | null>(null);
  const opened = gallery?.images[gallery.index] ?? null;
  const [trail, setTrail] = useState(['folders']);
  const [cursor, setCursor] = useState(0);
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState('');
  const [variant, setVariant] = useState<PriceFolder['variant']>('heart');
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Only a failed list load offers reloading; other messages are not fixed by it.
  const [canRetry, setCanRetry] = useState(false);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState('');
  const upload = useRef<HTMLInputElement>(null);
  const currentFolder = files.folders.find(folder => folder.id === location);

  async function refresh(signal?: AbortSignal) {
    setLoading(true); setError(''); setCanRetry(false);
    try {
      const response = await fetch('/api/price-files', { signal, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setFiles(data);
      const resolveFolder = (value: string) => data.folders.find((folder: PriceFolder) => folder.id === value || folder.id.endsWith(`:${value}`))?.id ?? value;
      setLocation(resolveFolder);
      setTrail(previous => previous.map(resolveFolder));
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

  const navigate = (next: string) => {
    setGallery(null); setQuery(''); setLocation(next);
    setTrail(previous => [...previous.slice(0, cursor + 1), next]); setCursor(cursor + 1);
  };
  const travel = (delta: number) => {
    if (opened && delta < 0) { setGallery(null); return; }
    const next = cursor + delta;
    if (next < 0 || next >= trail.length) return;
    setCursor(next); setLocation(trail[next]); setGallery(null); setQuery('');
  };
  const openEditor = (next: Editor) => {
    setError(''); setCanRetry(false); setNotice(''); setEditor(next);
    setName(next.type === 'folder' ? next.folder?.name ?? '' : next.type === 'upload' ? next.file.name.replace(/\.[^.]+$/, '') : next.image.name);
    setFolderId(next.type === 'image' ? next.image.folderId : currentFolder?.id ?? files.folders[0]?.id ?? '');
    setVariant(next.type === 'folder' ? next.folder?.variant ?? 'heart' : 'heart');
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

  const normalizedQuery = query.trim().toLocaleLowerCase('ko');
  // The folder in front: the chosen one, or the first folder when nothing is chosen yet.
  const frontId = currentFolder?.id ?? (location === 'all' ? 'all' : files.folders[0]?.id ?? 'all');
  const folderName = (id: string) => files.folders.find(folder => folder.id === id)?.name ?? '';
  // Search covers every price list in this archive (folder names too); without a query, only the front folder.
  const visibleImages = normalizedQuery
    ? files.images.filter(image => `${image.name} ${folderName(image.folderId)}`.toLocaleLowerCase('ko').includes(normalizedQuery))
    : files.images.filter(image => frontId === 'all' || image.folderId === frontId);
  const tabs = [{ id: 'all', name: '전체 가격표', count: files.images.length }, ...files.folders.map(folder => ({ id: folder.id, name: folder.name, count: files.images.filter(image => image.folderId === folder.id).length }))];
  const front = tabs.find(tab => tab.id === frontId) ?? tabs[0];
  const frontFolder = files.folders.find(folder => folder.id === front.id);
  const path = opened ? `${files.folders.find(folder => folder.id === opened.folderId)?.name ?? '가격표'} / ${opened.name}` : currentFolder?.name ?? (location === 'all' ? '전체 가격표' : '프로그램 폴더');

  function renderImages() {
    if (!visibleImages.length) return loading ? <div className="pf-loading"><LoadingBox label="가격표 불러오는 중…" /></div>
      : <p className="pf-empty">{query ? '검색 결과가 없습니다. 시술명이나 카테고리 이름으로 검색해 보세요.' : '이 카테고리에 가격표 이미지를 추가해 주세요.'}</p>;
    return <ol className="pf-price-list">{visibleImages.map((image, index) => <li key={image.id} className="pf-price-row">
      <button type="button" className="pf-price-open" onClick={() => setGallery({ images: visibleImages, index })}>
        <span className="pf-price-thumb"><img src={image.src} alt="" loading="lazy" /></span>
        <span className="pf-price-text"><small>{String(index + 1).padStart(2, '0')}{(normalizedQuery || frontId === 'all') && folderName(image.folderId) ? ` · ${folderName(image.folderId)}` : ''}</small><strong>{image.name}</strong><em>가격표 열기</em></span>
      </button>
      {files.authenticated && <div className="pf-image-actions"><button type="button" aria-label={`${image.name} 이름·폴더 변경`} onClick={() => openEditor({ type: 'image', image })}><Pencil size={14} />정리</button><button type="button" aria-label={`${image.name} 삭제`} onClick={() => openEditor({ type: 'delete', image })}><Trash2 size={14} />삭제</button></div>}
    </li>)}</ol>;
  }

  return <div className="file-explorer price-file-manager">
    <div className="pf-navigation">
      <button type="button" aria-label="뒤로" disabled={!opened && cursor === 0} onClick={() => travel(-1)}><ArrowLeft size={22} /></button>
      <button type="button" aria-label="앞으로" disabled={cursor >= trail.length - 1 || !!opened} onClick={() => travel(1)}><ArrowRight size={22} /></button>
      <button type="button" aria-label="프로그램 폴더로" onClick={() => navigate('folders')}><Home size={20} /></button>
      <div className="pf-address">{path}</div>
    </div>
    <div className="pf-workspace">
      {opened && gallery ? <ImageDocumentViewer name={opened.name} src={opened.src} variants={opened.variants} index={gallery.index} count={gallery.images.length}
        onNavigate={index => setGallery(current => current && index >= 0 && index < current.images.length ? { ...current, index } : current)}
        onBack={() => setGallery(null)} /> : <section className="pf-content" aria-label={path}>
        <div className="pf-tools">
          <label className="pf-search"><Search size={17} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="시술명·카테고리 검색" aria-label="가격표 검색" /></label>
          <div className="pf-tools-actions">{files.authenticated ? <>
            <button type="button" onClick={() => openEditor({ type: 'folder' })}><FolderPlus size={17} />새 폴더</button>
            <button type="button" onClick={() => upload.current?.click()}><Plus size={18} />이미지 추가</button>
          </> : <a href="/signin-with-chatgpt?return_to=%2F" target="_top">로그인 후 정리</a>}</div>
          <input ref={upload} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => {
            const file = event.target.files?.[0]; event.target.value = '';
            if (!file) return;
            if (file.size > 10 * 1024 * 1024) { setError('10MB 이하의 이미지를 선택해 주세요.'); setCanRetry(false); return; }
            openEditor({ type: 'upload', file });
          }} />
        </div>
        {error && !editor && <div role="alert" className="pf-feedback">{error}{canRetry && <button type="button" onClick={() => void refresh()}>다시 불러오기</button>}</div>}
        <div className="pf-scroll">
          {normalizedQuery ? <section className="pf-sheet pf-search-sheet" aria-label="가격표 검색 결과">
            <header className="pf-sheet-head"><div><span className="pf-sheet-no">검색</span><h2>‘{query.trim()}’ 검색 결과</h2></div><span className="pf-sheet-count">{visibleImages.length}개</span></header>
            {renderImages()}
          </section> : <>
            <nav className="pf-folder-tabs" aria-label="가격표 카테고리">
              {tabs.map((tab, index) => <button key={tab.id} type="button" className="pf-folder-tab" data-tone={index % 4} aria-pressed={tab.id === front.id}
                onClick={() => { if (tab.id !== front.id) navigate(tab.id); }}>
                <span className="pf-tab-no">{String(index).padStart(2, '0')}</span><strong>{tab.name}</strong><small>{tab.count}개</small>
              </button>)}
            </nav>
            <section className="pf-sheet" data-tone={tabs.indexOf(front) % 4} aria-label={`${front.name} 가격표`} key={front.id}>
              <header className="pf-sheet-head">
                <div><span className="pf-sheet-no">{String(tabs.indexOf(front)).padStart(2, '0')}</span><h2>{front.name}</h2></div>
                <div className="pf-sheet-tools"><span className="pf-sheet-count">가격표 {visibleImages.length}개</span>
                  {files.authenticated && frontFolder && <button type="button" onClick={() => openEditor({ type: 'folder', folder: frontFolder })}><Pencil size={14} />이름 변경</button>}</div>
              </header>
              {renderImages()}
            </section>
          </>}
        </div>
        <footer className="pf-status"><span>카테고리 {files.folders.length}개 · 가격표 {files.images.length}개</span><span role="status">{loading ? '불러오는 중' : notice}</span></footer>
      </section>}
    </div>
    {editor && <KittyDialog title={editor.type === 'delete' ? '휴지통으로 이동' : editor.type === 'folder' && !editor.folder ? '새 폴더' : '저장 확인'} onClose={closeEditor} busy={pending}>
      <form onSubmit={save}>
        {editor.type === 'delete' ? <p className="kitty-question">‘{editor.image.name}’ 가격표를 휴지통으로 옮길까요?<br />휴지통에서 복원할 수 있습니다.</p> : <>
          {editor.type === 'upload' && preview && <img className="pf-upload-preview" src={preview} alt="추가할 가격표" />}
          <label className="kitty-field">{editor.type === 'folder' ? '폴더 이름' : '가격표 이름'}<input autoFocus required maxLength={100} value={name} onChange={event => setName(event.target.value)} disabled={pending} /></label>
          {editor.type !== 'folder' && <label className="kitty-field">저장할 폴더<select value={folderId} onChange={event => setFolderId(event.target.value)} disabled={pending} required>{files.folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>}
          {editor.type === 'folder' && !editor.folder && <fieldset className="pf-folder-options"><legend>폴더 모양</legend>{(['heart', 'kitty', 'flower', 'cherry'] as const).map((value, index) => <button key={value} type="button" aria-label={['하트', '키티', '꽃', '체리'][index]} aria-pressed={variant === value} disabled={pending} onClick={() => setVariant(value)}><PinkFolderIcon variant={value} /></button>)}</fieldset>}
        </>}
        {error && <p className="kitty-error" role="alert">{error}</p>}
        <footer className="kitty-dialog-actions"><button type="button" onClick={closeEditor} disabled={pending}>취소</button><button type="submit" className="kitty-primary" disabled={pending || (editor.type !== 'delete' && !name.trim())}>{pending ? '처리 중…' : editor.type === 'delete' ? '휴지통으로 이동' : '저장'}</button></footer>
      </form>
    </KittyDialog>}
  </div>;
}

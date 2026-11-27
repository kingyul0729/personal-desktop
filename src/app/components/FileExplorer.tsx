import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, FolderInput, GripVertical, Minus, Pencil, Plus, Printer, Trash2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { KittyDialog } from './KittyDialog';
import { askConfirm } from './AlertDialog';
import { LoadingBox, SavingMark } from './Feedback';
import { announceTrash, useTrashChange } from '../trash';
import { ProgramCompare, ProgramEditor, emptyPrograms, loadPrograms, sendPrograms, type ProgramData } from './PriceProgramCompare';
import { initialPriceFiles, type PriceFiles, type PriceFolder, type PriceImage } from '../priceFiles';

// 가격표(2026-11-21 사용자가 다른 앱 화면으로 지정 — 폴더·썸네일을 눌러 여는 방식 대신 '탭에서 바로 넘겨 보기'):
// 맨 위 카테고리 탭(이름 + 장수) → 고른 탭의 가격표가 화면 가득, 좌우로 밀거나 ‹ › 로 넘김, 아래 점 + 'N / M'.
// 아이패드를 돌리면 가로·세로 그림 중 맞는 것(한쪽만 있으면 있는 것). 한 번 탭 = 버튼 숨기기/보이기, 두 번 탭 = 2.5배 확대(다시 두 번 탭 = 원래).
// [편집]: 가격표마다 한 줄 — ≡ 끌어서 순서, 가로·세로 칸(빈 칸 누르면 올리기, 채운 칸 누르면 교체), 이름 고치기, 삭제, 맨 아래 가격표 추가,
// 탭 이름 고치기·삭제·새 탭·묶음 파일로 넣기. 색은 앱 기본색 그대로(갈색 배경 안 씀).
const ZOOM = 2.5;
const post = async (body: unknown) => {
  const response = await fetch('/api/price-files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || '저장하지 못했습니다. 다시 시도해 주세요.');
  return data as PriceFiles;
};
const sendImage = async (fields: Record<string, string | File>) => {
  const form = new FormData(); for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const response = await fetch('/api/price-images', { method: 'POST', body: form });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || '올리지 못했습니다. 다시 시도해 주세요.');
  return data as PriceFiles;
};
const useTall = () => {
  const get = () => typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
  const [tall, setTall] = useState(get);
  useEffect(() => { const on = () => setTall(get()); window.addEventListener('resize', on); window.addEventListener('orientationchange', on); return () => { window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on); }; }, []);
  return tall;
};
export const sideOf = (image: PriceImage, tall: boolean) => (tall ? image.variants?.portrait : image.variants?.landscape) || image.src;

type Dialog = { type: 'name'; image: PriceImage } | { type: 'folder'; folder?: PriceFolder } | { type: 'add'; file: File; folderId?: string };
// 순서지(2026-11-27 사용자 '프로그램마다 순서지 그림을 넣고 그대로 프린트'): 이름이 '순서지'인 탭에 그림을 모아 두고 탭 줄에는 안 보임
const SHEET = '순서지';

export function FileExplorer({ onFolders, goto, onLocation }: { onFolders?: (folders: { id: string; name: string }[]) => void; goto?: { id: string; n: number }; onLocation?: (id: string) => void } = {}) {
  const [files, setFiles] = useState<PriceFiles>(initialPriceFiles);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('price-tab') || ''; } catch { return ''; } });
  const [pages, setPages] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [name, setName] = useState('');
  const tall = useTall();
  // 프로그램 비교(2026-11-26 사용자): [한 장] [프로그램 비교] — 비교는 상담용이라 탭 줄·편집 버튼 숨김
  const [mode, setMode] = useState<'one' | 'compare' | 'print'>(() => { try { const m = localStorage.getItem('price-mode'); return m === 'compare' || m === 'print' ? m : 'one'; } catch { return 'one'; } });
  useEffect(() => { try { localStorage.setItem('price-mode', mode); } catch { /* 이 기기 편의 */ } }, [mode]);
  const [programs, setPrograms] = useState<ProgramData>(emptyPrograms);
  useEffect(() => { if (editing) loadPrograms().then(setPrograms).catch(() => undefined); }, [editing]);

  async function refresh(signal?: AbortSignal) {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/price-files', { signal, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setFiles(data);
    } catch (e) { if ((e as Error).name !== 'AbortError') setError('가격표를 불러오지 못했습니다.'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => { const c = new AbortController(); void refresh(c.signal); return () => c.abort(); }, []);
  useTrashChange('price', () => { void refresh(); });
  // 탭이 화면 위에 있으니 왼쪽 메뉴에는 하위 목록을 두지 않는다(고르면 메뉴가 접힘)
  useEffect(() => { onFolders?.([]); }, []);
  const folders = files.folders.filter(f => f.name !== SHEET);
  const sheetFolder = files.folders.find(f => f.name === SHEET);
  const sheets = useMemo(() => files.images.filter(i => i.folderId === sheetFolder?.id), [files.images, sheetFolder?.id]);
  const current = folders.find(f => f.id === tab || f.id.endsWith(`:${tab}`)) ?? folders[0];
  useEffect(() => { if (current) { try { localStorage.setItem('price-tab', current.id); } catch { /* 이 기기 편의 */ } onLocation?.(current.id); } }, [current?.id]);
  useEffect(() => { if (goto) setTab(goto.id); }, [goto?.n]);
  const images = useMemo(() => files.images.filter(i => i.folderId === current?.id), [files.images, current?.id]);
  const page = Math.min(pages[current?.id ?? ''] ?? 0, Math.max(0, images.length - 1));
  const go = (n: number) => current && setPages(p => ({ ...p, [current.id]: Math.max(0, Math.min(images.length - 1, n)) }));

  const run = async (job: () => Promise<PriceFiles>, done = '') => {
    setPending(true); setError(''); setNotice('');
    try { setFiles(await job()); if (done) setNotice(done); return true; }
    catch (e) { setError((e as Error).message || '저장하지 못했습니다.'); return false; }
    finally { setPending(false); }
  };
  // 파일 고르기(가격표 추가 / 가로·세로 교체 / 묶음 파일)
  const picker = useRef<HTMLInputElement>(null);
  const pickFor = useRef<null | ((file: File) => void)>(null);
  const pick = (accept: string, then: (file: File) => void) => { pickFor.current = then; if (picker.current) { picker.current.accept = accept; picker.current.click(); } };
  const IMG = 'image/jpeg,image/png,image/webp';
  const tooBig = (f: File) => { if (f.size > 10 * 1024 * 1024) { setError('10MB 이하의 이미지를 골라 주세요.'); return true; } return false; };
  const replace = (image: PriceImage, side: 'landscape' | 'portrait') => pick(IMG, f => { if (!tooBig(f)) void run(() => sendImage({ file: f, id: image.id, side })); });
  const removePortrait = async (image: PriceImage) => {
    if (!await askConfirm({ title: '삭제하시겠습니까?', message: `‘${image.name}’ 세로 그림`, kind: 'delete' })) return;
    void run(() => post({ action: 'remove-portrait', id: image.id }));
  };
  const removeImage = async (image: PriceImage) => {
    if (!await askConfirm({ title: '삭제하시겠습니까?', message: `‘${image.name}’`, kind: 'delete' })) return;
    if (await run(() => post({ action: 'delete-image', id: image.id }), '휴지통으로 이동했습니다.')) announceTrash('price');
  };
  const removeFolder = async (folder: PriceFolder) => {
    if (!await askConfirm({ title: '삭제하시겠습니까?', message: `‘${folder.name}’ 탭 · 가격표 ${images.length}장`, kind: 'delete' })) return;
    if (await run(() => post({ action: 'delete-folder', id: folder.id }), '휴지통으로 이동했습니다.')) { announceTrash('price'); setTab(''); }
  };
  const openDialog = (d: Dialog) => { setError(''); setDialog(d); setName(d.type === 'name' ? d.image.name : d.type === 'folder' ? d.folder?.name ?? '' : d.file.name.replace(/\.[^.]+$/, '')); };
  const saveDialog = async () => {
    if (!dialog || !name.trim()) return;
    const d = dialog;
    const ok = await run(() => d.type === 'name' ? post({ action: 'edit-image', id: d.image.id, name: name.trim(), folderId: d.image.folderId })
      : d.type === 'folder' ? post({ action: d.folder ? 'rename-folder' : 'create-folder', id: d.folder?.id, name: name.trim(), variant: 'heart' })
        : sendImage({ file: d.file, name: name.trim(), folderId: d.folderId ?? current!.id }));
    if (ok) {
      setDialog(null);
      if (d.type === 'folder' && !d.folder) setFiles(f => { const made = f.folders.find(x => x.name === name.trim()); if (made) setTab(made.id); return f; });
    }
  };
  // 순서 바꾸기: ≡ 를 잡고 위아래로 끌기 → 놓으면 저장
  const [drag, setDrag] = useState<{ id: string; y0: number; dy: number; h: number; from: number } | null>(null);
  const dragTo = drag ? Math.max(0, Math.min(images.length - 1, drag.from + Math.round(drag.dy / drag.h))) : -1;
  const ordered = useMemo(() => {
    if (!drag) return images;
    const list = images.slice(); const [moved] = list.splice(drag.from, 1); list.splice(dragTo, 0, moved); return list;
  }, [images, drag, dragTo]);
  const startDrag = (e: RPointerEvent, image: PriceImage, index: number) => {
    const row = (e.currentTarget as HTMLElement).closest('.pb-row') as HTMLElement | null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: image.id, y0: e.clientY, dy: 0, h: (row?.offsetHeight ?? 90) + 10, from: index });
  };
  const endDrag = () => {
    if (!drag || !current) return;
    const ids = ordered.map(i => i.id); const changed = dragTo !== drag.from;
    setDrag(null);
    if (changed) { setFiles(f => ({ ...f, images: [...f.images.filter(i => i.folderId !== current.id), ...ids.map(id => f.images.find(i => i.id === id)!)] })); void run(() => post({ action: 'reorder', folderId: current.id, ids })); }
  };
  // 묶음 파일로 넣기(2026-11-13): { format: 'dachaeum-pricelist', folders: [{ name, images: [{ name, type, data }] }] } — 같은 이름 탭이면 거기에, 같은 이름 가격표는 건너뜀
  // 묶음 파일(2026-11-22 세로 그림 함께): 그림마다 { name, type, data, portrait?: { type, data } } — 세로가 있으면 같은 가격표의 세로 칸으로.
  // 같은 이름이 이미 있으면 그림은 그대로 두고, 세로 칸이 비어 있을 때만 세로를 채움. 다 넣은 뒤 탭 안 순서는 파일 순서대로(파일에 없는 가격표는 뒤에).
  const importBundle = async (file: File) => {
    setPending(true); setError(''); setNotice('');
    let added = 0, skipped = 0, tall = 0, now = files;
    const toFile = (name: string, x: { type?: string; data: string }) => { const type = x.type || 'image/webp'; return new File([Uint8Array.from(atob(x.data), c => c.charCodeAt(0))], `${name}.${type.split('/')[1]}`, { type }); };
    try {
      const j = JSON.parse(await file.text());
      if (j?.format !== 'dachaeum-pricelist' || !Array.isArray(j.folders)) throw new Error('가격표 묶음 파일이 아니에요.');
      for (const f of j.folders as { name: string; images: { name: string; type: string; data: string; portrait?: { type: string; data: string } }[] }[]) {
        let folder = now.folders.find(x => x.name === f.name);
        if (!folder) { now = await post({ action: 'create-folder', name: f.name, variant: 'heart' }); folder = now.folders.find(x => x.name === f.name); if (!folder) throw new Error(`'${f.name}' 탭을 만들지 못했어요.`); }
        for (const image of f.images || []) {
          let item = now.images.find(x => x.folderId === folder!.id && x.name === image.name);
          if (item) skipped++;
          else { now = await sendImage({ file: toFile(image.name, image), name: image.name, folderId: folder.id }); added++; item = now.images.filter(x => x.folderId === folder!.id && x.name === image.name).pop(); }
          if (image.portrait && item && !item.ownPortrait) { now = await sendImage({ file: toFile(`${image.name}-세로`, image.portrait), id: item.id, side: 'portrait' }); tall++; }
          setFiles(now);
        }
        const names = (f.images || []).map(x => x.name), inTab = now.images.filter(x => x.folderId === folder!.id);
        const ids = [...names.map(n => inTab.find(x => x.name === n)?.id).filter((x): x is string => !!x), ...inTab.filter(x => !names.includes(x.name)).map(x => x.id)];
        if (ids.length > 1) now = await post({ action: 'reorder', folderId: folder.id, ids });
      }
      setNotice([`${added}장 넣음`, tall ? `세로 ${tall}장` : '', skipped ? `이미 있는 ${skipped}장` : ''].filter(Boolean).join(' · '));
    } catch (e) { setError(`${(e as Error).message || '파일을 읽지 못했어요.'}${added ? ` (${added}장까지 넣음)` : ''}`); }
    finally { setFiles(now); setPending(false); }
  };

  // 순서지 추가: 그림이면 이름을 받아 '순서지' 탭에(없으면 만듦), 묶음 파일(.json)이면 묶음 넣기와 같은 길
  const addSheet = () => pick(`${IMG},application/json,.json`, async f => {
    if (/json/.test(f.type) || f.name.endsWith('.json')) { void importBundle(f); return; }
    if (tooBig(f)) return;
    let id = sheetFolder?.id;
    if (!id) { try { setPending(true); const now = await post({ action: 'create-folder', name: SHEET, variant: 'heart' }); setFiles(now); id = now.folders.find(x => x.name === SHEET)?.id; } catch (e) { setError((e as Error).message); } finally { setPending(false); } }
    if (id) openDialog({ type: 'add', file: f, folderId: id });
  });
  const removeSheet = async (image: PriceImage) => {
    if (!await askConfirm({ title: '삭제하시겠습니까?', message: `‘${image.name}’ 순서지`, kind: 'delete' })) return;
    if (await run(() => post({ action: 'delete-image', id: image.id }), '휴지통으로 이동했습니다.')) announceTrash('price');
  };

  // 프로그램 파일({format:'dachaeum-programs', lines:[{category, name, feature, fit}], programs:[{category, name, price?, items?, line?, desc?, fit?}]}) — 같은 탭·같은 이름은 고침(설명만 든 파일이면 금액·구성은 그대로)
  const importPrograms = async (file: File) => {
    setPending(true); setError(''); setNotice('');
    try {
      const j = JSON.parse(await file.text());
      const next = await sendPrograms({ action: 'import', ...j });
      setPrograms(next); setNotice(`프로그램 ${next.programs.length}개 · 라인 ${next.lines.length}개`);
    } catch (e) { setError(e instanceof SyntaxError ? '프로그램 파일이 아니에요.' : (e as Error).message); }
    finally { setPending(false); }
  };

  return <div className={`price-board${editing ? ' is-editing' : ''}`} aria-label="가격표 보관함">
    <header className="pb-top">
      <h2>가격표</h2>
      {mode !== 'one' && !editing ? <span className="pb-spacer" /> : <nav className="pb-tabs" aria-label="카테고리">
        {folders.map(f => { const n = files.images.filter(i => i.folderId === f.id).length; return <button key={f.id} type="button" className={f.id === current?.id ? 'is-on' : ''} onClick={() => setTab(f.id)}>{f.name}<small>{n}</small></button>; })}
        {editing && <button type="button" className="pb-tab-add" onClick={() => openDialog({ type: 'folder' })}><Plus size={15} />탭</button>}
      </nav>}
      {!editing && files.authenticated && <div className="pb-modes" role="group" aria-label="보기">
        <button type="button" aria-pressed={mode === 'one'} onClick={() => setMode('one')}>한 장</button>
        <button type="button" aria-pressed={mode === 'compare'} onClick={() => setMode('compare')}>프로그램 비교</button>
        <button type="button" aria-pressed={mode === 'print'} onClick={() => setMode('print')}>순서지</button></div>}
      {mode !== 'one' && !editing ? null : files.authenticated ? <button type="button" className={`pb-edit${editing ? ' is-on' : ''}`} onClick={() => { setEditing(v => !v); setError(''); setNotice(''); }}>{editing ? '완료' : '편집'}</button>
        : <a className="pb-edit" href="/signin-with-chatgpt?return_to=%2F" target="_top">로그인</a>}
    </header>
    {(error || notice) && <p className={`pb-msg${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}{pending && <SavingMark />}</p>}
    {editing ? <div className="pb-edit-list">
      {current && <div className="pb-folder-tools">
        <button type="button" onClick={() => openDialog({ type: 'folder', folder: current })}><Pencil size={14} />탭 이름</button>
        <button type="button" disabled={pending} onClick={() => void removeFolder(current)}><Trash2 size={14} />탭 삭제</button>
        <button type="button" disabled={pending} onClick={() => pick('application/json,.json', f => void importBundle(f))}><FolderInput size={14} />묶음 파일로 넣기</button>
        <button type="button" disabled={pending} onClick={() => pick('application/json,.json', f => void importPrograms(f))}><FolderInput size={14} />프로그램 파일로 넣기</button>
      </div>}
      {ordered.map(image => <div key={image.id} className={`pb-row${drag?.id === image.id ? ' is-drag' : ''}`}>
        <button type="button" className="pb-grip" aria-label={`${image.name} 순서 옮기기`} style={{ touchAction: 'none' }}
          onPointerDown={e => startDrag(e, image, images.indexOf(image))} onPointerMove={e => drag && setDrag({ ...drag, dy: e.clientY - drag.y0 })} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}><GripVertical size={18} /></button>
        <button type="button" className="pb-th" aria-label={`${image.name} 가로 그림 교체`} onClick={() => replace(image, 'landscape')}><img src={image.variants?.landscape || image.src} alt="" loading="lazy" /><span>가로</span></button>
        {image.hasPortrait ? <span className="pb-th is-tall"><button type="button" aria-label={`${image.name} 세로 그림 교체`} onClick={() => replace(image, 'portrait')}><img src={image.variants?.portrait} alt="" loading="lazy" /><span>세로</span></button>
          {image.ownPortrait && <button type="button" className="pb-th-x" aria-label={`${image.name} 세로 그림 빼기`} onClick={() => void removePortrait(image)}><X size={12} /></button>}</span>
          : <button type="button" className="pb-th is-tall is-empty" aria-label={`${image.name} 세로 그림 올리기`} onClick={() => replace(image, 'portrait')}><Plus size={14} />세로</button>}
        <button type="button" className="pb-name" onClick={() => openDialog({ type: 'name', image })}>{image.name}<small>{image.hasPortrait ? '가로 · 세로' : '가로만'}</small></button>
        <div className="pb-acts"><button type="button" onClick={() => replace(image, 'landscape')}>교체</button><button type="button" onClick={() => void removeImage(image)}>삭제</button></div>
      </div>)}
      {current && <button type="button" className="pb-add" disabled={pending} onClick={() => pick(IMG, f => { if (!tooBig(f)) openDialog({ type: 'add', file: f }); })}><Plus size={16} />가격표 추가</button>}
      {current && <ProgramEditor category={current.name} data={programs} onChange={setPrograms} />}
    </div>
      : mode === 'compare' ? <ProgramCompare />
      : mode === 'print' ? <SheetPrint sheets={sheets} loading={loading} pending={pending} onAdd={addSheet} onRemove={image => void removeSheet(image)} />
      : images.length ? <Pager key={current?.id} images={images} page={page} tall={tall} onPage={go} label={current?.name ?? ''} />
        : <div className="pb-empty">{loading ? <LoadingBox label="가격표 불러오는 중…" /> : '가격표 없음'}</div>}
    <input ref={picker} type="file" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pickFor.current?.(f); }} />
    {dialog && <KittyDialog title={dialog.type === 'folder' ? (dialog.folder ? '탭 이름' : '새 탭') : dialog.type === 'add' ? (dialog.folderId ? '순서지 추가' : '가격표 추가') : '가격표 이름'} onClose={() => !pending && setDialog(null)} busy={pending}>
      <form onSubmit={e => { e.preventDefault(); void saveDialog(); }}>
        <label className="kitty-field">{dialog.type === 'folder' ? '탭 이름' : dialog.type === 'add' && dialog.folderId ? '프로그램 이름' : '가격표 이름'}<input autoFocus required maxLength={100} value={name} onChange={e => setName(e.target.value)} disabled={pending} /></label>
        {error && <p className="kitty-error" role="alert">{error}</p>}
        <footer className="kitty-dialog-actions"><button type="button" onClick={() => setDialog(null)} disabled={pending}>취소</button><button type="submit" className="kitty-primary" disabled={pending || !name.trim()}>{pending ? <><SavingMark />저장 중…</> : '저장'}</button></footer>
      </form>
    </KittyDialog>}
  </div>;
}

// 넘겨 보기(2026-11-22 사용자 화면대로, 가격표 색은 손대지 않고 틀만): 탭 아래에 한 장씩(비율 유지), 좌우로 밀거나 ‹ › 로 넘김, 아래 점 + 'N / M'.
// 그림을 한 번 누르면 꽉 찬 화면(왼쪽 메뉴·탭 없이) — 위 오른쪽 '탭 N / M · − · + · 닫기', 양옆 ‹ ›, 한 번 탭 = 버튼 숨기기/보이기, 두 번 탭 = 2.5배.
function Pager({ images, page, tall, onPage, label }: { images: PriceImage[]; page: number; tall: boolean; onPage: (n: number) => void; label: string }) {
  const [full, setFull] = useState(false);
  const [controls, setControls] = useState(true);
  const [zoom, setZoom] = useState(1);
  const stage = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const tapTimer = useRef<number>();
  const [dx, setDx] = useState(0);
  const image = images[page];
  useEffect(() => { setZoom(1); setDx(0); }, [page, tall, full]);
  useEffect(() => { // 앞뒤 장 미리 받아 두기
    for (const n of [page - 1, page + 1]) if (images[n]) { const img = new Image(); img.src = sideOf(images[n], tall); }
  }, [page, tall, images]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,dialog')) return;
      if (e.key === 'ArrowRight') onPage(page + 1); if (e.key === 'ArrowLeft') onPage(page - 1); if (e.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on);
  }, [page, onPage]);
  const zoomAt = (to: number, x?: number, y?: number) => {
    const el = stage.current; setZoom(to);
    if (!el || to === 1) return;
    const r = el.getBoundingClientRect(); const fx = x === undefined ? 0.5 : (x - r.left) / r.width, fy = y === undefined ? 0.5 : (y - r.top) / r.height;
    requestAnimationFrame(() => { el.scrollLeft = fx * el.scrollWidth - r.width / 2; el.scrollTop = fy * el.scrollHeight - r.height / 2; });
  };
  const onDown = (e: RPointerEvent) => { if (e.pointerType === 'mouse' && e.button !== 0) return; touch.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId }; };
  const onMove = (e: RPointerEvent) => { const s = touch.current; if (!s || s.id !== e.pointerId || zoom > 1) return; const mx = e.clientX - s.x; if (Math.abs(mx) > Math.abs(e.clientY - s.y)) setDx(mx); };
  const onUp = (e: RPointerEvent) => {
    const s = touch.current; touch.current = null; if (!s || s.id !== e.pointerId) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y; setDx(0);
    if (zoom === 1 && Math.abs(mx) > 50 && Math.abs(mx) > Math.abs(my) * 1.3) { onPage(page + (mx < 0 ? 1 : -1)); return; }
    if (Math.abs(mx) > 10 || Math.abs(my) > 10) return;
    if (!full) { setControls(true); setFull(true); return; }
    const prev = lastTap.current, now = { t: e.timeStamp, x: e.clientX, y: e.clientY };
    if (prev && now.t - prev.t < 300 && Math.hypot(now.x - prev.x, now.y - prev.y) < 30) { window.clearTimeout(tapTimer.current); lastTap.current = null; zoomAt(zoom > 1 ? 1 : ZOOM, e.clientX, e.clientY); return; }
    lastTap.current = now; window.clearTimeout(tapTimer.current); tapTimer.current = window.setTimeout(() => setControls(v => !v), 260);
  };
  const nav = <>
    <button type="button" className="pb-float pb-nav is-prev" aria-label="이전 가격표" disabled={page === 0} onClick={() => onPage(page - 1)}><ChevronLeft size={22} /></button>
    <button type="button" className="pb-float pb-nav is-next" aria-label="다음 가격표" disabled={page >= images.length - 1} onClick={() => onPage(page + 1)}><ChevronRight size={22} /></button>
  </>;
  const body = <div className={full ? 'pb-full' : 'pb-view'} role={full ? 'dialog' : undefined} aria-label={full ? `${label} 가격표 크게 보기` : undefined}>
    <div ref={stage} className={`pb-stage${zoom > 1 ? ' is-zoom' : ''}`} style={{ touchAction: zoom > 1 ? 'pan-x pan-y' : 'pan-y' }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { touch.current = null; setDx(0); }}>
      <img key={image.id + String(tall)} src={sideOf(image, tall)} alt={image.name} draggable={false}
        style={zoom > 1 ? { width: `${zoom * 100}%` } : { transform: dx ? `translateX(${dx}px)` : undefined }} />
    </div>
    {full ? controls && <>
      <div className="pb-full-bar"><span>{label} {page + 1} / {images.length}</span>
        <button type="button" aria-label="축소" disabled={zoom === 1} onClick={() => zoomAt(1)}><Minus size={18} /></button>
        <button type="button" aria-label="확대" disabled={zoom > 1} onClick={() => zoomAt(ZOOM)}><Plus size={18} /></button>
        <button type="button" className="pb-full-close" onClick={() => setFull(false)}>닫기</button></div>
      {nav}
    </> : <>
      {nav}
      <div className="pb-dots" aria-label={`${page + 1} / ${images.length}`}>{images.length <= 12 && images.map((x, i) => <button key={x.id} type="button" aria-label={x.name} className={i === page ? 'is-on' : ''} onClick={() => onPage(i)} />)}<span>{page + 1} / {images.length}</span></div>
    </>}
  </div>;
  return full ? <>{createPortal(body, document.body)}<div className="pb-view" /></> : body;
}

// 순서지 프린트(2026-11-27 사용자 '순서지 이미지를 프로그램에 맞게 프린트'): 그림을 고르면 그 그림만 A4 한 장 그대로 인쇄(화면의 다른 것은 인쇄 안 함)
function SheetPrint({ sheets, loading, pending, onAdd, onRemove }: { sheets: PriceImage[]; loading: boolean; pending: boolean; onAdd: () => void; onRemove: (image: PriceImage) => void }) {
  const [pickId, setPickId] = useState('');
  const [printing, setPrinting] = useState<PriceImage | null>(null);
  const chosen = sheets.find(x => x.id === pickId) ?? sheets[0];
  useEffect(() => { const done = () => setPrinting(null); window.addEventListener('afterprint', done); return () => window.removeEventListener('afterprint', done); }, []);
  const print = () => { if (chosen) setPrinting(chosen); };
  return <div className="pb-sheets">
    <div className="pb-sheet-bar">
      <button type="button" className="pb-sheet-add" disabled={pending} onClick={onAdd}><Plus size={15} />순서지 추가</button>
      <button type="button" className="pb-sheet-print" disabled={!chosen} onClick={print}><Printer size={16} />프린트</button>
    </div>
    {sheets.length ? <div className="pb-sheet-grid">
      {sheets.map(x => <div key={x.id} className={`pb-sheet${x.id === chosen?.id ? ' is-on' : ''}`}>
        <button type="button" className="pb-sheet-pick" aria-pressed={x.id === chosen?.id} onClick={() => setPickId(x.id)}><img src={x.src} alt="" loading="lazy" /><b>{x.name}</b></button>
        <button type="button" className="pb-sheet-del" aria-label={`${x.name} 삭제`} onClick={() => onRemove(x)}><Trash2 size={14} /></button>
      </div>)}
    </div> : <div className="pb-empty">{loading ? <LoadingBox label="순서지 불러오는 중…" /> : '순서지 없음'}</div>}
    {printing && createPortal(<div className="pb-print-root"><img src={printing.src} alt={printing.name} onLoad={() => window.setTimeout(() => window.print(), 50)} /></div>, document.body)}
  </div>;
}

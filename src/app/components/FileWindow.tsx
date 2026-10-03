import { useEffect, useState } from 'react';
import { ArrowLeft, FilePlus, FolderPlus, Lock, Save } from 'lucide-react';
import { useDesktop } from '../useDesktop';
import { menuFor, parentChain, type UserFile } from '../desktopModel';
import { formatMemoTime } from '../memos';
import { DesktopIcon } from './DesktopIcon';
import { EntryBadge } from './EntryIcon';
import { DEFAULT_ICONS, libraryIconSrc } from '../iconLibrary';

// One window shows the desktop folder, a folder, or a text file chosen from the desktop or 환경설정.
export function FileWindow() {
  const { data, viewing, setViewing, readFile, act, unlock, openSettings, showMenu, notify } = useDesktop();
  const current = viewing ? data.files.find(file => file.id === viewing) ?? null : null;
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const fileOpen = current?.kind === 'file';

  useEffect(() => {
    if (!fileOpen || !current) return;
    let live = true;
    setState('loading'); setMessage('');
    void readFile(current.id).then(result => {
      if (!live) return;
      if (result.ok) { setContent(result.data.content); setSaved(result.data.content); setState('idle'); }
      else { setState('error'); setMessage(result.error); }
    });
    return () => { live = false; };
  }, [current?.id, fileOpen]);

  const back = () => setViewing(current?.parentId ?? null);
  const open = async (file: UserFile) => {
    if (file.kind === 'folder' && file.locked && !file.unlocked && !(await unlock(file.id))) return;
    setViewing(file.id);
  };
  const menu = (file: UserFile, point: { x: number; y: number }) => showMenu(point, menuFor(file.kind, data.authenticated).map(({ action, label }) => ({ label, onSelect: () => {
    if (action === 'open') void open(file);
    else if (action === 'rename') setRenaming(file.id);
    else if (action === 'security') openSettings('security', file.id);
    else if (action === 'trash') void act({ action: 'trash-file', id: file.id }).then(result => notify(result.ok ? '휴지통으로 이동했습니다.' : result.error));
  } })));

  if (viewing && !current) return <div className="file-window"><p className="settings-empty">이 항목은 휴지통에 있거나 잠긴 폴더 안에 있습니다.</p><button type="button" className="file-window-back" onClick={() => setViewing(null)}><ArrowLeft size={18} />바탕화면</button></div>;

  const path = viewing ? parentChain(data.files, viewing).map(item => item.name).join(' / ') : '바탕화면';
  if (fileOpen && current) {
    return <div className="file-window">
      <div className="file-window-bar">
        <button type="button" aria-label="상위 폴더" onClick={back}><ArrowLeft size={18} /></button>
        <span className="file-window-path">{path}</span>
        <button type="button" disabled={state !== 'idle' || content === saved} onClick={async () => {
          const result = await act({ action: 'save-file', id: current.id, content });
          if (result.ok) { setSaved(content); setMessage(`저장됨 ${formatMemoTime(Date.now())}`); } else setMessage(result.error);
        }}><Save size={16} />저장</button>
      </div>
      {state === 'error' ? <p className="settings-empty">{message}{current.locked && <button type="button" onClick={async () => { if (await unlock(current.id)) setViewing(current.id); }}><Lock size={15} />비밀번호 입력</button>}</p>
        : <textarea className="file-window-text" aria-label={`${current.name} 내용`} value={content} disabled={state === 'loading'} onChange={event => setContent(event.target.value)} />}
      <footer className="file-window-status"><span>{content.length}자</span><span role="status">{state === 'loading' ? '불러오는 중' : content !== saved ? '저장 안 됨' : message}</span></footer>
    </div>;
  }

  const locked = current?.locked && !current.unlocked;
  const children = data.files.filter(file => file.parentId === (viewing ?? null));
  return <div className="file-window">
    <div className="file-window-bar">
      <button type="button" aria-label="상위 폴더" disabled={!viewing} onClick={back}><ArrowLeft size={18} /></button>
      <span className="file-window-path">{path}</span>
      {data.authenticated && !locked && <>
        <button type="button" onClick={async () => { const result = await act({ action: 'create-file', kind: 'file', name: '새 파일', parentId: viewing }); if (result.ok) setRenaming(result.data.created as string); else notify(result.error); }}><FilePlus size={16} />새 파일</button>
        <button type="button" onClick={async () => { const result = await act({ action: 'create-file', kind: 'folder', name: '새 폴더', parentId: viewing }); if (result.ok) setRenaming(result.data.created as string); else notify(result.error); }}><FolderPlus size={16} />새 폴더</button>
      </>}
    </div>
    {locked && current ? <p className="settings-empty"><Lock size={16} />잠긴 폴더입니다. <button type="button" onClick={() => void unlock(current.id)}>비밀번호 입력</button></p>
      : <div className="file-window-grid">
        {children.map(file => <DesktopIcon key={file.id} label={file.name} icon={<EntryBadge target={`file:${file.id}`} fileKind={file.kind} />}
          image={libraryIconSrc(DEFAULT_ICONS[file.kind])} locked={file.locked} onClick={() => void open(file)}
          onMenu={point => menu(file, point)} renaming={renaming === file.id} onCancelRename={() => setRenaming(null)}
          onRename={name => { setRenaming(null); void act({ action: 'rename-file', id: file.id, name }).then(result => { if (!result.ok) notify(result.error); }); }} />)}
        {!children.length && <p className="settings-empty">비어 있습니다.</p>}
      </div>}
  </div>;
}

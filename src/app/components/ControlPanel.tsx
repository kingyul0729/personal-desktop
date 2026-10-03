import { useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, FilePlus, FolderPlus, ImagePlus, Lock, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useDesktop, type SettingsTab } from '../useDesktop';
import { iconArt, parentChain, type UserFile } from '../desktopModel';
import { programs } from '../programs';
import { DesktopIconArt } from './DesktopIcon';
import { EntryBadge } from './EntryIcon';
import { InlineRename } from './InlineRename';

const TABS: [SettingsTab, string][] = [['wallpaper', '배경화면'], ['desktop', '바탕화면'], ['files', '파일 설정'], ['security', '보안 설정']];
const DEFAULT_WALLPAPER = '/wallpapers/pink-cloud-grid.png';

export function ControlPanel() {
  const { data, loaded, settingsTab, setSettingsTab } = useDesktop();
  return <div className="settings">
    <nav className="settings-nav" role="tablist" aria-label="환경설정 메뉴">
      {TABS.map(([tab, label]) => <button key={tab} type="button" role="tab" id={`settings-tab-${tab}`} aria-selected={settingsTab === tab} aria-controls="settings-panel" onClick={() => setSettingsTab(tab)}>{label}</button>)}
    </nav>
    <section className="settings-body" id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${settingsTab}`}>
      {loaded && !data.authenticated ? <p className="settings-empty">로그인하면 설정이 저장되고 다른 기기에서도 그대로 보입니다. <a href="/signin-with-chatgpt?return_to=%2F" target="_top">로그인</a></p>
        : settingsTab === 'wallpaper' ? <WallpaperSettings />
          : settingsTab === 'desktop' ? <DesktopSettings />
            : settingsTab === 'files' ? <FileSettings /> : <SecuritySettings />}
    </section>
  </div>;
}

function useFeedback() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<{ ok: boolean; error?: string }>, done = '') => {
    setBusy(true); setMessage('');
    const result = await work();
    setBusy(false); setMessage(result.ok ? done : result.error ?? '');
    return result.ok;
  };
  return { message, busy, run, view: message ? <p className="settings-message" role="status">{message}</p> : null };
}

function WallpaperSettings() {
  const { data, act, upload } = useDesktop();
  const input = useRef<HTMLInputElement>(null);
  const feedback = useFeedback();
  const { wallpaper, fit } = data.settings;
  const wallpapers = data.assets.filter(asset => asset.kind === 'wallpaper');
  return <>
    <div className="settings-wallpaper-preview" style={{ backgroundImage: `url(${wallpaper?.src ?? DEFAULT_WALLPAPER})`, backgroundSize: fit }} role="img" aria-label="현재 배경화면" />
    <div className="settings-row">
      <button type="button" disabled={feedback.busy} onClick={() => input.current?.click()}><ImagePlus size={17} />이미지 업로드</button>
      <button type="button" disabled={feedback.busy || !wallpaper} onClick={() => feedback.run(() => act({ action: 'set-wallpaper', assetId: null }), '기본 배경으로 바꿨습니다.')}><RotateCcw size={16} />기본 배경으로 복원</button>
    </div>
    <div className="settings-segment" role="group" aria-label="표시 방식">
      {([['cover', '화면 채우기'], ['contain', '맞춤']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={fit === value} disabled={feedback.busy}
        onClick={() => fit !== value && feedback.run(() => act({ action: 'set-fit', fit: value }))}>{label}</button>)}
    </div>
    <div className="settings-gallery" role="group" aria-label="등록한 배경">
      <button type="button" aria-label="기본 배경" aria-pressed={!wallpaper} onClick={() => wallpaper && feedback.run(() => act({ action: 'set-wallpaper', assetId: null }))}><img src={DEFAULT_WALLPAPER} alt="" /></button>
      {wallpapers.map(asset => <button key={asset.id} type="button" aria-label="등록한 배경" aria-pressed={wallpaper?.assetId === asset.id}
        onClick={() => wallpaper?.assetId !== asset.id && feedback.run(() => act({ action: 'set-wallpaper', assetId: asset.id }))}><img src={asset.src} alt="" loading="lazy" /></button>)}
    </div>
    {feedback.view}
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (file) void feedback.run(async () => {
        const uploaded = await upload(file, 'wallpaper');
        return uploaded.ok ? act({ action: 'set-wallpaper', assetId: uploaded.data.id }) : uploaded;
      }, '배경화면을 바꿨습니다.');
    }} />
  </>;
}

function targetOptions(files: UserFile[]) {
  return [...programs.map(program => ({ value: `program:${program.id}`, label: program.label })),
    ...files.map(file => ({ value: `file:${file.id}`, label: `${file.kind === 'folder' ? '폴더' : '파일'} · ${parentChain(files, file.id).map(item => item.name).join(' / ')}` }))];
}

function DesktopSettings() {
  const { data, act, pickIcon } = useDesktop();
  const feedback = useFeedback();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ label: '', icon: null as string | null, target: 'program:notepad', visible: true });
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (await feedback.run(() => act({ action: 'add-shortcut', label: form.label, icon: form.icon, target: form.target, hidden: !form.visible }), '항목을 추가했습니다.')) {
      setAdding(false); setForm({ label: '', icon: null, target: 'program:notepad', visible: true });
    }
  };
  return <>
    <ul className="settings-list">
      {data.items.map((item, index) => {
        const art = iconArt(item, data.assets);
        return <li key={item.id} className={item.hidden ? 'is-hidden' : undefined}>
          <DesktopIconArt icon={<EntryBadge target={item.target} fileKind={item.fileKind} />} variant={art.variant} image={art.image} locked={item.locked} />
          <div className="settings-name">
            {editing === item.id ? <InlineRename value={item.label} label="표시 이름" onCancel={() => setEditing(null)}
              onSave={name => { setEditing(null); void feedback.run(() => act({ action: 'update-item', id: item.id, label: name })); }} />
              : <><strong>{item.label}</strong><small>{item.kind === 'program' ? '프로그램' : item.kind === 'shortcut' ? (item.missing ? '바로가기 · 대상 없음' : '바로가기') : '파일 · 이름은 파일 설정에서 변경'}</small></>}
          </div>
          <label className="settings-toggle"><input type="checkbox" checked={!item.hidden} disabled={feedback.busy}
            onChange={event => feedback.run(() => act({ action: 'update-item', id: item.id, hidden: !event.target.checked }))} />표시</label>
          <div className="settings-actions">
            {item.kind !== 'file' && <button type="button" aria-label={`${item.label} 표시 이름 변경`} onClick={() => setEditing(item.id)}><Pencil size={15} /></button>}
            <button type="button" aria-label={`${item.label} 아이콘 변경`} onClick={async () => {
              const icon = await pickIcon(item.icon);
              if (icon !== undefined) void feedback.run(() => act({ action: 'update-item', id: item.id, icon }));
            }}>아이콘</button>
            <button type="button" aria-label={`${item.label} 위로`} disabled={index === 0 || feedback.busy} onClick={() => feedback.run(() => act({ action: 'move-item', id: item.id, direction: -1 }))}><ArrowUp size={15} /></button>
            <button type="button" aria-label={`${item.label} 아래로`} disabled={index === data.items.length - 1 || feedback.busy} onClick={() => feedback.run(() => act({ action: 'move-item', id: item.id, direction: 1 }))}><ArrowDown size={15} /></button>
            {item.kind === 'shortcut' && <button type="button" aria-label={`${item.label} 바탕화면에서 제거`} onClick={() => feedback.run(() => act({ action: 'remove-shortcut', id: item.id }), '바탕화면에서 제거했습니다. 연결된 원본은 그대로입니다.')}>제거</button>}
          </div>
        </li>;
      })}
    </ul>
    {adding ? <form className="settings-form" onSubmit={add}>
      <label>이름<input required maxLength={100} value={form.label} onChange={event => setForm({ ...form, label: event.target.value })} /></label>
      <label>연결할 대상<select value={form.target} onChange={event => setForm({ ...form, target: event.target.value })}>
        {targetOptions(data.files).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
      <div className="settings-row">
        <button type="button" onClick={async () => { const icon = await pickIcon(form.icon); if (icon !== undefined) setForm(current => ({ ...current, icon })); }}>
          {(() => { const art = iconArt({ icon: form.icon, target: form.target }, data.assets); return <DesktopIconArt icon={<EntryBadge target={form.target} />} variant={art.variant} image={art.image} />; })()}아이콘
        </button>
        <label className="settings-toggle"><input type="checkbox" checked={form.visible} onChange={event => setForm({ ...form, visible: event.target.checked })} />바탕화면에 표시</label>
      </div>
      <div className="settings-row"><button type="button" onClick={() => setAdding(false)}>취소</button><button type="submit" className="is-primary" disabled={feedback.busy || !form.label.trim()}>추가</button></div>
    </form> : <button type="button" className="settings-add" onClick={() => setAdding(true)}><Plus size={17} />항목 추가</button>}
    {feedback.view}
  </>;
}

function FileSettings() {
  const { data, act, unlock, openTarget, openSettings } = useDesktop();
  const feedback = useFeedback();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const folder = data.files.find(file => file.id === folderId) ?? null;
  const current = folder ? folderId : null;
  const children = data.files.filter(file => file.parentId === current);
  const folders = data.files.filter(file => file.kind === 'folder');
  const enter = async (file: UserFile) => {
    if (file.locked && !file.unlocked && !(await unlock(file.id))) return;
    setFolderId(file.id);
  };
  const create = (kind: 'file' | 'folder') => feedback.run(async () => {
    const result = await act({ action: 'create-file', kind, name: kind === 'file' ? '새 파일' : '새 폴더', parentId: current });
    if (result.ok) setRenaming(result.data.created as string);
    return result;
  });
  const blockedTargets = (file: UserFile) => {
    const inside = new Set([file.id]);
    for (let grew = true; grew;) { grew = false; for (const item of data.files) if (item.parentId && inside.has(item.parentId) && !inside.has(item.id)) { inside.add(item.id); grew = true; } }
    return inside;
  };
  return <>
    <nav className="settings-path" aria-label="위치">
      <button type="button" onClick={() => setFolderId(null)}>바탕화면</button>
      {parentChain(data.files, current).map(item => <span key={item.id}><ChevronRight size={14} /><button type="button" onClick={() => setFolderId(item.id)}>{item.name}</button></span>)}
    </nav>
    <div className="settings-row">
      <button type="button" disabled={feedback.busy} onClick={() => create('file')}><FilePlus size={16} />새 파일</button>
      <button type="button" disabled={feedback.busy} onClick={() => create('folder')}><FolderPlus size={16} />새 폴더</button>
      <button type="button" onClick={() => openTarget('program:trash')}><Trash2 size={16} />휴지통 {data.trash.length ? `(${data.trash.length})` : ''}</button>
    </div>
    <ul className="settings-list">
      {children.map(file => {
        const blocked = blockedTargets(file);
        return <li key={file.id}>
          <DesktopIconArt icon={<EntryBadge target={`file:${file.id}`} fileKind={file.kind} />} variant={file.kind === 'folder' ? 'heart' : 'flower'} locked={file.locked} />
          <div className="settings-name">
            {renaming === file.id ? <InlineRename value={file.name} label="파일 이름" onCancel={() => setRenaming(null)}
              onSave={name => { setRenaming(null); void feedback.run(() => act({ action: 'rename-file', id: file.id, name })); }} />
              : <button type="button" className="settings-link" onClick={() => file.kind === 'folder' ? void enter(file) : openTarget(`file:${file.id}`)}>{file.name}</button>}
            <small>{file.kind === 'folder' ? '폴더' : '파일'}{file.locked ? ' · 잠금' : ''}</small>
          </div>
          <div className="settings-actions">
            <button type="button" aria-label={`${file.name} 파일 이름 변경`} onClick={() => setRenaming(file.id)}><Pencil size={15} /></button>
            <select aria-label={`${file.name} 위치`} value={file.parentId ?? ''} disabled={feedback.busy}
              onChange={event => feedback.run(() => act({ action: 'move-file', id: file.id, parentId: event.target.value || null }), '옮겼습니다.')}>
              <option value="">바탕화면</option>
              {folders.filter(item => !blocked.has(item.id)).map(item => <option key={item.id} value={item.id}>{parentChain(data.files, item.id).map(part => part.name).join(' / ')}</option>)}
            </select>
            <button type="button" aria-label={`${file.name} 보안 설정`} onClick={() => openSettings('security', file.id)}><Lock size={15} /></button>
            <button type="button" aria-label={`${file.name} 휴지통으로 이동`} onClick={() => feedback.run(() => act({ action: 'trash-file', id: file.id }), '휴지통으로 이동했습니다.')}><Trash2 size={15} /></button>
          </div>
        </li>;
      })}
      {!children.length && <li className="settings-empty">비어 있습니다.</li>}
    </ul>
    {feedback.view}
  </>;
}

function SecuritySettings() {
  const { data, act, securityId, setSecurityId } = useDesktop();
  const feedback = useFeedback();
  const [fields, setFields] = useState({ password: '', confirm: '', current: '', next: '' });
  const selected = data.files.find(file => file.id === securityId) ?? null;
  const reset = () => setFields({ password: '', confirm: '', current: '', next: '' });
  const set = (key: keyof typeof fields) => ({ value: fields[key], onChange: (event: { target: { value: string } }) => setFields({ ...fields, [key]: event.target.value }) });
  const submit = (body: Record<string, unknown>, done: string) => async (event: FormEvent) => {
    event.preventDefault();
    if (await feedback.run(() => act(body), done)) reset();
  };
  return <>
    <label className="settings-form">잠글 파일·폴더<select value={selected?.id ?? ''} onChange={event => { setSecurityId(event.target.value || null); reset(); }}>
      <option value="">선택해 주세요</option>
      {data.files.map(file => <option key={file.id} value={file.id}>{parentChain(data.files, file.id).map(item => item.name).join(' / ')}{file.locked ? ' (잠금)' : ''}</option>)}
    </select></label>
    {selected && (!selected.locked ? <form className="settings-form" onSubmit={submit({ action: 'lock-set', id: selected.id, password: fields.password }, '잠금을 켰습니다.')}>
      <p className="settings-status">잠금 꺼짐</p>
      <label>비밀번호<input type="password" autoComplete="new-password" minLength={4} maxLength={64} required {...set('password')} /></label>
      <label>비밀번호 확인<input type="password" autoComplete="new-password" minLength={4} maxLength={64} required {...set('confirm')} /></label>
      {fields.confirm && fields.confirm !== fields.password && <p className="settings-message" role="alert">비밀번호가 서로 다릅니다.</p>}
      <button type="submit" className="is-primary" disabled={feedback.busy || fields.password.length < 4 || fields.password !== fields.confirm}><Lock size={15} />잠금 켜기</button>
    </form> : <>
      <p className="settings-status is-on"><Lock size={15} />잠금 켜짐</p>
      <form className="settings-form" onSubmit={submit({ action: 'lock-change', id: selected.id, current: fields.current, next: fields.next }, '비밀번호를 바꿨습니다.')}>
        <label>현재 비밀번호<input type="password" autoComplete="current-password" required {...set('current')} /></label>
        <label>새 비밀번호<input type="password" autoComplete="new-password" minLength={4} maxLength={64} {...set('next')} /></label>
        <div className="settings-row">
          <button type="submit" disabled={feedback.busy || !fields.current || fields.next.length < 4}>비밀번호 변경</button>
          <button type="button" disabled={feedback.busy || !fields.current} onClick={async () => {
            if (await feedback.run(() => act({ action: 'lock-remove', id: selected.id, password: fields.current }), '잠금을 껐습니다.')) reset();
          }}>잠금 끄기</button>
        </div>
      </form>
    </>)}
    {feedback.view}
  </>;
}

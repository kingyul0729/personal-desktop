import { useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useDesktop } from '../useDesktop';
import { capsuleRequest, capsuleSummary, type Capsule, type CapsuleLayout } from '../workCapsules';
import { CapsuleSaveDialog } from './CapsuleSaveDialog';
import { KittyDialog } from './KittyDialog';
import { InlineRename } from './InlineRename';
import { announceTrash, useTrashChange } from '../trash';

export function WorkCapsule({ currentLayout, openLayout, version = 0 }: { currentLayout: () => CapsuleLayout; openLayout: (layout: CapsuleLayout) => void; version?: number }) {
  const { showMenu, notify } = useDesktop();
  const [capsules, setCapsules] = useState<Capsule[]>([]);
  const [authenticated, setAuthenticated] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<CapsuleLayout | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Capsule | null>(null);

  const send = async (body?: Record<string, unknown>) => {
    setBusy(true); setError('');
    const result = await capsuleRequest(body);
    setBusy(false);
    if (!result.ok) { setError(result.error); return false; }
    setCapsules(result.capsules); setAuthenticated(result.authenticated);
    return true;
  };
  // Reloads when a layout was saved from the desktop menu while this window is open.
  useEffect(() => { void send(); }, [version]);
  useTrashChange('capsule', () => { void send(); });

  const startSave = () => {
    const layout = currentLayout();
    if (!layout.windows.length) { setError('열려 있는 창이 없습니다. 작업할 창을 연 뒤 저장해 주세요.'); return; }
    setError(''); setSaving(layout);
  };

  return <div className="work-capsule">
    <header>
      <h2>작업 캡슐</h2>
      <p>현재 작업 화면을 저장하고 다시 열 수 있습니다.</p>
    </header>
    {authenticated ? <button type="button" className="capsule-save" disabled={busy} onClick={startSave}>
      <strong>현재 화면 저장</strong><small>열려 있는 창 상태를 그대로 저장</small>
    </button> : <p className="settings-empty">로그인하면 작업을 저장할 수 있습니다. <a href="/signin-with-chatgpt?return_to=%2F" target="_top">로그인</a></p>}
    {error && !saving && !deleting && <p className="settings-message" role="alert">{error}</p>}
    <h3>저장된 작업</h3>
    <ul className="capsule-list">
      {capsules.map(capsule => {
        const { names, count } = capsuleSummary(capsule.layout);
        return <li key={capsule.id}>
          <div className="capsule-text">
            {renaming === capsule.id ? <InlineRename value={capsule.name} label="작업 이름" onCancel={() => setRenaming(null)}
              onSave={name => { setRenaming(null); void send({ action: 'rename', id: capsule.id, name }); }} />
              : <strong>{capsule.name}</strong>}
            <span>{names.join(' · ')}</span>
            <small>창 {count}개</small>
          </div>
          <button type="button" className="capsule-open" onClick={() => openLayout(capsule.layout)}>이 작업 열기</button>
          <button type="button" className="capsule-more" aria-label={`${capsule.name} 메뉴`} onClick={event => {
            const box = event.currentTarget.getBoundingClientRect();
            showMenu({ x: box.left, y: box.bottom + 4 }, [
              { label: '이름 변경', onSelect: () => setRenaming(capsule.id) },
              { label: '삭제', onSelect: () => { setError(''); setDeleting(capsule); } },
            ]);
          }}><MoreHorizontal size={18} /></button>
        </li>;
      })}
      {!capsules.length && <li className="settings-empty">저장된 작업이 없습니다.</li>}
    </ul>

    {saving && <CapsuleSaveDialog layout={saving} onClose={() => setSaving(null)}
      onSaved={list => { setCapsules(list); setSaving(null); notify('작업을 저장했습니다.'); }} />}
    {deleting && <KittyDialog title="휴지통으로 이동" busy={busy} onClose={() => setDeleting(null)}>
      <p className="kitty-question">‘{deleting.name}’ 작업을 휴지통으로 옮길까요?<br />휴지통에서 복원할 수 있고, 메모·파일 등 데이터는 그대로입니다.</p>
      {error && <p className="kitty-error" role="alert">{error}</p>}
      <footer className="kitty-dialog-actions">
        <button type="button" onClick={() => setDeleting(null)} disabled={busy}>취소</button>
        <button type="button" className="kitty-primary" disabled={busy} onClick={async () => { if (await send({ action: 'delete', id: deleting.id })) { setDeleting(null); announceTrash('capsule'); notify('휴지통으로 이동했습니다.'); } }}>휴지통으로 이동</button>
      </footer>
    </KittyDialog>}
  </div>;
}

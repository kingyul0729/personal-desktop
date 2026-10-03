import { useEffect, useState, type FormEvent } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useDesktop } from '../useDesktop';
import { capsuleSummary, defaultCapsuleName, type Capsule, type CapsuleLayout } from '../workCapsules';
import { KittyDialog } from './KittyDialog';
import { InlineRename } from './InlineRename';

const OFFLINE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';

export function WorkCapsule({ currentLayout, openLayout }: { currentLayout: () => CapsuleLayout; openLayout: (layout: CapsuleLayout) => void }) {
  const { showMenu, notify } = useDesktop();
  const [capsules, setCapsules] = useState<Capsule[]>([]);
  const [authenticated, setAuthenticated] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<{ layout: CapsuleLayout; name: string; placeholder: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Capsule | null>(null);

  const send = async (body?: Record<string, unknown>) => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/capsules', body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw new Error(data?.error || OFFLINE);
      setCapsules(data.capsules); setAuthenticated(data.authenticated);
      return true;
    } catch (e) { setError((e as Error).message || OFFLINE); return false; }
    finally { setBusy(false); }
  };
  useEffect(() => { void send(); }, []);

  const startSave = () => {
    const layout = currentLayout();
    if (!layout.windows.length) { setError('열려 있는 창이 없습니다. 작업할 창을 연 뒤 저장해 주세요.'); return; }
    setError(''); setSaving({ layout, name: '', placeholder: defaultCapsuleName(new Date()) });
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!saving || busy) return;
    if (await send({ action: 'create', name: saving.name.trim() || saving.placeholder, layout: saving.layout })) { setSaving(null); notify('작업을 저장했습니다.'); }
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

    {saving && <KittyDialog title="현재 화면 저장" busy={busy} onClose={() => setSaving(null)}>
      <form onSubmit={save}>
        <label className="kitty-field">작업 이름
          <input autoFocus maxLength={100} value={saving.name} placeholder={saving.placeholder} disabled={busy}
            onChange={event => setSaving({ ...saving, name: event.target.value })} />
        </label>
        <p className="kitty-question">{capsuleSummary(saving.layout).names.join(' · ')}</p>
        {error && <p className="kitty-error" role="alert">{error}</p>}
        <footer className="kitty-dialog-actions">
          <button type="button" onClick={() => setSaving(null)} disabled={busy}>취소</button>
          <button type="submit" className="kitty-primary" disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
        </footer>
      </form>
    </KittyDialog>}
    {deleting && <KittyDialog title="작업 삭제" busy={busy} onClose={() => setDeleting(null)}>
      <p className="kitty-question">‘{deleting.name}’ 작업을 삭제할까요?<br />저장된 창 배치만 지워지고 메모·파일 등 데이터는 그대로입니다.</p>
      {error && <p className="kitty-error" role="alert">{error}</p>}
      <footer className="kitty-dialog-actions">
        <button type="button" onClick={() => setDeleting(null)} disabled={busy}>취소</button>
        <button type="button" className="kitty-primary" disabled={busy} onClick={async () => { if (await send({ action: 'delete', id: deleting.id })) setDeleting(null); }}>삭제</button>
      </footer>
    </KittyDialog>}
  </div>;
}

import { useState } from 'react';
import { FileText, Folder, Image as ImageIcon, Layers, StickyNote } from 'lucide-react';
import { useDesktop } from '../useDesktop';
import { formatMemoTime } from '../memos';
import { KittyDialog } from './KittyDialog';
import type { TrashEntry } from '../desktopModel';
import { announceTrash } from '../trash';

const ICONS = { folder: Folder, file: FileText, memo: StickyNote, price: ImageIcon, capsule: Layers };
const KIND_TEXT = { folder: '폴더는 안의 파일까지', file: '파일은', memo: '메모는', price: '가격표는 이미지까지', capsule: '작업은' };

export function TrashWindow() {
  const { data, act, notify } = useDesktop();
  const [confirm, setConfirm] = useState<TrashEntry | 'all' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (body: Record<string, unknown>, done: (result: Record<string, unknown>) => string) => {
    setBusy(true); setError('');
    const result = await act(body);
    setBusy(false);
    if (!result.ok) { setError(result.error); return false; }
    notify(done(result.data)); return true;
  };
  return <div className="trash-window">
    <div className="file-window-bar">
      <span className="file-window-path">휴지통 {data.trash.length}개</span>
      <button type="button" disabled={!data.trash.length || busy} onClick={() => { setError(''); setConfirm('all'); }}>휴지통 비우기</button>
    </div>
    {data.trash.length ? <ul className="trash-list">
      {data.trash.map(item => { const Icon = ICONS[item.kind] ?? FileText; return <li key={`${item.type}:${item.id}`}>
        <Icon size={18} />
        <div><strong>{item.name}</strong><small>{formatMemoTime(item.trashedAt)} 삭제 · 원래 위치 {item.location}</small></div>
        <button type="button" disabled={busy} onClick={() => void run({ action: 'restore-file', type: item.type, id: item.id }, result => item.type === 'file' && result.restoredTo === null && item.location !== '바탕화면' ? '원래 폴더가 없어 바탕화면으로 복원했습니다.' : `${item.location}(으)로 복원했습니다.`).then(ok => { if (ok && item.type !== 'file') announceTrash(item.type); })}>복원</button>
        <button type="button" className="is-danger" disabled={busy} onClick={() => { setError(''); setConfirm(item); }}>완전 삭제</button>
      </li>; })}
    </ul> : <p className="settings-empty">휴지통이 비어 있습니다.</p>}
    {error && !confirm && <p className="settings-message" role="alert">{error}</p>}
    {confirm && <KittyDialog title="완전 삭제" busy={busy} onClose={() => setConfirm(null)}>
      <p className="kitty-question">{confirm === 'all' ? '휴지통의 모든 항목이 완전히 삭제되며 복구할 수 없습니다.' : <>‘{confirm.name}’<br />이 {KIND_TEXT[confirm.kind] ?? '항목은'} 완전히 삭제되며 복구할 수 없습니다.</>}</p>
      {error && <p className="kitty-error" role="alert">{error}</p>}
      <footer className="kitty-dialog-actions">
        <button type="button" disabled={busy} onClick={() => setConfirm(null)}>취소</button>
        <button type="button" className="kitty-primary" disabled={busy} onClick={async () => {
          const ok = confirm === 'all'
            ? await run({ action: 'empty-trash' }, result => result.skipped ? `잠긴 항목 ${result.skipped}개는 남겨 두었습니다.` : '휴지통을 비웠습니다.')
            : await run({ action: 'purge-file', type: confirm.type, id: confirm.id }, () => '완전히 삭제했습니다.');
          if (ok) setConfirm(null);
        }}>{busy ? '삭제 중…' : '완전 삭제'}</button>
      </footer>
    </KittyDialog>}
  </div>;
}

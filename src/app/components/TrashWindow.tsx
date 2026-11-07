import { useEffect, useState } from 'react';
import { BookOpen, FileText, Folder, Image as ImageIcon, Layers, Presentation, StickyNote } from 'lucide-react';
import { useDesktop } from '../useDesktop';
import { formatMemoTime } from '../memos';
import { KittyDialog } from './KittyDialog';
import type { TrashEntry } from '../desktopModel';
import { announceTrash, useTrashChange } from '../trash';

const ICONS = { folder: Folder, file: FileText, memo: StickyNote, price: ImageIcon, capsule: Layers };
const KIND_TEXT = { folder: '폴더는 안의 파일까지', file: '파일은', memo: '메모는', price: '가격표는 이미지까지', capsule: '작업은' };

// 업무 자료·공부 기록은 각자 저장소(/api/work, /api/study)에 있어 여기서 따로 불러와 같은 목록에 보인다.
type Extra = { type: 'work' | 'study'; id: string; name: string; trashedAt: number; version: number; location: string };
const read = async (url: string) => { const response = await fetch(url, { cache: 'no-store' }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || '불러오지 못했습니다.'); return data; };

export function TrashWindow() {
  const { data, act, notify } = useDesktop();
  const [extra, setExtra] = useState<Extra[]>([]);
  const loadExtra = async () => {
    try {
      const [work, study] = await Promise.all([read('/api/work'), read('/api/study')]);
      setExtra([
        ...(work.docs ?? []).filter((doc: { trashedAt: number | null }) => doc.trashedAt).map((doc: { id: string; title: string; trashedAt: number; updatedAt: number; kind: string }) => ({ type: 'work' as const, id: doc.id, name: doc.title, trashedAt: doc.trashedAt, version: doc.updatedAt, location: doc.kind === 'consult' ? '업무 자료 · 상담자료' : '업무 자료 · 업무 매뉴얼' })),
        ...(study.records ?? []).filter((item: { trashedAt: number | null }) => item.trashedAt).map((item: { id: string; title: string; trashedAt: number; updatedAt: number; category: string }) => ({ type: 'study' as const, id: item.id, name: item.title, trashedAt: item.trashedAt, version: item.updatedAt, location: `공부 보관함 · ${item.category}` })),
      ]);
    } catch { /* 로그인 전이거나 일시 오류: 다른 휴지통 항목은 그대로 보인다 */ }
  };
  useEffect(() => { void loadExtra(); }, []);
  useTrashChange('work', () => void loadExtra());
  useTrashChange('study', () => void loadExtra());
  const extraCall = async (item: Extra, method: 'PATCH' | 'DELETE') => {
    const base = item.type === 'work' ? `/api/work/docs/${item.id}` : `/api/study/records/${item.id}`;
    const response = await fetch(base, method === 'PATCH' ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'restore', version: item.version }) } : { method });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || '처리하지 못했습니다.');
  };
  const runExtra = async (item: Extra, method: 'PATCH' | 'DELETE') => {
    setBusy(true); setError('');
    try { await extraCall(item, method); notify(method === 'PATCH' ? `${item.location}(으)로 복원했습니다.` : '완전히 삭제했습니다.'); announceTrash(item.type); await loadExtra(); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  };
  const total = data.trash.length + extra.length;
  const [confirm, setConfirm] = useState<TrashEntry | Extra | 'all' | null>(null);
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
      <span className="file-window-path">휴지통 {total}개 · 모든 메뉴에서 지운 항목</span>
      <button type="button" disabled={!total || busy} onClick={() => { setError(''); setConfirm('all'); }}>휴지통 비우기</button>
    </div>
    {total ? <ul className="trash-list">
      {data.trash.map(item => { const Icon = ICONS[item.kind] ?? FileText; return <li key={`${item.type}:${item.id}`}>
        <Icon size={18} />
        <div><strong>{item.name}</strong><small>{formatMemoTime(item.trashedAt)} 삭제 · 원래 위치 {item.location}</small></div>
        <button type="button" disabled={busy} onClick={() => void run({ action: 'restore-file', type: item.type, id: item.id }, result => item.type === 'file' && result.restoredTo === null && item.location !== '바탕화면' ? '원래 폴더가 없어 바탕화면으로 복원했습니다.' : `${item.location}(으)로 복원했습니다.`).then(ok => { if (ok && item.type !== 'file') announceTrash(item.type); })}>복원</button>
        <button type="button" className="is-danger" disabled={busy} onClick={() => { setError(''); setConfirm(item); }}>완전 삭제</button>
      </li>; })}
      {[...extra].sort((a, b) => b.trashedAt - a.trashedAt).map(item => { const Icon = item.type === 'work' ? Presentation : BookOpen; return <li key={`${item.type}:${item.id}`}>
        <Icon size={18} />
        <div><strong>{item.name}</strong><small>{formatMemoTime(item.trashedAt)} 삭제 · 원래 위치 {item.location}</small></div>
        <button type="button" disabled={busy} onClick={() => void runExtra(item, 'PATCH')}>복원</button>
        <button type="button" className="is-danger" disabled={busy} onClick={() => { setError(''); setConfirm(item); }}>완전 삭제</button>
      </li>; })}
    </ul> : <p className="settings-empty">휴지통이 비어 있습니다.</p>}
    {error && !confirm && <p className="settings-message" role="alert">{error}</p>}
    {confirm && <KittyDialog title="완전 삭제" busy={busy} onClose={() => setConfirm(null)}>
      <p className="kitty-question">{confirm === 'all' ? '휴지통의 모든 항목이 완전히 삭제되며 복구할 수 없습니다.' : <>‘{confirm.name}’<br />이 {'kind' in confirm ? KIND_TEXT[confirm.kind] ?? '항목은' : confirm.type === 'work' ? '자료는 첨부까지' : '기록은 첨부까지'} 완전히 삭제되며 복구할 수 없습니다.</>}</p>
      {error && <p className="kitty-error" role="alert">{error}</p>}
      <footer className="kitty-dialog-actions">
        <button type="button" disabled={busy} onClick={() => setConfirm(null)}>취소</button>
        <button type="button" className="kitty-primary" disabled={busy} onClick={async () => {
          let ok: boolean;
          if (confirm === 'all') {
            setBusy(true);
            try { for (const item of extra) await extraCall(item, 'DELETE'); } catch (e) { setError((e as Error).message); }
            setBusy(false);
            if (extra.length) { announceTrash('work'); announceTrash('study'); await loadExtra(); }
            ok = data.trash.length ? await run({ action: 'empty-trash' }, result => result.skipped ? `잠긴 항목 ${result.skipped}개는 남겨 두었습니다.` : '휴지통을 비웠습니다.') : (notify('휴지통을 비웠습니다.'), true);
          } else if (!('kind' in confirm)) ok = await runExtra(confirm, 'DELETE');
          else ok = await run({ action: 'purge-file', type: confirm.type, id: confirm.id }, () => '완전히 삭제했습니다.');
          if (ok) setConfirm(null);
        }}>{busy ? '삭제 중…' : '완전 삭제'}</button>
      </footer>
    </KittyDialog>}
  </div>;
}

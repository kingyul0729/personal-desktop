import { useEffect, useRef, useState } from 'react';
import { Save, ArrowLeft, File, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { KittyDialog } from './KittyDialog';
import { formatMemoTime, memoChanged, type Memo, type MemoState, type MemoSummary } from '../memos';
import { announceTrash, useTrashChange } from '../trash';

const newMemoId = () => crypto.randomUUID();
const readJson = async (response: Response) => {
  // A gateway can answer with an HTML error page; never show its parse error.
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  return data;
};
const putDraft = (payload: string, keepalive = false) =>
  fetch('/api/memo-draft', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive });

export function Notepad() {
  const [authenticated, setAuthenticated] = useState(false);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<'editor' | 'list'>('editor');
  const [memoId, setMemoId] = useState(newMemoId);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState<Memo | null>(null);
  const [memos, setMemos] = useState<MemoSummary[]>([]);
  // Changing this re-renders the status once the autosave request settles.
  const [autosave, setAutosave] = useState({ failed: false, at: 0 });
  const [restoredAt, setRestoredAt] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<MemoSummary | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void | Promise<void>) | null>(null);
  const draftPayload = JSON.stringify({ memoId, title, content });
  const latest = useRef({ payload: draftPayload, sent: draftPayload, enabled: false });
  latest.current.payload = draftPayload;
  latest.current.enabled = ready && authenticated;
  const dirty = memoChanged(title, content, saved);

  const openMemo = (memo: Memo | null, draft?: { memoId: string; title: string; content: string }) => {
    const next = { memoId: draft?.memoId ?? memo?.id ?? newMemoId(), title: draft?.title ?? memo?.title ?? '', content: draft?.content ?? memo?.content ?? '' };
    setMemoId(next.memoId); setTitle(next.title); setContent(next.content); setSaved(memo);
    latest.current.sent = JSON.stringify(next);
    setView('editor'); setError(''); setRestoredAt(0);
  };

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const data: MemoState = await readJson(await fetch('/api/memos', { signal: controller.signal, cache: 'no-store' }));
        setAuthenticated(data.authenticated); setMemos(data.memos);
        const draft = data.draft;
        if (draft) {
          // Resume the autosaved text on top of its confirmed version, if it was ever saved.
          const memo = data.memos.some(item => item.id === draft.memoId)
            ? await readJson(await fetch(`/api/memos/${encodeURIComponent(draft.memoId)}`, { signal: controller.signal, cache: 'no-store' })) as Memo
            : null;
          openMemo(memo, draft);
          if (memoChanged(draft.title, draft.content, memo)) setRestoredAt(draft.updatedAt);
        }
        setReady(true);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      }
    })();
    return () => controller.abort();
  }, []);

  // Autosave the draft shortly after typing stops, and flush it when the window or page closes.
  useEffect(() => {
    if (!ready || !authenticated || draftPayload === latest.current.sent) return;
    const timer = window.setTimeout(async () => {
      try {
        await readJson(await putDraft(draftPayload));
        latest.current.sent = draftPayload; setAutosave({ failed: false, at: Date.now() });
      } catch { setAutosave({ failed: true, at: Date.now() }); }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [draftPayload, ready, authenticated]);
  useEffect(() => {
    const flush = () => {
      const { payload, sent, enabled } = latest.current;
      if (enabled && payload !== sent) { latest.current.sent = payload; void putDraft(payload, true).catch(() => undefined); }
    };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, []);

  const save = async () => {
    if (!authenticated || busy) return false;
    if (!content.trim()) { setError('메모 내용을 입력해 주세요.'); return false; }
    setBusy(true); setError('');
    try {
      const data: MemoState & { memo: Memo } = await readJson(await fetch(`/api/memos/${encodeURIComponent(memoId)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, content }),
      }));
      setSaved(data.memo); setMemos(data.memos); setAutosave({ failed: false, at: Date.now() });
      latest.current.sent = JSON.stringify({ memoId, title, content }); setRestoredAt(0);
      return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  };

  // Leaving unsaved text asks first, since only one draft is kept per account.
  const guard = (action: () => void | Promise<void>) => { if (dirty && authenticated) setPendingAction(() => action); else void action(); };
  const startNew = () => guard(() => openMemo(null));
  const showList = async () => {
    setView('list'); setError('');
    if (!authenticated) return;
    try { const data: MemoState = await readJson(await fetch('/api/memos', { cache: 'no-store' })); setMemos(data.memos); }
    catch (e) { setError((e as Error).message); }
  };
  const pick = (item: MemoSummary) => {
    if (item.id === memoId) { setView('editor'); return; }
    guard(async () => {
      setBusy(true); setError('');
      try { openMemo(await readJson(await fetch(`/api/memos/${encodeURIComponent(item.id)}`, { cache: 'no-store' }))); }
      catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    });
  };
  // A memo restored from the trash reappears in the list.
  useTrashChange('memo', () => {
    if (authenticated) void fetch('/api/memos', { cache: 'no-store' }).then(readJson).then((data: MemoState) => setMemos(data.memos)).catch(() => undefined);
  });
  const remove = async () => {
    if (!deleting || busy) return;
    setBusy(true); setError('');
    try {
      const data: MemoState = await readJson(await fetch(`/api/memos/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' }));
      setMemos(data.memos);
      // The open memo is gone, so the editor starts a fresh one instead of re-saving it.
      if (deleting.id === memoId) { openMemo(null); setView('list'); }
      setDeleting(null); announceTrash('memo');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  // Untitled memos are named by their opening words; several can share the same minute.
  const memoLabel = (item: MemoSummary) => item.title || (item.preview.length > 24 ? `${item.preview.slice(0, 24)}…` : item.preview);
  const resolvePending = async (saveFirst: boolean) => {
    const action = pendingAction;
    if (!action || (saveFirst && !(await save()))) return;
    setPendingAction(null); await action();
  };

  const draftNote = autosave.failed ? '자동 저장 실패 · 연결을 확인해 주세요'
    : !authenticated ? '' : draftPayload === latest.current.sent ? '작성 중 내용 자동 저장됨' : '입력 중…';
  const statusText = !ready ? (error ? '' : '불러오는 중')
    : restoredAt && dirty ? `작성하던 내용 불러옴 (${formatMemoTime(restoredAt)})`
      : dirty ? ['저장 안 됨', draftNote].filter(Boolean).join(' · ')
        : saved ? `저장됨 ${formatMemoTime(saved.savedAt)}` : '';

  return (
    <div className="notepad h-full flex flex-col" onKeyDown={(event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (view === 'editor') void save(); }
    }}>
      {/* Menu Bar */}
      <div className="border-b border-gray-300 bg-gray-50 p-2 flex items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-2" aria-label={view === 'list' ? '작성 중인 메모로' : '저장된 메모 목록'}
          title={view === 'list' ? '작성 중인 메모로' : '저장된 메모 목록'} onClick={() => view === 'list' ? setView('editor') : void showList()} disabled={!ready}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className="gap-2" onClick={startNew} disabled={busy || !ready}>
          <File className="h-4 w-4" />
          New
        </Button>
        <Button variant="ghost" size="sm" className="gap-2" onClick={() => void save()} disabled={busy || !ready || !authenticated || view !== 'editor'}>
          <Save className="h-4 w-4" />
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {ready && !authenticated && <a className="notepad-signin" href="/signin-with-chatgpt?return_to=%2F" target="_top">로그인하면 메모가 저장됩니다</a>}
      </div>

      {error && <div role="alert" className="notepad-error">{error}</div>}
      {view === 'editor' ? (
        /* Text Editor */
        <div className="flex-1 p-4 flex flex-col gap-2 min-h-0">
          <input className="notepad-title" value={title} maxLength={100} onChange={(e) => { setTitle(e.target.value); setRestoredAt(0); }} aria-label="메모 제목"
            placeholder={saved && !saved.title ? formatMemoTime(saved.createdAt) : '제목 (비워 두면 저장 날짜·시간)'} />
          <Textarea
            value={content}
            onChange={(e) => { setContent(e.target.value); setRestoredAt(0); }}
            placeholder="Start typing..."
            aria-label="메모 내용"
            className="w-full flex-1 resize-none border-none focus-visible:ring-0 font-mono"
          />
        </div>
      ) : (
        <div className="notepad-list flex-1 min-h-0 overflow-auto p-4" aria-label="저장된 메모">
          {memos.length ? <ul>{memos.map(item => (
            <li key={item.id}>
              <button type="button" className="notepad-open" aria-current={item.id === memoId || undefined} disabled={busy} onClick={() => pick(item)}>
                <time dateTime={new Date(item.savedAt).toISOString()}>{formatMemoTime(item.savedAt)}</time>
                {item.title && <strong>{item.title}</strong>}
                <span>{item.preview}</span>
              </button>
              <button type="button" className="notepad-delete" aria-label={`${memoLabel(item)} 메모 삭제`} title="삭제" disabled={busy}
                onClick={() => { setError(''); setDeleting(item); }}>
                <Trash2 size={17} />
              </button>
            </li>
          ))}</ul> : <p className="notepad-empty">{authenticated ? '아직 저장한 메모가 없습니다. 메모를 쓰고 Save를 누르면 여기에 쌓입니다.' : '로그인하면 저장한 메모를 볼 수 있습니다.'}</p>}
        </div>
      )}

      {/* Status Bar */}
      <div className="border-t border-gray-300 bg-gray-50 px-4 py-1 flex items-center justify-between gap-3">
        <span className="text-gray-600">
          {view === 'editor' ? `Length: ${content.length} characters · Lines: ${content.split('\n').length}` : `저장된 메모 ${memos.length}개`}
        </span>
        <span className="text-gray-600" role="status">{view === 'editor' ? statusText : ''}</span>
      </div>

      {deleting && <KittyDialog title="휴지통으로 이동" busy={busy} onClose={() => setDeleting(null)}>
        <p className="kitty-question">‘{memoLabel(deleting)}’ 메모를 휴지통으로 옮길까요?<br />휴지통에서 복원할 수 있습니다.</p>
        {error && <p className="kitty-error" role="alert">{error}</p>}
        <footer className="kitty-dialog-actions">
          <button type="button" onClick={() => setDeleting(null)} disabled={busy}>취소</button>
          <button type="button" className="kitty-primary" onClick={() => void remove()} disabled={busy}>{busy ? '이동 중…' : '휴지통으로 이동'}</button>
        </footer>
      </KittyDialog>}

      {pendingAction && <KittyDialog title="저장 확인" busy={busy} onClose={() => setPendingAction(null)}>
        <p className="kitty-question">Save하지 않은 내용이 있습니다. 어떻게 할까요?</p>
        {error && <p className="kitty-error" role="alert">{error}</p>}
        <footer className="kitty-dialog-actions">
          <button type="button" onClick={() => setPendingAction(null)} disabled={busy}>취소</button>
          <button type="button" onClick={() => void resolvePending(false)} disabled={busy}>저장 안 함</button>
          <button type="button" className="kitty-primary" onClick={() => void resolvePending(true)} disabled={busy}>{busy ? '저장 중…' : '저장 후 이동'}</button>
        </footer>
      </KittyDialog>}
    </div>
  );
}

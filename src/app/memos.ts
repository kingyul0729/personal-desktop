export interface Memo { id: string; title: string; content: string; createdAt: number; savedAt: number; }
export interface MemoSummary { id: string; title: string; preview: string; createdAt: number; savedAt: number; }
export interface MemoDraft { memoId: string; title: string; content: string; updatedAt: number; }
export interface MemoState { authenticated: boolean; memos: MemoSummary[]; draft: MemoDraft | null; }

const pad = (value: number) => String(value).padStart(2, '0');
// Shown as 2026.10.02 22:41, also used as the title when none is entered.
export function formatMemoTime(time: number) {
  const date = new Date(time);
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function memoChanged(title: string, content: string, saved: Pick<Memo, 'title' | 'content'> | null) {
  return saved ? title.trim() !== saved.title || content !== saved.content : !!(title.trim() || content.trim());
}

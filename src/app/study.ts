export interface StudyFolder { id: string; name: string; count: number }
export interface StudySummary { id: string; folderId: string | null; title: string; preview: string; revision: number; updatedAt: number; trashedAt: number | null }
export interface StudyNote extends Omit<StudySummary, 'preview'> { content: string; createdAt: number }
export interface StudyState { authenticated: boolean; folders: StudyFolder[]; notes: StudySummary[]; counts: { total: number; trash: number; unfiled: number } }
export const emptyStudy: StudyState = { authenticated: false, folders: [], notes: [], counts: { total: 0, trash: 0, unfiled: 0 } };
// getRandomValues also works in local previews and browsers without randomUUID.
export const newStudyId = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
export const studyDate = (time: number) => new Date(time).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
export const studyChanged = (draft: StudyNote | null, saved: StudyNote | null) => !!draft && (draft.title !== (saved?.title ?? '') || draft.content !== (saved?.content ?? '') || draft.folderId !== (saved?.folderId ?? null));
export async function studyRequest<T>(path = '', options: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api/study${path}`, { cache: 'no-store', ...options }); }
  catch (error) { if ((error as Error).name === 'AbortError') throw error; throw new Error('서버에 연결하지 못했습니다. 작성 내용은 유지됩니다. 다시 시도해 주세요.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || '자료를 불러오지 못했습니다. 다시 시도해 주세요.');
  return data;
}
export const studyWrite = <T,>(path: string, method: string, body?: unknown) => studyRequest<T>(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

// Notes never execute HTML or load arbitrary local/API URLs from imported Markdown.
export function studyUrl(url: string, key: string) {
  if (key === 'src') return /^https:\/\//i.test(url) || /^\/api\/study\/assets\/[A-Za-z0-9-]{8,64}$/.test(url) ? url : '';
  return /^(https?:\/\/|mailto:|#)/i.test(url) ? url : '';
}

// 직원 자료 API(/api/staff/*) — 예전 재고관리 앱 DB를 읽고 쓴다.
export class StaffApiError extends Error { unavailable = false; }

async function parse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new StaffApiError(data?.error || '직원 자료를 불러오지 못했어요.'); e.unavailable = !!data?.unavailable; throw e; }
  return data;
}
export const staffGet = async (path: string, params: Record<string, string | number> = {}) => {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  return parse(await fetch(`/api/staff${path}${q ? `?${q}` : ''}`, { cache: 'no-store' }));
};
export const staffPost = async (path: string, body: unknown) =>
  parse(await fetch(`/api/staff${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

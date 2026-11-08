// 직원 자료 API(/api/staff/*) — 예전 재고관리 앱 DB를 읽고 쓴다.
export class StaffApiError extends Error { unavailable = false; detail = ''; }

async function parse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new StaffApiError(data?.error || '직원 자료를 불러오지 못했어요.'); e.unavailable = !!data?.unavailable;
    e.detail = [data?.detail, Array.isArray(data?.tables) ? `예전 DB 표: ${data.tables.join(', ') || '(없음)'}` : ''].filter(Boolean).join('\n');
    if (!data?.error) e.detail = `HTTP ${res.status}`;
    throw e; }
  return data;
}
export const staffGet = async (path: string, params: Record<string, string | number> = {}) => {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  return parse(await fetch(`/api/staff${path}${q ? `?${q}` : ''}`, { cache: 'no-store' }));
};
// 직원 자료를 바꾸면(근태·연차·연차 수정 등) 'staff-data-changed'를 알려 직원스케줄·직원연차·성과표가 함께 다시 불러온다.
// 여러 칸을 한꺼번에 저장할 때는 마지막 저장 뒤 한 번만 알린다.
let changedTimer: ReturnType<typeof setTimeout> | undefined;
export const announceStaffChange = () => {
  if (typeof window === 'undefined') return;
  clearTimeout(changedTimer);
  changedTimer = setTimeout(() => window.dispatchEvent(new Event('staff-data-changed')), 250);
};
export const staffPost = async (path: string, body: unknown) => {
  const data = await parse(await fetch(`/api/staff${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  announceStaffChange();
  return data;
};

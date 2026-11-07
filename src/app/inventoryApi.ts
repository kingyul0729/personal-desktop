// 재고 API(/api/inventory/*)와 화면 공용 상태
import { useCallback, useEffect, useState } from 'react';

export type InvOption = { id: number; item_id: number; label: string | null; qty: number; bonus_qty: number; amount: number | null; prepaid: number; unit_label?: string | null };
export type InvItem = {
  id: number; name: string; vendor_id: number | null; vendor_name?: string | null; category: string | null; stock_unit: string; order_unit: string | null; pack_qty: number | null;
  price: number | null; min_stock: number; hospital_stock: number; vendor_stock: number; daily_mode: 'usage' | 'count' | null; prepaid: number; is_pack: number; memo: string | null; options: InvOption[]; unit_cost?: number | null;
};
export type InvVendor = { id: number; name: string; company: string | null; category: string | null; manager: string | null; payment_method: string | null; contact: string | null; bank: string | null; account: string | null; holder: string | null; memo: string | null };
export type InvOrder = { id: number; item_id: number; item_name: string; stock_unit: string; option_label: string | null; ordered_at: string; qty: number; bonus_qty: number; amount: number | null; prepaid: number; status: string; memo: string | null };
export type InvTx = { id: number; date: string; kind: 'in' | 'out' | 'prepaid_buy' | 'prepaid_in' | 'adjust'; item_id: number; item_name: string; stock_unit: string; vendor_name: string | null; qty: number; bonus_qty: number; amount: number | null; hospital_delta: number; vendor_delta: number; hospital_after: number | null; vendor_after: number | null; invoice: number; memo: string | null; daily_date: string | null; source?: string | null };
export type InvState = { today: string; imported: string | null; vendors: InvVendor[]; items: InvItem[]; orders: InvOrder[] };

export class InvError extends Error { detail = ''; unavailable = false; }
async function parse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new InvError(data?.error || '재고 자료를 불러오지 못했어요.'); e.detail = data?.detail || ''; e.unavailable = !!data?.unavailable; throw e; }
  return data;
}
export const invGet = async (path: string, params: Record<string, string | number | undefined> = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString();
  return parse(await fetch(`/api/inventory${path}${q ? `?${q}` : ''}`, { cache: 'no-store' }));
};
export const invSend = async (method: 'POST' | 'DELETE' | 'PATCH', path: string, body?: unknown) =>
  parse(await fetch(`/api/inventory${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));

// 여러 화면이 같은 재고 상태를 보도록 저장 후 알림
const listeners = new Set<() => void>();
export const announceInventory = () => listeners.forEach(fn => fn());
export function useInventory() {
  const [state, setState] = useState<InvState | null>(null);
  const [error, setError] = useState<InvError | null>(null);
  const load = useCallback(async () => {
    try { setState(await invGet('/state')); setError(null); }
    catch (e) { setError(e instanceof InvError ? e : new InvError('재고 자료를 불러오지 못했어요.')); }
  }, []);
  useEffect(() => { void load(); listeners.add(load); return () => { listeners.delete(load); }; }, [load]);
  return { state, error, reload: load };
}

export const fmtQty = (v: number | null | undefined) => (v == null ? '—' : Number.isInteger(v) ? v.toLocaleString('ko-KR') : (Math.round(v * 100) / 100).toLocaleString('ko-KR'));
export const fmtWon = (v: number | null | undefined) => (v == null ? '단가 미확인' : `${Math.round(v).toLocaleString('ko-KR')}원`);
export const KIND_LABEL: Record<string, string> = { in: '입고', out: '출고', prepaid_buy: '선결제 구매', prepaid_in: '선결제 반입', adjust: '재고 맞추기' };
export const todayLocal = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
export const shiftMonth = (month: string, by: number) => { const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
export const unitHint = (it: InvItem) => (it.order_unit && it.pack_qty && it.order_unit !== it.stock_unit ? `1 ${it.order_unit} = ${fmtQty(it.pack_qty)} ${it.stock_unit}` : '');

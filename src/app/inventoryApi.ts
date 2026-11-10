// 재고 API(/api/inventory/*)와 화면 공용 상태
import { useCallback, useEffect, useState } from 'react';

export type InvOption = { id: number; item_id: number; label: string | null; qty: number; bonus_qty: number; amount: number | null; prepaid: number; unit_label?: string | null };
export type InvItem = {
  id: number; name: string; vendor_id: number | null; vendor_name?: string | null; category: string | null; stock_unit: string; order_unit: string | null; pack_qty: number | null;
  price: number | null; min_stock: number; hospital_stock: number; vendor_stock: number; daily_mode: 'usage' | 'count' | null; prepaid: number; is_pack: number; memo: string | null; options: InvOption[]; unit_cost?: number | null; paid_unit_cost?: number | null;
};
export type InvVendor = { id: number; name: string; company: string | null; category: string | null; manager: string | null; payment_method: string | null; contact: string | null; bank: string | null; account: string | null; holder: string | null; memo: string | null };
export type InvOrder = { id: number; item_id: number; item_name: string; stock_unit: string; option_label: string | null; ordered_at: string; qty: number; bonus_qty: number; amount: number | null; prepaid: number; status: string; memo: string | null; received_qty?: number; contract_qty?: number | null; contract_amount?: number | null };
export type InvTx = { id: number; date: string; kind: 'in' | 'out' | 'prepaid_buy' | 'prepaid_in' | 'adjust'; item_id: number; item_name: string; stock_unit: string; vendor_name: string | null; qty: number; bonus_qty: number; amount: number | null; hospital_delta: number; vendor_delta: number; hospital_after: number | null; vendor_after: number | null; invoice: number; memo: string | null; daily_date: string | null; source?: string | null; invoice_ids?: string | null };
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
// 저장 한 번 = 고유 번호 하나(x-req-id). 같은 저장이 겹치면 하나만 보내고, 응답을 못 받으면 같은 번호로 한 번 더 물어 두 번 반영되지 않게 한다.
const inflight = new Map<string, Promise<any>>();
const newReqId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
export const invSend = (method: 'POST' | 'DELETE' | 'PATCH', path: string, body?: unknown) => {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const key = `${method} ${path} ${payload || ''}`;
  const busy = inflight.get(key);
  if (busy) return busy;
  const id = newReqId();
  const send = () => fetch(`/api/inventory${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-req-id': id }, body: payload });
  const p = (async () => { let res: Response; try { res = await send(); } catch { res = await send(); } return parse(res); })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
};

// 거래명세서 사진 올리기(여러 기록에 한 장)
export const invUploadInvoice = async (file: File, txIds: number[]) => {
  const fd = new FormData(); fd.append('file', file); fd.append('tx_ids', txIds.join(','));
  return parse(await fetch('/api/inventory/invoices', { method: 'POST', body: fd }));
};
export const invoiceSrc = (id: number | string) => `/api/inventory/invoices/${id}/file`;

// 여러 화면이 같은 재고 상태를 보도록 저장 후 알림
const listeners = new Set<() => void>();
export const announceInventory = () => listeners.forEach(fn => fn());
export const subscribeInventory = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
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
export const KIND_LABEL: Record<string, string> = { in: '입고', out: '출고', prepaid_buy: '선결제 구매', prepaid_in: '선결제 입고', adjust: '재고 맞추기' };
export const todayLocal = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
export const shiftMonth = (month: string, by: number) => { const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
export const unitHint = (it: InvItem) => (it.order_unit && it.pack_qty && it.order_unit !== it.stock_unit ? `1 ${it.order_unit} = ${fmtQty(it.pack_qty)} ${it.stock_unit}` : '');

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { type InvItem, type InvOrder, InvError, fmtQty, invoiceSrc } from '../../inventoryApi';


export function useToast() {
  const [toast, setToast] = useState('');
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2400); return () => clearTimeout(t); }, [toast]);
  return [toast, setToast] as const;
}
export const errText = (e: unknown) => (e instanceof Error ? e.message : '처리하지 못했어요.');
export function Problem({ error }: { error: InvError }) {
  return <div className="pending-screen"><strong>불러오지 못했어요</strong><p>{error.message}</p>{error.detail && <pre className="sf-detail">{error.detail}</pre>}</div>;
}
export function Shell({ children, toast }: { children: React.ReactNode; toast: string }) {
  return <div className="sf-wrap iv-wrap">{children}{toast && <div className="sf-toast" role="status">{toast}</div>}</div>;
}
export function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, React.ReactNode][]; label: string }) {
  return <div className="sf-seg" role="tablist" aria-label={label}>{options.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}>{l}</button>)}</div>;
}
export const lowOf = (it: InvItem) => it.min_stock > 0 && it.hospital_stock <= it.min_stock;
// 재고 표시(2026-11-09 사용자 지정, 겹치지 않게 하나만): 받기 전 반입 예정 → '입고 대기', 받기 전 주문 → '주문 중',
// 병원재고가 기준 이하인데 업체 보관 잔량을 합치면 넘음 → '입고 필요', 합쳐도 기준 이하 → '부족'(새로 구매).
export type Flag = 'bringing' | 'wait' | 'bring' | 'low';
export const FLAG_LABEL: Record<Flag, string> = { bringing: '입고 대기', wait: '주문 중', bring: '입고 필요', low: '부족' };
export const flagOf = (it: InvItem, orders: InvOrder[]): Flag | null => {
  const pend = orders.filter(o => o.item_id === it.id);
  if (pend.some(o => o.prepaid)) return 'bringing';
  if (pend.length) return 'wait';
  if (!lowOf(it)) return null;
  return it.prepaid && it.hospital_stock + (it.vendor_stock || 0) > it.min_stock ? 'bring' : 'low';
};
export const FlagTag = ({ flag }: { flag: Flag | null }) => (flag ? <span className={`iv-tag is-${flag}`}>{FLAG_LABEL[flag]}</span> : null);
export const withUnit = (v: number | null | undefined, unit: string) => (v == null ? '—' : `${fmtQty(v)} ${unit}`);

/* ───────────── 재고체크 ───────────── */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="sf-modal" role="dialog" aria-modal="true" aria-label={title}>
    <div className="sf-modal-back" onClick={onClose} />
    <div className="sf-modal-panel"><div className="sf-modal-head"><strong>{title}</strong><button type="button" className="iv-icon-btn" aria-label="닫기" onClick={onClose}><X size={18} strokeWidth={1.8} /></button></div>{children}</div>
  </div>;
}

export function ItemSelect({ items, value, onChange }: { items: InvItem[]; value: string; onChange: (v: string) => void }) {
  return <select value={value} onChange={e => onChange(e.target.value)}><option value="">품목 선택</option>{items.map(it => <option key={it.id} value={it.id}>{it.name} ({fmtQty(it.hospital_stock)} {it.stock_unit})</option>)}</select>;
}
export function QtyInput({ item, value, onChange, label }: { item: InvItem | undefined; value: string; onChange: (v: string) => void; label: string }) {
  const [unit, setUnit] = useState<'stock' | 'order'>('stock');
  const factor = unit === 'order' && item?.pack_qty ? item.pack_qty : 1;
  const [raw, setRaw] = useState('');
  useEffect(() => { if (value === '') setRaw(''); }, [value]);
  return <label className="sf-input"><span>{label}</span><span className="iv-pair">
    <input type="number" min={0} inputMode="decimal" value={raw} onChange={e => { setRaw(e.target.value); onChange(e.target.value === '' ? '' : String(Number(e.target.value) * factor)); }} />
    <select value={unit} onChange={e => { const u = e.target.value as 'stock' | 'order'; setUnit(u); const f = u === 'order' && item?.pack_qty ? item.pack_qty : 1; onChange(raw === '' ? '' : String(Number(raw) * f)); }}>
      <option value="stock">{item?.stock_unit || '개'}</option>{item?.order_unit && item.pack_qty && item.order_unit !== item.stock_unit && <option value="order">{item.order_unit}({fmtQty(item.pack_qty)}{item.stock_unit})</option>}</select></span>
    {unit === 'order' && value !== '' && <small>= {fmtQty(Number(value))} {item?.stock_unit}</small>}</label>;
}

// 명세서 사진 고르기(카메라·앨범·파일). 고른 사진은 입고확정 때 그 기록에 올라가고, 그래야 '명세서 받음'이 된다.
export function PhotoPick({ file, onPick }: { file?: File; onPick: (f?: File) => void }) {
  return <label className={`iv-photo-pick${file ? ' is-on' : ''}`}>
    {file ? `명세서 사진 ✓` : '명세서 사진'}
    <input type="file" accept="image/*,application/pdf" onChange={e => { onPick(e.target.files?.[0]); e.currentTarget.value = ''; }} />
  </label>;
}

export function InvThumb({ id }: { id: string }) {
  const [pdf, setPdf] = useState(false); // 사진이 아니면(PDF) 글자로
  return pdf ? <span className="iv-inv-pdf">PDF</span> : <img src={invoiceSrc(id)} alt="거래명세서" onError={() => setPdf(true)} />;
}

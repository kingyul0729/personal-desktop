import { useId } from 'react';
import { X } from 'lucide-react';

// The glossy heart from the supplied notice artwork, drawn as SVG so the text next to it can be Korean.
export function HeartIcon({ className = '' }: { className?: string }) {
  const gradient = useId();
  return <svg className={className} viewBox="0 0 40 36" aria-hidden="true">
    <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffc4cf" /><stop offset="1" stopColor="#f27b92" /></linearGradient></defs>
    <path d="M20 34 C6 24 1 17 1 10.5 C1 5 5.5 1 10.5 1 C14.5 1 18 3.4 20 7 C22 3.4 25.5 1 29.5 1 C34.5 1 39 5 39 10.5 C39 17 34 24 20 34Z" fill={`url(#${gradient})`} stroke="#e06a80" strokeWidth="2" />
    <ellipse cx="11" cy="9" rx="4" ry="2.6" fill="#fff" opacity=".7" />
  </svg>;
}

// Short message after something finished; it still disappears on its own, the X just closes it sooner.
export function DesktopNotice({ message, onClose }: { message: string; onClose: () => void }) {
  return <div className="desktop-notice" role="status">
    <HeartIcon className="desktop-notice-heart" />
    <span>{message}</span>
    <button type="button" aria-label="알림 닫기" onClick={onClose}><X size={15} strokeWidth={2.6} /></button>
  </div>;
}

// Shown while something is being fetched. The bar only shows activity; the server reports no percentage.
export function LoadingBox({ label = '불러오는 중…' }: { label?: string }) {
  return <div className="loading-box" role="status">
    <HeartIcon className="loading-box-heart" />
    <span>{label}</span>
    <div className="loading-box-track" aria-hidden="true"><div /></div>
  </div>;
}

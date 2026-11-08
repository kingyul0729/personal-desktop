import { useId } from 'react';
import { X } from 'lucide-react';

// (예전 하트 그림. 화면에는 더 쓰지 않는다.)
export function HeartIcon({ className = '' }: { className?: string }) {
  const gradient = useId();
  return <svg className={className} viewBox="0 0 40 36" aria-hidden="true">
    <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d5dee8" /><stop offset="1" stopColor="#8fa6bf" /></linearGradient></defs>
    <path d="M20 34 C6 24 1 17 1 10.5 C1 5 5.5 1 10.5 1 C14.5 1 18 3.4 20 7 C22 3.4 25.5 1 29.5 1 C34.5 1 39 5 39 10.5 C39 17 34 24 20 34Z" fill={`url(#${gradient})`} stroke="#6f8aa7" strokeWidth="2" />
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

// 불러오는 중: 연한 바탕 고리 위로 진한 호가 도는 스피너(2026-11-09 Fluent 2 UI 키트 기준, 예전 막대 12개 대체).
export function Spinner({ size = 28 }: { size?: number }) {
  return <svg className="spinner" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="13" className="spinner-track" />
    <path d="M16 3 A13 13 0 0 1 29 16" className="spinner-arc" />
  </svg>;
}
export function LoadingBox({ label = '불러오는 중…' }: { label?: string }) {
  return <div className="loading-box" role="status">
    <Spinner />
    <span>{label}</span>
  </div>;
}

// 저장·이동 중: 버튼 글자 앞의 작은 고리 스피너(같은 Fluent 2 모양).
export function SavingMark() {
  return <svg className="saving-mark" width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="10" cy="10" r="7.5" className="saving-track" />
    <path d="M10 2.5 A7.5 7.5 0 0 1 17.5 10" className="saving-arc" />
  </svg>;
}

// 다운로드: 꽉 찬 아래 화살표 + 받침. 누르거나 가리키면 화살표가 한 번 내려온다.
export function DownloadMark({ size = 18 }: { size?: number }) {
  return <svg className="download-mark" width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
    <path className="download-arrow" d="M8 2h4v6h3.5L10 13.5 4.5 8H8Z" />
    <rect x="4" y="15.5" width="12" height="2" rx="0.6" />
  </svg>;
}

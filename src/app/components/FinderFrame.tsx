import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Finder 모양의 오른쪽 영역: 위 도구 막대(‹ › 제목 도구) / 내용 / 경로 막대 / 상태 막대(항목 수·크기 조절).
export function FinderMain({ title, onBack, onForward, tools, path, status, scale, onScale, children, bodyClassName = '' }: {
  title: ReactNode;
  onBack?: () => void;
  onForward?: () => void;
  tools?: ReactNode;
  path: ReactNode;
  status?: ReactNode;
  scale?: number;
  onScale?: (value: number) => void;
  children: ReactNode;
  bodyClassName?: string;
}) {
  return <div className="finder-main">
    <header className="finder-toolbar">
      <div className="finder-history">
        <button type="button" aria-label="뒤로" disabled={!onBack} onClick={onBack}><ChevronLeft size={22} strokeWidth={1.6} /></button>
        <button type="button" aria-label="앞으로" disabled={!onForward} onClick={onForward}><ChevronRight size={22} strokeWidth={1.6} /></button>
      </div>
      <h1>{title}</h1>
      {tools && <div className="finder-tools">{tools}</div>}
    </header>
    <div className={`finder-body ${bodyClassName}`}>{children}</div>
    <footer className="finder-path">{path}</footer>
    {status !== undefined && <footer className="finder-status">
      <span>{status}</span>
      {onScale && scale !== undefined && <input type="range" min={80} max={130} step={5} value={scale} aria-label="크기" onChange={event => onScale(Number(event.target.value))} />}
    </footer>}
  </div>;
}

// 경로 막대의 한 칸: 작은 아이콘 + 이름, 칸 사이에 › 를 넣는다.
export function FinderPath({ parts }: { parts: { icon: ReactNode; label: string; onClick?: () => void }[] }) {
  return <>{parts.map((part, index) => <span key={index} className="finder-path-part">
    {index > 0 && <ChevronRight size={12} />}
    {part.onClick ? <button type="button" onClick={part.onClick}>{part.icon}<span>{part.label}</span></button> : <>{part.icon}<span>{part.label}</span></>}
  </span>)}</>;
}

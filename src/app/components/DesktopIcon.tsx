import { useRef, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { PinkFolderIcon, type PinkFolderVariant } from './PinkFolderIcon';
import { InlineRename } from './InlineRename';
import { createLongPress } from '../desktopModel';

interface DesktopIconProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  variant?: PinkFolderVariant;
  image?: string;
  locked?: boolean;
  dimmed?: boolean;
  renaming?: boolean;
  onRename?: (name: string) => void;
  onCancelRename?: () => void;
  onMenu?: (point: { x: number; y: number }) => void;
}

export function DesktopIconArt({ icon, variant = 'heart', image, locked }: { icon: ReactNode; variant?: PinkFolderVariant; image?: string; locked?: boolean }) {
  return <div className="desktop-folder-art">
    {image ? <img className="desktop-custom-icon" src={image} alt="" draggable={false} /> : <PinkFolderIcon variant={variant} />}
    <i className="desktop-app-badge" aria-hidden="true">{locked ? <Lock /> : icon}</i>
  </div>;
}

export function DesktopIcon({ icon, label, onClick, variant = 'heart', image, locked, dimmed, renaming, onRename, onCancelRename, onMenu }: DesktopIconProps) {
  const press = useRef(createLongPress(point => onMenuRef.current?.(point)));
  const onMenuRef = useRef(onMenu); onMenuRef.current = onMenu;
  const art = <DesktopIconArt icon={icon} variant={variant} image={image} locked={locked} />;
  if (renaming && onRename && onCancelRename) {
    return <div className="desktop-icon is-renaming flex flex-col items-center gap-1 p-2 rounded w-20">
      {art}<InlineRename value={label} label={`${label} 이름`} onSave={onRename} onCancel={onCancelRename} />
    </div>;
  }
  return (
    <button
      type="button"
      className={`desktop-icon flex flex-col items-center gap-1 p-2 rounded cursor-pointer hover:bg-white/20 transition-colors w-20${dimmed ? ' is-dimmed' : ''}`}
      onClick={() => { if (!press.current.consumeClick()) onClick(); }}
      onContextMenu={onMenu ? (event) => { event.preventDefault(); press.current.cancel(); onMenu({ x: event.clientX, y: event.clientY }); } : undefined}
      onPointerDown={onMenu ? (event) => { if (event.pointerType !== 'mouse') press.current.down(event); } : undefined}
      onPointerMove={onMenu ? (event) => press.current.move(event) : undefined}
      onPointerUp={onMenu ? () => press.current.up() : undefined}
      onPointerCancel={onMenu ? () => press.current.cancel() : undefined}
    >
      {art}
      <span className="text-white text-center drop-shadow-lg break-words">
        {label}
      </span>
    </button>
  );
}

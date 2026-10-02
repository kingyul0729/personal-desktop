import { PinkFolderIcon, type PinkFolderVariant } from './PinkFolderIcon';

interface DesktopIconProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: PinkFolderVariant;
}

export function DesktopIcon({ icon, label, onClick, variant = 'heart' }: DesktopIconProps) {
  return (
    <button
      type="button"
      className="desktop-icon flex flex-col items-center gap-1 p-2 rounded cursor-pointer hover:bg-white/20 transition-colors w-20"
      onClick={onClick}
    >
      <div className="desktop-folder-art">
        <PinkFolderIcon variant={variant} />
        <i className="desktop-app-badge" aria-hidden="true">{icon}</i>
      </div>
      <span className="text-white text-center drop-shadow-lg break-words">
        {label}
      </span>
    </button>
  );
}

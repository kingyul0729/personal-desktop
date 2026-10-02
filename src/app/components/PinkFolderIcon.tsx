export type PinkFolderVariant = 'heart' | 'kitty' | 'flower' | 'cherry';

/** Decorative artwork only; the enclosing control keeps its original label and action. */
export function PinkFolderIcon({ variant = 'heart', className = '' }: { variant?: PinkFolderVariant; className?: string }) {
  return <span aria-hidden="true" className={`pink-folder-icon pink-folder-${variant} ${className}`} />;
}

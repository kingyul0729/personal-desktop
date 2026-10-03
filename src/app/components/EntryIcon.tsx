import { FileText, Folder } from 'lucide-react';
import { programs } from '../programs';

// The small badge on a desktop icon says what the item opens; a custom icon never replaces it.
export function EntryBadge({ target, fileKind }: { target: string; fileKind?: 'file' | 'folder' }) {
  const program = programs.find(item => target === `program:${item.id}`);
  if (program) return <program.icon size={18} />;
  return fileKind === 'folder' ? <Folder size={18} /> : <FileText size={18} />;
}

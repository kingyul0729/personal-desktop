import { Calculator, FileText, FolderOpen, Layers, Settings, Terminal, Trash2 } from 'lucide-react';
import type { WindowId } from './desktopState';
import type { PinkFolderVariant } from './components/PinkFolderIcon';

export const programs: { id: WindowId; label: string; icon: typeof Calculator; variant: PinkFolderVariant }[] = [
  { id: 'terminal', label: 'Terminal', icon: Terminal, variant: 'heart' },
  { id: 'fileExplorer', label: '가격표 보관함', icon: FolderOpen, variant: 'kitty' },
  { id: 'controlPanel', label: '환경설정', icon: Settings, variant: 'flower' },
  { id: 'programManager', label: '작업 캡슐', icon: Layers, variant: 'cherry' },
  { id: 'notepad', label: '메모장', icon: FileText, variant: 'heart' },
  { id: 'priceCalculator', label: '금액 계산', icon: Calculator, variant: 'kitty' },
  { id: 'trash', label: '휴지통', icon: Trash2, variant: 'flower' },
];

// Windows that are not desktop programs still need a taskbar label.
export const windowLabel = (id: WindowId) => programs.find(program => program.id === id)?.label ?? (id === 'files' ? '파일' : id);

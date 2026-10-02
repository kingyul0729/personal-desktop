import { Calculator, FileText, FolderOpen, Monitor, Settings, Terminal } from 'lucide-react';
import type { WindowId } from './desktopState';

export const programs: { id: WindowId; label: string; icon: typeof Calculator }[] = [
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'fileExplorer', label: '가격표 보관함', icon: FolderOpen },
  { id: 'controlPanel', label: 'Control Panel', icon: Settings },
  { id: 'programManager', label: 'Programs', icon: Monitor },
  { id: 'notepad', label: 'Notepad', icon: FileText },
  { id: 'priceCalculator', label: '금액 계산', icon: Calculator },
];

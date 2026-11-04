import { BookOpen, Calculator, FileText, FolderOpen, Layers, Presentation, Settings, Trash2 } from 'lucide-react';
import type { WindowId } from './desktopState';
import type { PinkFolderVariant } from './components/PinkFolderIcon';

// A: 개인 공간, B: 다채움피부과 업무 공간, common: 두 공간이 함께 쓰는 도구.
// Each program belongs to exactly one group, so the Start menu never lists it twice.
export type Space = 'A' | 'B' | 'common';
export const spaces: { id: Space; label: string }[] = [
  { id: 'A', label: '개인 공간' }, { id: 'B', label: '다채움피부과 업무 공간' }, { id: 'common', label: '공통 도구' },
];
export const programs: { id: WindowId; label: string; icon: typeof Calculator; variant: PinkFolderVariant; space: Space }[] = [
  { id: 'terminal', label: '공부 보관함', icon: BookOpen, variant: 'heart', space: 'A' },
  { id: 'fileExplorer', label: '가격표 보관함', icon: FolderOpen, variant: 'kitty', space: 'B' },
  { id: 'controlPanel', label: '환경설정', icon: Settings, variant: 'flower', space: 'common' },
  { id: 'programManager', label: '작업 캡슐', icon: Layers, variant: 'cherry', space: 'common' },
  { id: 'notepad', label: '메모장', icon: FileText, variant: 'heart', space: 'A' },
  { id: 'priceCalculator', label: '금액 계산', icon: Calculator, variant: 'kitty', space: 'common' },
  { id: 'trash', label: '휴지통', icon: Trash2, variant: 'flower', space: 'common' },
  { id: 'workLibrary', label: '업무 자료실', icon: Presentation, variant: 'cherry', space: 'B' },
];

// Windows that are not desktop programs still need a taskbar label.
export const windowLabel = (id: WindowId) => programs.find(program => program.id === id)?.label ?? (id === 'files' ? '파일' : id);

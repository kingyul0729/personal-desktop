// Built-in icons cut from the two supplied icon sheets (public/icons). They stay available in the
// picker even when not in use; uploaded icons are added beside them, never replacing them.
export interface LibraryIcon { id: string; label: string; group: '프로그램' | '폴더' | '파일' | '캐릭터' }
const icon = (id: string, label: string, group: LibraryIcon['group']): LibraryIcon => ({ id, label, group });

export const ICON_LIBRARY: LibraryIcon[] = [
  icon('pink-monitor-kitty', '모니터 키티', '프로그램'), icon('pink-monitor-heart', '모니터 하트', '프로그램'), icon('coral-monitor', '모니터 코랄', '프로그램'),
  icon('pink-settings', '설정 리본', '프로그램'), icon('coral-settings', '설정 하트', '프로그램'),
  icon('pink-notepad', '메모장 리본', '프로그램'), icon('coral-notepad', '메모장 코랄', '프로그램'),
  icon('pink-calculator', '계산기 핑크', '프로그램'), icon('coral-calculator', '계산기 코랄', '프로그램'),
  icon('pink-trash-kitty', '휴지통 키티', '프로그램'), icon('pink-trash-kitty-2', '휴지통 키티 2', '프로그램'), icon('pink-trash-open', '휴지통 열림', '프로그램'),
  icon('pink-trash-full', '휴지통 가득', '프로그램'), icon('coral-trash', '휴지통 코랄', '프로그램'), icon('coral-trash-full', '휴지통 코랄 가득', '프로그램'),
  icon('pink-folder-heart', '하트', '폴더'), icon('pink-folder-kitty', '키티', '폴더'), icon('pink-folder-kitty-2', '키티 2', '폴더'),
  icon('pink-folder-flower', '꽃', '폴더'), icon('pink-folder-flowers', '꽃다발', '폴더'), icon('pink-folder-cherry', '체리', '폴더'),
  icon('pink-folder-ribbon', '리본', '폴더'), icon('pink-folder-ribbon-band', '리본 띠', '폴더'), icon('pink-folder-hearts', '하트 둘', '폴더'),
  icon('pink-folder-sparkle', '반짝', '폴더'), icon('pink-folder-paw', '발바닥', '폴더'), icon('pink-folder-tab-heart', '하트 탭', '폴더'),
  icon('pink-folder-gingham', '체크', '폴더'), icon('pink-folder-stripe', '줄무늬', '폴더'), icon('pink-folder-glass-heart', '유리 하트', '폴더'),
  icon('pink-folder-glass-kitty', '유리 키티', '폴더'),
  icon('coral-folder', '코랄', '폴더'), icon('coral-folder-heart', '코랄 하트', '폴더'), icon('coral-folder-redheart', '코랄 빨간 하트', '폴더'),
  icon('coral-folder-kitty', '코랄 키티', '폴더'), icon('coral-folder-flower', '코랄 꽃', '폴더'), icon('coral-folder-cherry', '코랄 체리', '폴더'),
  icon('coral-folder-ribbon', '코랄 리본', '폴더'), icon('coral-folder-star', '코랄 별', '폴더'), icon('coral-folder-moon', '코랄 달', '폴더'),
  icon('coral-folder-cloud', '코랄 구름', '폴더'), icon('coral-folder-paw', '코랄 발바닥', '폴더'), icon('coral-folder-bunny', '코랄 토끼', '폴더'),
  icon('pink-document-kitty', '문서 키티', '파일'), icon('coral-document', '문서 코랄', '파일'), icon('pink-image-file', '사진 파일', '파일'),
  icon('coral-image', '사진 액자', '파일'), icon('pink-music-file', '음악 파일', '파일'), icon('pink-zip-file', '압축 파일', '파일'),
  icon('pink-sheet', '표 파일', '파일'), icon('pink-slides', '발표 파일', '파일'),
  icon('pink-kitty-heart', '하트 키티', '캐릭터'), icon('pink-kitty-wink', '윙크 키티', '캐릭터'), icon('pink-kitty-sleep', '잠자는 키티', '캐릭터'),
  icon('coral-kitty-heart', '하트 키티 코랄', '캐릭터'), icon('coral-kitty-wink', '윙크 키티 코랄', '캐릭터'), icon('coral-kitty-bear', '곰돌이 키티', '캐릭터'),
];
export const ICON_GROUPS: LibraryIcon['group'][] = ['프로그램', '폴더', '파일', '캐릭터'];
export const libraryIconSrc = (id: string) => `/icons/${id}.png`;
export const isLibraryIcon = (id: string) => ICON_LIBRARY.some(item => item.id === id);

// What each desktop item shows until the person picks something else.
export const DEFAULT_ICONS: Record<string, string> = {
  'program:terminal': 'pink-monitor-kitty',
  'program:fileExplorer': 'pink-folder-kitty',
  'program:controlPanel': 'pink-settings',
  'program:programManager': 'pink-monitor-heart',
  'program:notepad': 'pink-notepad',
  'program:priceCalculator': 'pink-calculator',
  'program:trash': 'pink-trash-kitty',
  folder: 'pink-folder-heart',
  file: 'pink-document-kitty',
};
export const TRASH_FULL_ICON = 'pink-trash-full';

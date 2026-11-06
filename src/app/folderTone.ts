// 폴더 이름 앞 색 점의 색: 사용자가 고른 muted 팔레트에서 뽑은 차분한 색 5가지(가격표·공부 보관함 공통).
// 목적이 비슷한 폴더는 같은 색 — 이름에 든 낱말로 정한다(새 폴더도 이름만으로 맞는 색이 된다).
export type FolderTone = 'pigment' | 'acne' | 'lifting' | 'etc' | 'plain';
export const folderTones: Record<FolderTone, { label: string; front: string; back: string }> = {
  pigment: { label: '색소·홍조', front: '#a9b6c8', back: '#8798b0' },   // PMS 644·645 (더스티 블루)
  acne: { label: '여드름·흉터·모공', front: '#b3c2b0', back: '#93a690' }, // PMS 623·624 (세이지)
  lifting: { label: '리프팅·탄력·부스터', front: '#e1b6b5', back: '#c99596' }, // PMS 700·701 (더스티 로즈)
  etc: { label: '기타·관리', front: '#ecd3b6', back: '#d8b48d' },        // PMS 712·714 (샌드)
  plain: { label: '그 밖', front: '#c4bac8', back: '#a597ab' },          // PMS 665·666 (모브 그레이)
};
const rules: [FolderTone, RegExp][] = [
  ['pigment', /색소|토닝|기미|잡티|미백|주근깨|흑자|홍조|혈관|레이저/],
  ['acne', /여드름|흉터|모공|트러블|피지|자국/],
  ['lifting', /리프팅|탄력|스킨\s?부스터|부스터|주름|보톡스|필러|안티|재생/],
  ['etc', /기타|관리|제모|패키지|이벤트|공통|상담|기초/],
];
export function folderTone(name: string): FolderTone {
  return rules.find(([, pattern]) => pattern.test(name))?.[0] ?? 'plain';
}

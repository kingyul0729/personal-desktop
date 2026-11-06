import { folderTone, folderTones } from '../folderTone';

// 폴더 그림은 모두 같은 청회색 하나. 목적 구분은 이름 앞 작은 색 점(ToneDot)으로만 한다.
export function ToneFolder() {
  return <svg className="tone-folder" viewBox="0 0 72 54" aria-hidden="true">
    <path d="M4 6a4 4 0 0 1 4-4h17.5a4 4 0 0 1 2.9 1.2L33 8h31a4 4 0 0 1 4 4v36a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Z" fill="#a3b0c0" />
    <rect x="4" y="13" width="64" height="39" rx="4" fill="#bfc9d5" />
  </svg>;
}

/** Finder 태그처럼 이름 앞에 붙는 작은 색 점. 색은 이름의 목적(folderTone)으로 정해진다. */
export function ToneDot({ name }: { name: string }) {
  const tone = folderTone(name);
  return <i className="tone-dot" data-tone={tone} style={{ background: folderTones[tone].back }} aria-hidden="true" />;
}

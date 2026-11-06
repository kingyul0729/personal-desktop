import { folderTone, folderTones } from '../folderTone';

/** 납작한 두 톤 폴더 그림(뒤판 조금 진하게, 앞판 밝게). 색은 폴더 이름의 목적에 따라 정해진다. */
export function ToneFolder({ name }: { name: string }) {
  const tone = folderTones[folderTone(name)];
  return <svg className="tone-folder" viewBox="0 0 72 54" aria-hidden="true" data-tone={folderTone(name)}>
    <path d="M4 6a4 4 0 0 1 4-4h17.5a4 4 0 0 1 2.9 1.2L33 8h31a4 4 0 0 1 4 4v36a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Z" fill={tone.back} />
    <rect x="4" y="13" width="64" height="39" rx="4" fill={tone.front} />
  </svg>;
}

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { KittyDialog } from './KittyDialog';
import { PinkFolderIcon, type PinkFolderVariant } from './PinkFolderIcon';
import { useDesktop } from '../useDesktop';

const VARIANTS: [PinkFolderVariant, string][] = [['heart', '하트'], ['kitty', '키티'], ['flower', '꽃'], ['cherry', '체리']];

// Resolves with the new icon value, null for the item's own default, or undefined when cancelled.
export function IconPicker({ current, onPick }: { current: string | null; onPick: (icon: string | null | undefined) => void }) {
  const { data, upload } = useDesktop();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const icons = data.assets.filter(asset => asset.kind === 'icon');
  return <KittyDialog title="아이콘 변경" onClose={() => onPick(undefined)} busy={busy}>
    <div className="icon-picker" role="group" aria-label="아이콘 선택">
      <button type="button" aria-pressed={current === null} onClick={() => onPick(null)}><span className="icon-picker-default">기본</span></button>
      {VARIANTS.map(([variant, label]) => <button key={variant} type="button" aria-label={label} aria-pressed={current === `folder:${variant}`} onClick={() => onPick(`folder:${variant}`)}><PinkFolderIcon variant={variant} /></button>)}
      {icons.map(asset => <button key={asset.id} type="button" aria-label="올린 이미지" aria-pressed={current === `asset:${asset.id}`} onClick={() => onPick(`asset:${asset.id}`)}><img src={asset.src} alt="" /></button>)}
      <button type="button" aria-label="이미지 업로드" disabled={busy} onClick={() => input.current?.click()}><Upload size={22} /></button>
    </div>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (!file) return;
      setBusy(true); setError('');
      const result = await upload(file, 'icon');
      setBusy(false);
      if (result.ok) onPick(`asset:${result.data.id}`); else setError(result.error);
    }} />
    {error && <p className="kitty-error" role="alert">{error}</p>}
    <footer className="kitty-dialog-actions"><button type="button" onClick={() => onPick(undefined)} disabled={busy}>취소</button></footer>
  </KittyDialog>;
}

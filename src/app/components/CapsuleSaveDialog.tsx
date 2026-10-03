import { useState, type FormEvent } from 'react';
import { KittyDialog } from './KittyDialog';
import { capsuleRequest, capsuleSummary, defaultCapsuleName, type Capsule, type CapsuleLayout } from '../workCapsules';

// Asks for a name and saves the given window layout; an empty name becomes the date and time.
export function CapsuleSaveDialog({ layout, onClose, onSaved }: { layout: CapsuleLayout; onClose: () => void; onSaved: (capsules: Capsule[]) => void }) {
  const [placeholder] = useState(() => defaultCapsuleName(new Date()));
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    const result = await capsuleRequest({ action: 'create', name: name.trim() || placeholder, layout });
    setBusy(false);
    if (result.ok) onSaved(result.capsules); else setError(result.error);
  };
  return <KittyDialog title="현재 화면 저장" busy={busy} onClose={onClose}>
    <form onSubmit={save}>
      <label className="kitty-field">작업 이름
        <input autoFocus maxLength={100} value={name} placeholder={placeholder} disabled={busy} onChange={event => setName(event.target.value)} />
      </label>
      <p className="kitty-question">{capsuleSummary(layout).names.join(' · ')}</p>
      {error && <p className="kitty-error" role="alert">{error}</p>}
      <footer className="kitty-dialog-actions">
        <button type="button" onClick={onClose} disabled={busy}>취소</button>
        <button type="submit" className="kitty-primary" disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
      </footer>
    </form>
  </KittyDialog>;
}

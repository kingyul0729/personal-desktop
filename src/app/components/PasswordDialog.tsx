import { useState, type FormEvent } from 'react';
import { KittyDialog } from './KittyDialog';

export function PasswordDialog({ name, onSubmit, onCancel }: { name: string; onSubmit: (password: string) => Promise<string>; onCancel: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy || !password) return;
    setBusy(true); setError(await onSubmit(password)); setBusy(false); setPassword('');
  };
  return <KittyDialog title="잠긴 항목" onClose={onCancel} busy={busy}>
    <form onSubmit={submit}>
      <label className="kitty-field">‘{name}’ 비밀번호
        <input type="password" autoFocus autoComplete="off" value={password} maxLength={64} disabled={busy} onChange={event => setPassword(event.target.value)} />
      </label>
      {error && <p className="kitty-error" role="alert">{error}</p>}
      <footer className="kitty-dialog-actions">
        <button type="button" onClick={onCancel} disabled={busy}>취소</button>
        <button type="submit" className="kitty-primary" disabled={busy || !password}>{busy ? '확인 중…' : '확인'}</button>
      </footer>
    </form>
  </KittyDialog>;
}

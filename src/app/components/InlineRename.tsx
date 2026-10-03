import { useRef, useState } from 'react';
import { Check } from 'lucide-react';

// Enter or the check button saves; Escape or tapping elsewhere cancels.
export function InlineRename({ value, label, onSave, onCancel }: { value: string; label: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const name = text.trim();
    if (save && name && name !== value) onSave(name); else onCancel();
  };
  return <span className="inline-rename" onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    <input autoFocus value={text} maxLength={100} aria-label={label} onFocus={event => event.currentTarget.select()}
      onChange={event => setText(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); finish(true); } else if (event.key === 'Escape') { event.preventDefault(); finish(false); } }}
      onBlur={() => window.setTimeout(() => finish(false), 150)} />
    <button type="button" aria-label="이름 저장" onClick={() => finish(true)}><Check size={16} /></button>
  </span>;
}

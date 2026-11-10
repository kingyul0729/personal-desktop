import { useEffect, useState } from 'react';
import { SavingMark } from '../Feedback';
import { announceInventory, invGet, invSend } from '../../inventoryApi';
import { errText } from './shared';

export function OldDataImport({ onDone, merge = false }: { onDone: () => void; merge?: boolean }) {
  const [file, setFile] = useState<{ name: string; tables: Record<string, Record<string, unknown>[]> } | null>(null);
  const [state, setState] = useState({ running: false, text: '', error: '' });
  const pick = async (f: File | undefined) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data?.format !== 'dachaeum-old-app' || typeof data.tables !== 'object') throw new Error('예전 자료 파일이 아니에요.');
      setFile({ name: f.name, tables: data.tables }); setState({ running: false, text: '', error: '' });
    } catch (e) { setFile(null); setState({ running: false, text: '', error: errText(e) }); }
  };
  const [code, setCode] = useState('');
  // 코드로 넣기: 사이트에 암호화해 둔 예전 자료(/old-data.enc)를 받은 코드로 브라우저에서 풀어 넣는다(저장소 공개라 원본은 올리지 않음)
  const fromCode = async () => {
    setState({ running: true, text: '자료를 여는 중…', error: '' });
    try {
      const enc = await (await fetch('/old-data.enc', { cache: 'no-store' })).json();
      const b = (x: string) => Uint8Array.from(atob(x), c => c.charCodeAt(0));
      const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code.trim().toUpperCase()), 'PBKDF2', false, ['deriveKey']);
      const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b(enc.salt), iterations: enc.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      let plain: ArrayBuffer;
      try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b(enc.iv) }, key, b(enc.data)); } catch { throw new Error('코드가 맞지 않아요.'); }
      const data = JSON.parse(new TextDecoder().decode(plain));
      await run({ name: '예전 앱 자료(코드)', tables: data.tables });
    } catch (e) { setState({ running: false, text: '', error: errText(e) }); }
  };
  const run = async (src = file) => {
    if (!src) return;
    const file = src;
    const entries = Object.entries(file.tables);
    const total = entries.reduce((n, [, rows]) => n + rows.length, 0);
    let sent = 0;
    setState({ running: true, text: '준비 중…', error: '' });
    if (merge) {
      const rows = file.tables.staff_attendance || [];
      let added = 0, filled = 0;
      try {
        for (let i = 0; i < rows.length; i += 15) {
          const r = await invSend('POST', '/import-merge', { rows: rows.slice(i, i + 15) });
          added += r.added; filled += r.filled; setState(s => ({ ...s, text: `확인 중 ${Math.min(i + 15, rows.length)} / ${rows.length}` }));
        }
        setState({ running: false, text: `근태 ${added}일을 더하고, 비어 있던 성과 숫자 ${filled}칸을 채웠어요. 이미 입력한 값은 그대로예요.`, error: '' });
        window.dispatchEvent(new Event('staff-data-changed')); onDone();
      } catch (e) { setState({ running: false, text: '', error: `${errText(e)} — 다시 눌러도 같은 값은 두 번 들어가지 않아요.` }); }
      return;
    }
    try {
      await invSend('POST', '/import', { step: 'start' });
      for (const [table, rows] of entries) for (let i = 0; i < rows.length; i += 40) {
        await invSend('POST', '/import', { step: 'rows', table, rows: rows.slice(i, i + 40) });
        sent += Math.min(40, rows.length - i); setState(s => ({ ...s, text: `넣는 중 ${sent} / ${total}` }));
      }
      await invSend('POST', '/import', { step: 'finish', label: file.name });
      setState({ running: false, text: `예전 자료 ${total}건을 넣었어요.`, error: '' }); window.dispatchEvent(new Event('staff-data-changed')); onDone();
    } catch (e) { setState({ running: false, text: '', error: `${errText(e)} — 다시 누르면 처음부터 다시 넣어요.` }); }
  };
  return <section className={`iv-import${merge ? ' is-merge' : ''}`}>
    <div><b>{merge ? '예전 근태·성과 더 넣기' : '예전 앱 자료 넣기'}</b></div>
    <div className="iv-inline">
      <label className="sf-btn"><input type="file" accept="application/json,.json" hidden onChange={e => void pick(e.target.files?.[0])} />{file ? file.name : '파일 고르기'}</label>
      <button type="button" className="sf-btn is-primary" disabled={!file || state.running} onClick={() => void run()}>{state.running && <SavingMark />}{merge ? '더 넣기' : '넣기'}</button>
    </div>
    {!merge && <div className="iv-inline iv-code"><span className="sf-hint">또는 받은 코드로</span>
      <input type="text" value={code} onChange={e => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" autoComplete="off" spellCheck={false} aria-label="예전 자료 코드" />
      <button type="button" className="sf-btn is-primary" disabled={code.trim().length < 16 || state.running} onClick={() => void fromCode()}>{state.running && <SavingMark />}코드로 넣기</button></div>}
    {state.text && <p className="sf-hint">{state.text}</p>}
    {state.error && <p className="sf-hint is-warn">{state.error}</p>}
  </section>;
}

// 아직 예전 자료를 안 넣었으면 직원 화면 위에도 넣기 칸을 보여 준다
export function OldDataBanner() {
  const [imported, setImported] = useState<string | null | undefined>(undefined);
  useEffect(() => { invGet('/import').then(d => setImported(d.imported), () => setImported('?')); }, []);
  if (imported !== null) return null;
  return <OldDataImport onDone={() => { setImported('done'); announceInventory(); }} />;
}

/* ───────────── 재고주문 ───────────── */

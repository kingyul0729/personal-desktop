import type { ReactNode } from 'react';

// Only these text marks are interpreted. React escapes all original text and raw HTML.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|__[^_\n]+__|==[^=\n]+==)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong className="note-important" key={i}>{part.slice(2, -2)}</strong>
      : part.startsWith('__') && part.endsWith('__') ? <strong className="note-remember" key={i}>{part.slice(2, -2)}</strong>
        : part.startsWith('==') && part.endsWith('==') ? <mark key={i}>{part.slice(2, -2)}</mark> : part);
}
export function StudyNoteText({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const nodes: ReactNode[] = [];
  const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*\|/.test(lines[i + 1] || '')) {
      const headings = cells(line), rows: string[][] = []; const key = i; i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      i--;
      nodes.push(<div className="note-table-scroll" key={key}><table><thead><tr>{headings.map((cell, n) => <th key={n}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, n) => <tr key={n}>{headings.map((_, c) => <td key={c}>{inline(row[c] || '')}</td>)}</tr>)}</tbody></table></div>);
    } else if (/^\s*#{1,3}\s/.test(line)) nodes.push(<h3 key={i}>{inline(line.replace(/^\s*#{1,3}\s+/, ''))}</h3>);
    else if (/^[①-⑳]\s*\S/.test(line.trim())) nodes.push(<h3 key={i}>{inline(line)}</h3>);
    else if (/^\s*[-*•]\s+/.test(line)) nodes.push(<div className="note-bullet" key={i}><span aria-hidden="true">•</span><p>{inline(line.replace(/^\s*[-*•]\s+/, ''))}</p></div>);
    else if (!line.trim()) nodes.push(<div className="note-paragraph-gap" key={i} />);
    else nodes.push(<p key={i}>{inline(line)}</p>);
  }
  return <div className="note-formatted">{nodes}</div>;
}

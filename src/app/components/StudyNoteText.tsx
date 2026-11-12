import type { ReactNode } from 'react';

// Only these text marks are interpreted. React escapes all original text and raw HTML.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|__[^_\n]+__|==[^=\n]+==)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong className="note-important" key={i}>{part.slice(2, -2)}</strong>
      : part.startsWith('__') && part.endsWith('__') ? <strong className="note-remember" key={i}>{part.slice(2, -2)}</strong>
        : part.startsWith('==') && part.endsWith('==') ? <mark key={i}>{part.slice(2, -2)}</mark> : part);
}
const numbered = (text: string) => /^(\d+\s*[.)]|\(\d+\)|[①-⑳]|[가-하]\s*[.)])/.test(text.trim());
export function StudyNoteText({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const nodes: ReactNode[] = [];
  let n2 = 0, n3 = 0;
  const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const tabs = (value: string) => value.includes('\t') ? value.split('\t').map(cell => cell.trim()) : null, first = tabs(line);
    if (first && first.length > 1 && tabs(lines[i + 1] || '')?.length === first.length) {
      // 엑셀·한글에서 복사한 표(칸 사이가 탭): 첫 줄을 머리로
      const rows: string[][] = []; const key = i; i++;
      while (i < lines.length && tabs(lines[i])?.length === first.length) rows.push(tabs(lines[i++])!);
      i--;
      nodes.push(<div className="note-table-scroll" key={key}><table><thead><tr>{first.map((cell, n) => <th key={n}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, n) => <tr key={n}>{row.map((cell, c) => <td key={c}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>);
    } else if (line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*\|/.test(lines[i + 1] || '')) {
      const headings = cells(line), rows: string[][] = []; const key = i; i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      i--;
      nodes.push(<div className="note-table-scroll" key={key}><table><thead><tr>{headings.map((cell, n) => <th key={n}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, n) => <tr key={n}>{headings.map((_, c) => <td key={c}>{inline(row[c] || '')}</td>)}</tr>)}</tbody></table></div>);
    } else if (/^\s*#{1,3}\s/.test(line)) {
      // 노트 양식: # 강 → ## 소제목 1) → ### 작은 소제목 (1). 번호를 직접 적은 제목에는 자동 번호를 붙이지 않는다.
      const level = /^\s*(#+)/.exec(line)![1].length, text = line.replace(/^\s*#{1,3}\s+/, '');
      if (level === 1) n2 = n3 = 0; else if (level === 2) { n2++; n3 = 0; } else n3++;
      nodes.push(<h3 className={`note-h${level}`} data-no={level > 1 && !numbered(text) ? (level === 2 ? `${n2})` : `(${n3})`) : undefined} key={i}>{inline(text)}</h3>);
    } else if (/^\s*((제\s*)?\d+\s*[강장](\s|$|[.:·])|(chapter|part)\s*\d+)/i.test(line)) { n2 = n3 = 0; nodes.push(<h3 className="note-h1" key={i}>{inline(line.trim())}</h3>); }
    // 기호 없이 평소 적는 대로: 'N강' → 강, 'N)' → 소제목, '(N)'·'※' → 작은 소제목 (적은 번호 그대로)
    else if (/^\s*\d+(\)|\.\s)\s*\S/.test(line)) nodes.push(<h3 className="note-h2" key={i}>{inline(line.trim())}</h3>);
    else if (/^\s*(\(\d+\)|※|[가나다라마바사아자차카타파하][.)]\s)\s*\S/.test(line)) nodes.push(<h3 className="note-h3" key={i}>{inline(line.trim())}</h3>);
    else if (/^[①-⑳]\s*\S/.test(line.trim())) nodes.push(<h3 className="note-h2" key={i}>{inline(line)}</h3>);
    else if (/^\s*(>|핵심\s*[:：])\s*\S/.test(line)) nodes.push(<p className="note-key" key={i}><b>핵심</b>{inline(line.replace(/^\s*(>|핵심\s*[:：])\s*/, ''))}</p>);
    else if (/^\s*[-*•·–▪◦○●■□▶→]\s+/.test(line)) nodes.push(<div className="note-bullet" key={i}><span aria-hidden="true">–</span><p>{inline(line.replace(/^\s*[-*•·–▪◦○●■□▶→]\s+/, ''))}</p></div>);
    else if (!line.trim()) nodes.push(<div className="note-paragraph-gap" key={i} />);
    else nodes.push(<p key={i}>{inline(line)}</p>);
  }
  return <div className="note-formatted">{nodes}</div>;
}

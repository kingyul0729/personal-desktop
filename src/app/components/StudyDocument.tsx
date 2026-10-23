import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { studyDate, studyUrl, type StudyNote } from '../study';

export function StudyDocument({ note, folder, fontSize = 18 }: { note: StudyNote; folder: string; fontSize?: number }) {
  return <article className="study-paper" aria-label="공부노트 본문" style={{ fontSize }}>
    <header className="study-paper-header"><p>{folder}</p><h1>{note.title || '제목 없는 공부노트'}</h1>
      <small>{note.revision ? `${studyDate(note.updatedAt)} 수정` : '작성 중인 노트'}</small></header>
    <div className="study-prose"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={studyUrl}
      components={{
        // The document title owns h1; section headings start at h2.
        h1: ({ children }) => <h2>{children}</h2>,
        a: ({ href, children }) => href ? <a href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
        img: ({ src, alt }) => src ? <span className="study-figure"><img src={src} alt={alt || '공부 자료 이미지'} loading="lazy" /><span>{alt}</span></span> : <span className="study-image-missing">{alt || '이미지'} · 편집 화면의 ‘이미지’로 추가해 주세요.</span>,
        table: ({ children }) => <div className="study-table-scroll" role="region" aria-label="비교표" tabIndex={0}><table>{children}</table></div>,
      }}>{note.content}</ReactMarkdown></div>
  </article>;
}

import { useState, type ReactNode } from 'react';
import './story.css';

export interface ChapterDef {
  id: string;
  label: string;
}

/** Sticky row of jump links. Scrolls sideways on narrow screens. */
export function ChapterNav({ chapters }: { chapters: ChapterDef[] }) {
  return (
    <nav className="chapter-nav" aria-label="Jump to a section">
      <ul>
        {chapters.map((c) => (
          <li key={c.id}><a href={`#${c.id}`}>{c.label}</a></li>
        ))}
      </ul>
    </nav>
  );
}

/** One chapter of the story: a short heading, one plain sentence, then the content. */
export function Chapter({
  id, number, title, lead, children,
}: {
  id: string;
  number: number;
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="chapter" aria-labelledby={`${id}-h`}>
      <header className="chapter-head">
        <span className="chapter-num" aria-hidden="true">{number}</span>
        <div>
          <h2 id={`${id}-h`}>{title}</h2>
          {lead && <p className="chapter-lead">{lead}</p>}
        </div>
      </header>
      <div className="stack">{children}</div>
    </section>
  );
}

/** Collapsible block. Children are only mounted after the first open, so heavy charts load on demand. */
export function Details({
  title, hint, children, defaultOpen = false,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [seen, setSeen] = useState(defaultOpen);
  return (
    <details className="more" open={defaultOpen} onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) setSeen(true); }}>
      <summary>
        <span className="more-title">{title}</span>
        {hint && <span className="more-hint">{hint}</span>}
      </summary>
      <div className="more-body">{seen ? children : null}</div>
    </details>
  );
}

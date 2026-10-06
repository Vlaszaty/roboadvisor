import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { termById } from './terms';

/** Plain-English word that links to its glossary entry. Shows the term's meaning as a tooltip. */
export function Term({ id, children }: { id: string; children?: ReactNode }) {
  const t = termById(id);
  if (!t) return <>{children}</>;
  return (
    <Link to={`/glossary#${id}`} className="term" title={`${t.technical}: ${t.meaning}`}>
      {children ?? t.plain}
    </Link>
  );
}

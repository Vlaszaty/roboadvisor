import { useId, type ReactNode } from 'react';
import { TableScroll, type ChartTable } from '../charts/ChartFrame';
import { ExplainButton } from '../../explain/Explain';
import { Details } from '../Story';
import type { StepCopy } from './copy';
import './textbook.css';

const STEP_LABELS = { example: 'With your numbers', notice: 'What to notice', formula: 'Show the formula' };

/**
 * One explained calculation step: what we do, the formula with its source, a worked example with real numbers,
 * the result (children), and what to notice.
 */
export function Step({ n, copy, example, children, labels = STEP_LABELS, explain = true }: {
  n: number; copy: StepCopy; example: string; children: ReactNode;
  /** Headings of the example, notice and formula parts; the café method page passes translated ones. */
  labels?: { example: string; notice: string; formula: string };
  /** Show the Explain button (its content is written for the lesson steps). */
  explain?: boolean;
}) {
  const id = useId();
  return (
    <section className="card step" id={`step-${n}`} aria-labelledby={id}>
      <header className="step-head">
        <span className="step-n" aria-hidden="true">{n}</span>
        <div>
          <h2 id={id}>{copy.title}</h2>
          <p className="step-tech">{copy.technicalTitle}</p>
        </div>
        {explain && <ExplainButton id={`step.${n}`} />}
      </header>
      <p className="step-plain">{copy.plain}</p>
      <p className="step-example"><strong>{labels.example}.</strong> {example}</p>
      {children}
      <p className="step-notice"><strong>{labels.notice}.</strong> {copy.notice}</p>
      <Details title={labels.formula} hint={copy.source}>
        <p>{copy.what}</p>
        <div className="step-formula">
          <div className="formula">{copy.formula}</div>
          <div className="small muted">{copy.source}</div>
        </div>
      </Details>
    </section>
  );
}

/** A ChartTable as a plain visible table; `highlight` marks one column (0-based) as the one in use; `text` lists text columns (others after the first are numbers). */
export function DataTable({ table, label, highlight, text = [] }: { table: ChartTable; label: string; highlight?: number; text?: number[] }) {
  const cls = (ci: number) => [ci > 0 && !text.includes(ci) ? 'num' : '', ci === highlight ? 'used' : ''].join(' ').trim() || undefined;
  return (
    <TableScroll label={label}>
      <table className="table">
        <thead>
          <tr>{table.head.map((h, ci) => <th key={h} scope="col" className={cls(ci)}>{h}{ci === highlight ? ' (used)' : ''}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((r, ri) => (
            <tr key={ri}>{r.map((c, ci) => <td key={ci} className={cls(ci)}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

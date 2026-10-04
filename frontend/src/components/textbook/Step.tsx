import { useId, type ReactNode } from 'react';
import { TableScroll, type ChartTable } from '../charts/ChartFrame';
import type { StepCopy } from './copy';
import './textbook.css';

/**
 * One explained calculation step: what we do, the formula with its source, a worked example with real numbers,
 * the result (children), and what to notice.
 */
export function Step({ n, copy, example, children }: { n: number; copy: StepCopy; example: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="card step" aria-labelledby={id}>
      <h2 id={id}><span className="step-n">{n}</span> {copy.title}</h2>
      <p>{copy.what}</p>
      <div className="step-formula">
        <div className="formula">{copy.formula}</div>
        <div className="small muted">{copy.source}</div>
      </div>
      <p className="step-example"><strong>Worked example.</strong> {example}</p>
      {children}
      <p className="step-notice"><strong>What to notice.</strong> {copy.notice}</p>
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

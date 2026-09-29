import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';
import './results.css';

export interface ChartTable {
  head: string[];
  rows: Array<Array<string | number>>;
}

/**
 * Title + accessible description + chart + optional visible note + "View as table" fallback.
 * The chart itself is exposed to assistive tech as a single image described by `description`.
 */
export function ChartFrame({
  title, description, note, table, children,
}: {
  title: string;
  description: string;
  note?: ReactNode;
  table?: ChartTable;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <figure className="chart-frame">
      <h4 className="chart-title" id={`${id}-t`}>{title}</h4>
      <p className="sr-only" id={`${id}-d`}>{description}</p>
      <div className="chart-box" role="img" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}>{children}</div>
      {note && <p className="chart-note">{note}</p>}
      {table && (
        <details className="chart-table">
          <summary>View as table</summary>
          <TableScroll label={`${title}, data table`}>
            <table className="table">
              <thead>
                <tr>{table.head.map((h, i) => <th key={h} scope="col" className={i > 0 ? 'num' : undefined}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {table.rows.map((r, ri) => (
                  <tr key={ri}>{r.map((c, ci) => <td key={ci} className={ci > 0 ? 'num' : undefined}>{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </details>
      )}
    </figure>
  );
}

/** Horizontal scroll container for wide tables (keyboard focusable so it can be scrolled without a mouse). */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>{children}</div>;
}

/** Label + control pair; injects the generated id into the single child control. */
export function Field({
  label, hint, children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactElement<{ id?: string }>;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id })}
      {hint && <div className="small muted">{hint}</div>}
    </div>
  );
}

export interface TipEntry {
  name?: unknown;
  value?: unknown;
  color?: string;
  dataKey?: unknown;
}

/** Tooltip body shared by charts. Used as `<Tooltip content={<ChartTip ... />} />`; Recharts injects the props. */
export function ChartTip({
  active, payload, label, labelFormat, valueFormat,
}: {
  active?: boolean;
  payload?: readonly TipEntry[];
  label?: unknown;
  labelFormat?: (label: unknown) => string;
  valueFormat?: (value: number, name: string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const items = payload.filter((p) => typeof p.value === 'number');
  if (items.length === 0) return null;
  const title = label == null || label === '' ? null : labelFormat ? labelFormat(label) : String(label);
  return (
    <div className="tip">
      {title && <div className="tip-title">{title}</div>}
      {items.map((p) => (
        <div key={String(p.dataKey ?? p.name)}>
          {p.color && <span className="swatch" style={{ background: p.color }} />}
          {String(p.name)}: <span className="num">{valueFormat ? valueFormat(p.value as number, String(p.name)) : String(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

import { Fragment } from 'react';
import type { Schemas } from '../../api/client';
import { stepTitle, summaryEntries } from './transforms';
import './results.css';

export function TraceList({ trace }: { trace: Schemas['StepResult'][] }) {
  if (trace.length === 0) return <p className="muted">No calculation trace was returned.</p>;
  return (
    <details>
      <summary>Show the {trace.length} calculation steps</summary>
      <ol className="trace" style={{ marginTop: 'var(--space-4)' }}>
        {trace.map((step) => {
          const entries = summaryEntries(step.summary);
          const notes = step.notes ?? [];
          return (
            <li key={step.step}>
              <h4>{stepTitle(step.step)}<code>{step.step}</code></h4>
              {entries.length > 0 && (
                <dl className="kv">
                  {entries.map(([k, v]) => (
                    <Fragment key={k}><dt>{k}</dt><dd className="num">{v}</dd></Fragment>
                  ))}
                </dl>
              )}
              {notes.length > 0 && <ul>{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

import type { ReactNode } from 'react';
import { Button } from '../ui';
import type { RequestState } from './hooks';
import './results.css';

export function Loading({ label = 'Loading…', className = 'muted' }: { label?: string; className?: string }) {
  return <div role="status" className={className}>{label}</div>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="banner banner-error stack" style={{ gap: 'var(--space-2)' }}>
      <div><strong>Something went wrong.</strong> {message}</div>
      {onRetry && <div><Button type="button" onClick={onRetry}>Try again</Button></div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <section className="card stack" style={{ gap: 'var(--space-3)' }}>
      <h2 style={{ marginBottom: 0 }}>{title}</h2>
      {children && <p className="muted" style={{ margin: 0 }}>{children}</p>}
      {action && <div>{action}</div>}
    </section>
  );
}

/** Renders loading / error states, then `children(data)` once the request succeeded. */
export function Async<T>({
  state, onRetry, children,
}: {
  state: RequestState<T>;
  onRetry?: () => void;
  children: (data: T) => ReactNode;
}) {
  if (state.status === 'ok') return <>{children(state.data)}</>;
  if (state.status === 'error') return <ErrorBox message={state.message} onRetry={onRetry} />;
  return state.status === 'loading' ? <Loading /> : null;
}

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ExplainButton } from '../explain/Explain';

export function Button({ variant = 'default', className = '', type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' }) {
  return <button type={type} className={`btn ${variant === 'primary' ? 'btn-primary' : ''} ${className}`} {...rest} />;
}

export function LinkButton({ to, children, variant = 'default' }: { to: string; children: ReactNode; variant?: 'default' | 'primary' }) {
  return <Link to={to} className={`btn ${variant === 'primary' ? 'btn-primary' : ''}`}>{children}</Link>;
}

export function Card({ title, explain, children }: { title?: string; explain?: string; children: ReactNode }) {
  return (
    <section className="card">
      {explain ? (
        <div className="card-head">
          {title && <h3>{title}</h3>}
          <ExplainButton id={explain} />
        </div>
      ) : (
        title && <h3>{title}</h3>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function PageHeader({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <header style={{ marginBottom: 'var(--space-5)' }}>
      <h1>{title}</h1>
      {lead && <p className="muted">{lead}</p>}
    </header>
  );
}

export const pct = (x: number | null | undefined, digits = 1) => (x == null ? '–' : `${(x * 100).toFixed(digits)}%`);

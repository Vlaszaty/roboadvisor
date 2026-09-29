import { Button } from '../components/ui';

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <p role="status" className="api-loading">
      <span className="api-spinner" aria-hidden="true" />
      {label}…
    </p>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="api-error">
      <strong>Something went wrong.</strong>
      <p>{message}</p>
      {onRetry && (
        <Button type="button" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

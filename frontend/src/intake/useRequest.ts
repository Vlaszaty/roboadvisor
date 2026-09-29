import { useEffect, useState } from 'react';

export type RequestState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; data: T };

/** Runs `load` on mount and whenever `deps` change. The second return value retries. */
export function useRequest<T>(load: () => Promise<T>, deps: readonly unknown[]): [RequestState<T>, () => void] {
  const [state, setState] = useState<RequestState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    load().then(
      (data) => alive && setState({ status: 'ok', data }),
      (e) => alive && setState({ status: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      alive = false;
    };
    // `load` is intentionally not a dependency: callers list what should trigger a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  return [state, () => setAttempt((a) => a + 1)];
}

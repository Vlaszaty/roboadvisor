import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from './format';

export type RequestState<T> =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: T };

type Result<T> = { data?: T; error?: unknown };

/**
 * Runs `run` whenever `key` (a stable string describing the inputs) or `enabled` changes and cancels the
 * previous request. `run` should return the openapi-fetch result directly.
 */
export function useRequest<T>(
  run: (signal: AbortSignal) => Promise<Result<T>>,
  key: string,
  enabled = true,
): { state: RequestState<T>; reload: () => void } {
  const [state, setState] = useState<RequestState<T>>({ status: enabled ? 'loading' : 'idle' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle' });
      return;
    }
    const ctl = new AbortController();
    setState({ status: 'loading' });
    run(ctl.signal)
      .then((res) => {
        if (ctl.signal.aborted) return;
        if (res.error !== undefined || res.data === undefined) setState({ status: 'error', message: errorMessage(res.error) });
        else setState({ status: 'ok', data: res.data });
      })
      .catch((err: unknown) => {
        if (!ctl.signal.aborted) setState({ status: 'error', message: errorMessage(err) });
      });
    return () => ctl.abort();
    // `run` is intentionally not a dependency: `key` describes its inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { state, reload };
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

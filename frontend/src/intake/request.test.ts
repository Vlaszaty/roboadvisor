import { describe, expect, it } from 'vitest';
import { ApiError, unwrap } from './request';

const res = (status: number) => new Response(null, { status });

describe('unwrap', () => {
  it('returns data on success', async () => {
    await expect(unwrap(Promise.resolve({ data: { a: 1 }, response: res(200) }))).resolves.toEqual({ a: 1 });
  });
  it('rejects with the server detail', async () => {
    const p = unwrap(Promise.resolve({ error: { error: 'NoEligibleFunds', detail: 'nothing left after filters' }, response: res(422) }));
    await expect(p).rejects.toThrow('nothing left after filters');
    await expect(p).rejects.toBeInstanceOf(ApiError);
  });
  it('rejects with the status when the body is empty', async () => {
    await expect(unwrap(Promise.resolve({ error: '', response: res(500) }))).rejects.toThrow('HTTP 500');
  });
  it('explains network failures', async () => {
    await expect(unwrap(Promise.reject(new TypeError('Failed to fetch')))).rejects.toThrow(/could not reach the server/i);
  });
});

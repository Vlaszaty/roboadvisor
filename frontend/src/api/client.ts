import createClient from 'openapi-fetch';
import type { components, paths } from './schema';
import { mockFetch } from '../mocks';

export type Schemas = components['schemas'];

const useMocks = import.meta.env.VITE_USE_MOCKS === '1';

export const api = createClient<paths>({
  baseUrl: typeof window === 'undefined' ? 'http://localhost:5740' : window.location.origin,
  ...(useMocks ? { fetch: mockFetch } : {}),
});

import { errorMessage } from './logic';

export class ApiError extends Error {}

interface Result<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/** Turn an openapi-fetch result into its data, or throw an ApiError with a message fit to show a person. */
export async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  let result: Result<T>;
  try {
    result = await request;
  } catch (e) {
    const why = e instanceof Error ? e.message : 'network error';
    throw new ApiError(`Could not reach the server (${why}). Is the backend running on port 8740?`);
  }
  if (result.error !== undefined || result.data === undefined) {
    throw new ApiError(errorMessage(result.error, result.response.status));
  }
  return result.data;
}

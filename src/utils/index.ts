import { randomUUID } from 'crypto';

export const CLIENT_METHOD_PREFIX = randomUUID();

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function captureError<TReturn>(
  fn: () => TReturn
): Promise<TReturn | Error> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Error) {
      return e;
    }
    throw e;
  }
}

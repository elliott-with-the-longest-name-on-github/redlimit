import { describe, it, expect, beforeEach } from 'vitest';
import { Mutex } from './Mutex';
import { randomUUID } from 'crypto';
import Redis from 'ioredis-mock';
import type { LockOptions } from './types.js';
import { captureError, sleep } from './utils';
import { TimeoutError } from './errors/TimeoutError';

const client = new Redis();

function args(overrides: Partial<LockOptions> = {}): Required<LockOptions> {
  return {
    lockTimeout: 10000,
    refreshInterval: 0,
    acquireTimeout: 10000,
    acquireAttemptsLimit: Number.POSITIVE_INFINITY,
    retryInterval: 100,
    ...overrides,
  };
}

function categorizeRace<T>(
  arg1: T,
  arg2: T
): { success: Exclude<T, Error>; failure: Error } {
  if (arg1 instanceof Error && !(arg2 instanceof Error)) {
    return { success: arg2 as Exclude<T, Error>, failure: arg1 };
  } else if (arg2 instanceof Error && !(arg1 instanceof Error)) {
    return { success: arg1 as Exclude<T, Error>, failure: arg2 };
  }
  throw new Error(
    `expected one of these to be an error and the other to be anything else: ${arg1}, ${arg2}`
  );
}

describe('Mutex', () => {
  let key: string;

  beforeEach(() => {
    const id = randomUUID();
    key = `redlimit:mutex:${id}`;
  });

  describe('protect', () => {
    it('does not allow simultaneous invocations of the same function', async () => {
      // sleep for longer than the acquire timeout but shorter than the lock timeout
      const fn = new Mutex(
        client,
        key,
        args({ lockTimeout: 1000, acquireTimeout: 50 })
      ).protect(() => sleep(100).then(() => 'hi'));
      const [firstAttempt, secondAttempt] = await Promise.all([
        captureError(fn),
        captureError(fn),
      ]);
      const { success, failure } = categorizeRace(firstAttempt, secondAttempt);
      expect(success).toBe('hi');
      expect(failure).toBeInstanceOf(TimeoutError);
    });

    it('waits to acquire while the lock is taken', async () => {
      // sleep for longer than the acquire timeout but shorter than the lock timeout
      const fn = new Mutex(
        client,
        key,
        args({ lockTimeout: 1000, acquireTimeout: 50 })
      ).protect(() => sleep(100).then(() => 'hi'));
      const [firstAttempt, secondAttempt] = await Promise.all([
        captureError(fn),
        captureError(fn),
      ]);
      const { success, failure } = categorizeRace(firstAttempt, secondAttempt);
      expect(success).toBe('hi');
      expect(failure).toBeInstanceOf(TimeoutError);
    });
  });
});

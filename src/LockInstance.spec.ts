import { describe, it, expect, beforeEach, afterEach, vitest } from 'vitest';
import { TestRedisLock, mockRefresh } from './test-utils/TestRedisLock';
import { LockInstance } from './LockInstance';
import type { RedisLock } from './redis-client/lock';
import type { LockOptions } from './types.js';
import { InternalError } from './errors/InternalError';
import { sleep } from './utils';
import { AbortError } from './errors/AbortError';
import { LostLockError } from './errors/LostLockError';

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

describe('LockInstance', () => {
  let redisLock: RedisLock;

  beforeEach(() => {
    redisLock = new TestRedisLock();
  });

  afterEach(() => {
    vitest.clearAllMocks();
  });

  describe('run', () => {
    it('runs a function with no refreshes', async () => {
      const lock = new LockInstance(redisLock, args());
      const result = await lock.invoke(() => 'hi');

      expect(result).toBe('hi');

      expect(redisLock.acquire).toHaveBeenCalledOnce();
      expect(redisLock.acquire).toHaveBeenCalledWith({
        instanceIdentifier: expect.any(String),
        lockTimeout: 10000,
        acquireTimeout: 10000,
        acquireAttemptsLimit: Number.POSITIVE_INFINITY,
        retryInterval: 100,
      });

      expect(redisLock.refresh).not.toHaveBeenCalled();

      expect(redisLock.release).toHaveBeenCalledOnce();
      expect(redisLock.release).toHaveBeenCalledWith({
        instanceIdentifier: expect.any(String),
      });
    });

    it('refuses to reuse the same instance', async () => {
      const lock = new LockInstance(redisLock, args());
      const firstResult = await lock.invoke(() => 'hi');
      const secondAttempt = lock.invoke(() => 'oh no');

      expect(firstResult).toBe('hi');
      await expect(secondAttempt).rejects.toBeInstanceOf(InternalError);
    });

    it('aborts', async () => {
      const lock = new LockInstance(redisLock, args());
      let abortSignal: AbortSignal | undefined;
      const attempt = lock.invoke(async (signal) => {
        abortSignal = signal;
        await sleep(1000);
      });
      lock.abort();
      await expect(attempt).rejects.toBeInstanceOf(AbortError);
      expect(abortSignal?.aborted).toBe(true);
    });

    it('sets up refresh when configured to', async () => {
      const lock = new LockInstance(redisLock, args({ refreshInterval: 10 }));
      const result = await lock.invoke(() => sleep(100).then(() => 'hi'));

      expect(result).toBe('hi');

      expect(redisLock.acquire).toHaveBeenCalledOnce();
      expect(redisLock.acquire).toHaveBeenCalledWith({
        instanceIdentifier: expect.any(String),
        lockTimeout: 10000,
        acquireTimeout: 10000,
        acquireAttemptsLimit: Number.POSITIVE_INFINITY,
        retryInterval: 100,
      });

      expect(redisLock.refresh).toHaveBeenCalled();
      expect(redisLock.refresh).toHaveBeenLastCalledWith({
        instanceIdentifier: expect.any(String),
        lockTimeout: 10000,
      });

      expect(redisLock.release).toHaveBeenCalledOnce();
      expect(redisLock.release).toHaveBeenCalledWith({
        instanceIdentifier: expect.any(String),
      });
    });

    it('throws a catchable error when refresh is not configured and lock times out', async () => {
      const lock = new LockInstance(redisLock, args({ lockTimeout: 10 }));
      let abortSignal: AbortSignal | undefined;
      await expect(
        lock.invoke(async (signal) => {
          abortSignal = signal;
          return await sleep(100).then(() => 'hi');
        })
      ).rejects.toBeInstanceOf(LostLockError);
      expect(abortSignal?.aborted).toBe(true);
    });

    it('throws a catchable error when a lock times out on refresh', async () => {
      const lock = new LockInstance(redisLock, args({ refreshInterval: 10 }));
      mockRefresh.mockRejectedValueOnce(
        new LostLockError('mutex', 'test', 'test-instance-id')
      );
      let abortSignal: AbortSignal | undefined;
      await expect(
        lock.invoke(async (signal) => {
          abortSignal = signal;
          return await sleep(100).then(() => 'hi');
        })
      ).rejects.toBeInstanceOf(LostLockError);
      expect(abortSignal?.aborted).toBe(true);
    });
  });
});

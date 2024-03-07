import { describe, it, expect, beforeEach } from 'vitest';
import { AcquireArgs } from './lock';
import Redis from 'ioredis-mock';
import { RedisMutex } from './mutex';
import { TimeoutError } from '../errors/TimeoutError';
import { randomUUID } from 'crypto';
import { LostLockError } from '../errors/LostLockError';

const client = new Redis();
const opts = (id: string, overrides?: Partial<AcquireArgs>): AcquireArgs => ({
  instanceIdentifier: id,
  acquireTimeout: 50,
  acquireAttemptsLimit: Number.POSITIVE_INFINITY,
  lockTimeout: 100,
  retryInterval: 10,
  ...overrides,
});

describe('redis-client mutex', () => {
  let key: string;
  let mutex: RedisMutex;

  beforeEach(() => {
    const id = randomUUID();
    mutex = new RedisMutex(client, id);
    key = `redlimit:mutex:${id}`;
  });

  describe('acquire', () => {
    it('should resolve when successfully acquiring a lock', async () => {
      await expect(mutex.acquire(opts('111'))).resolves.toBeUndefined();
    });
    it('should throw a timeout error if it exceeds its timeout configuration while waiting for a lock', async () => {
      await mutex.acquire(opts('111'));
      await expect(mutex.acquire(opts('222'))).rejects.toBeInstanceOf(
        TimeoutError
      );
    });
    it('should throw a timeout error if it reaches the maximum number of attempts', async () => {
      await mutex.acquire(opts('111'));
      await expect(
        mutex.acquire(
          opts('222', {
            acquireAttemptsLimit: 1,
            acquireTimeout: Number.POSITIVE_INFINITY,
          })
        )
      ).rejects.toBeInstanceOf(TimeoutError);
    });
    it('should set identifier for key', async () => {
      await mutex.acquire(opts('111'));
      const value = await client.get(key);
      expect(value).toBe('111');
    });
    it('should set TTL for key', async () => {
      await mutex.acquire(opts('111'));
      const ttl = await client.pttl(key);
      expect(ttl).toBeGreaterThanOrEqual(90);
      expect(ttl).toBeLessThanOrEqual(100);
    });
    it('should wait for auto-release', async () => {
      await mutex.acquire(
        opts('111', {
          lockTimeout: 100,
        })
      );
      await expect(
        mutex.acquire(opts('222', { acquireTimeout: 50 }))
      ).rejects.toBeInstanceOf(TimeoutError);
      await mutex.acquire(opts('333', { acquireTimeout: 200 }));
    });
  });

  describe('refresh', () => {
    it('should throw a lock lost error if attempting to refresh a taken lock', async () => {
      await client.set(key, '222');
      await expect(
        mutex.refresh({
          instanceIdentifier: '111',
          lockTimeout: 10000,
        })
      ).rejects.toBeInstanceOf(LostLockError);
    });
    it('should throw a lock lost error if attempting to refresh a lock it does not have', async () => {
      await expect(
        mutex.refresh({
          instanceIdentifier: '111',
          lockTimeout: 10000,
        })
      ).rejects.toBeInstanceOf(LostLockError);
    });
    it('should resolve when refreshing a lock it owns', async () => {
      await client.set(key, '111');
      await mutex.refresh({
        instanceIdentifier: '111',
        lockTimeout: 10000,
      });
      expect(await client.pttl(key)).toBeGreaterThanOrEqual(10000);
    });
  });

  describe('release', () => {
    it('should remove key after release', async () => {
      await client.set(key, '111');
      await mutex.release({ instanceIdentifier: '111' });
      expect(await client.get(key)).toBeNull();
    });
    it('should do nothing if resource is not locked', async () => {
      expect(await client.get(key)).toBeNull();
      await mutex.release({ instanceIdentifier: '111' });
      expect(await client.get(key)).toBeNull();
    });
  });
});

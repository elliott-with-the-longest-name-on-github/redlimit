import { describe, it, expect, beforeEach } from 'vitest';
import { AcquireArgs } from './lock';
import Redis from 'ioredis-mock';
import { RedisSemaphore } from './semaphore';
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

describe('redis-client semaphore', () => {
  let key: string;
  let sema: RedisSemaphore;

  beforeEach(() => {
    const id = randomUUID();
    sema = new RedisSemaphore(client, id, 2);
    key = `redlimit:semaphore:${id}`;
  });

  describe('acquire', () => {
    it('should successfully acquire', async () => {
      await sema.acquire(opts('111'));
      await expect(client.zscore(key, '111')).resolves.toMatch(/\d+/);
    });
    it('should return false when timeout', async () => {
      await sema.acquire(opts('111')); // expire after 100ms
      await sema.acquire(opts('112')); // expire after 100ms
      await expect(sema.acquire(opts('113'))).rejects.toBeInstanceOf(
        TimeoutError
      ); // timeout after 50ms
    });
    it('should return false after acquireAttemptsLimit', async () => {
      await sema.acquire(opts('111')); // expire after 100ms
      await sema.acquire(opts('112')); // expire after 100ms
      await expect(
        sema.acquire(
          opts('113', {
            acquireAttemptsLimit: 1,
            acquireTimeout: Number.POSITIVE_INFINITY,
          })
        )
      ).rejects.toBeInstanceOf(TimeoutError); // no timeout, acquire limit = 1
    });
  });

  describe('refresh', () => {
    it('should throw a lock lost error if the lock is not acquired by this instance', async () => {
      const now = '' + (Date.now() - 10);
      await client.zadd(key, now, '222', now, '333');
      await expect(sema.refresh(opts('111'))).rejects.toBeInstanceOf(
        LostLockError
      );
      expect(await client.zrange(key, 0, -1)).toEqual(['222', '333']);
    });
    it('should expire old entries when refreshing, throwing a lock lost error', async () => {
      const now = '' + (Date.now() - 10);
      const oldNow = '' + (Date.now() - 10000);
      await client.zadd(key, oldNow, '222', now, '333');
      expect(await client.zrange(key, 0, -1)).toEqual(['222', '333']);
      await expect(sema.refresh(opts('111'))).rejects.toBeInstanceOf(
        LostLockError
      );
      expect(await client.zrange(key, 0, -1)).toEqual(['333']);
    });
    it('should successfully refresh an acquired lock', async () => {
      const now = '' + (Date.now() - 10);
      await client.zadd(key, now, '111', now, '222');
      expect(await client.zrange(key, 0, -1)).toEqual(['111', '222']);
      await sema.refresh(opts('111'));
      expect(await client.zrange(key, 0, -1)).toEqual(['222', '111']);
    });
  });

  describe('release', () => {
    it('should remove key after successful release', async () => {
      await client.zadd(key, '' + Date.now(), '111');
      expect(await client.zcard(key)).toEqual(1);
      await sema.release({ instanceIdentifier: '111' });
      expect(await client.zcard(key)).toEqual(0);
    });
    it('should do nothing if resource is not locked', async () => {
      expect(await client.zcard(key)).to.be.eql(0);
      await sema.release({ instanceIdentifier: '111' });
      expect(await client.zcard(key)).to.be.eql(0);
    });
  });
});

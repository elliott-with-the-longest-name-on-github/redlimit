import { Redis } from 'ioredis';
import { LockManager } from './Lock.js';
import type { LockOptions } from './types.js';
import { RedisSemaphore } from './redis-client/semaphore.js';

export class Semaphore extends LockManager {
  constructor(
    client: Redis,
    key: string,
    limit: number,
    options?: LockOptions
  ) {
    const redisLock = new RedisSemaphore(client, key, limit);
    super(redisLock, options);
  }
}

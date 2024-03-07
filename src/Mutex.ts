import { Redis } from 'ioredis';
import { LockManager } from './Lock.js';
import type { LockOptions } from './types.js';
import { RedisMutex } from './redis-client/mutex.js';

export class Mutex extends LockManager {
  constructor(client: Redis, key: string, options?: LockOptions) {
    const redisLock = new RedisMutex(client, key);
    super(redisLock, options);
  }
}

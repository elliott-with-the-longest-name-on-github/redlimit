import { Redis } from 'ioredis';
import createDebug from 'debug';
import { CLIENT_METHOD_PREFIX, sleep } from '../utils/index.js';
import {
  RedisLock,
  type AcquireArgs,
  type RefreshArgs,
  type ReleaseArgs,
} from './lock.js';
import { LostLockError } from '../errors/LostLockError.js';
import { TimeoutError } from '../errors/TimeoutError.js';

const debug = createDebug('redlimit:redis-client:semaphore');

const refreshMethodName = `${CLIENT_METHOD_PREFIX}_semaphore_refresh`;
const refreshLua = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local identifier = ARGV[2]
local lockTimeout = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local expiredTimestamp = now - lockTimeout

redis.call('zremrangebyscore', key, '-inf', expiredTimestamp)

if redis.call('zscore', key, identifier) then
  redis.call('zadd', key, now, identifier)
  redis.call('pexpire', key, lockTimeout)
  return 1
else
  return 0
end
`;

const acquireMethodName = `${CLIENT_METHOD_PREFIX}_semaphore_acquire`;
const acquireLua = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local identifier = ARGV[2]
local lockTimeout = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local expiredTimestamp = now - lockTimeout

redis.call('zremrangebyscore', key, '-inf', expiredTimestamp)

if redis.call('zcard', key) < limit then
  redis.call('zadd', key, now, identifier)
  redis.call('pexpire', key, lockTimeout)
  return 1
else
  return 0
end
`;

export class RedisSemaphore extends RedisLock {
  protected _type = 'semaphore';
  private _limit: number;

  constructor(client: Redis, key: string, limit: number) {
    RedisSemaphore.augment(client);
    super(client, 'semaphore', key);
    this._limit = limit;
  }

  async acquire({
    instanceIdentifier,
    lockTimeout,
    retryInterval,
    acquireTimeout,
    acquireAttemptsLimit,
  }: AcquireArgs): Promise<void> {
    let attempt = 0;
    const end = Date.now() + acquireTimeout;
    let now;
    while ((now = Date.now()) < end && ++attempt <= acquireAttemptsLimit) {
      debug(
        'acquire',
        this._key,
        instanceIdentifier,
        this._limit,
        lockTimeout,
        'attempt',
        attempt
      );
      // @ts-expect-error - This method has been defined by `augment`
      const result = await this._client[acquireMethodName](
        this._key,
        this._limit,
        instanceIdentifier,
        lockTimeout,
        now
      );
      debug('acquire', this._key, 'result', typeof result, result);
      if (+result === 1) {
        debug('acquire', this._key, instanceIdentifier, 'acquired');
        return;
      } else {
        await sleep(retryInterval);
      }
    }
    debug(
      'acquire',
      this._key,
      instanceIdentifier,
      this._limit,
      lockTimeout,
      'timeout or reach limit'
    );
    throw new TimeoutError(this._type, this._key, instanceIdentifier);
  }

  async refresh({
    instanceIdentifier,
    lockTimeout,
  }: RefreshArgs): Promise<void> {
    const now = Date.now();
    debug('refresh', this._key, instanceIdentifier, now);
    // @ts-expect-error - This method has been defined by `augment`
    const result = await this._client[refreshMethodName](
      this._key,
      this._limit,
      instanceIdentifier,
      lockTimeout,
      now
    );
    debug('refresh', 'result', typeof result, result);
    if (+result !== 1) {
      throw new LostLockError(this._type, this._key, instanceIdentifier);
    }
  }

  async release({ instanceIdentifier }: ReleaseArgs): Promise<void> {
    debug('refresh', this._key, instanceIdentifier);
    const result = await this._client.zrem(this._key, instanceIdentifier);
    debug('refresh', 'result', typeof result, result);
  }

  private static augment(client: Redis): void {
    // @ts-expect-error - this is very dynamic programming
    if (!client[refreshMethodName]) {
      debug(`Augmenting client with ${refreshMethodName}`);
      client.defineCommand(refreshMethodName, {
        lua: refreshLua,
        numberOfKeys: 1,
      });
    }
    // @ts-expect-error - this is very dynamic programming
    if (!client[acquireMethodName]) {
      debug(`Augmenting client with ${acquireMethodName}`);
      client.defineCommand(acquireMethodName, {
        lua: acquireLua,
        numberOfKeys: 1,
      });
    }
  }
}

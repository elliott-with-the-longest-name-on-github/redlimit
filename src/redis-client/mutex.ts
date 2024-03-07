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

const debug = createDebug('redlimit:redis-client:mutex');

const refreshMethodName = `${CLIENT_METHOD_PREFIX}_mutex_release`;
const refreshLua = `
local key = KEYS[1]
local identifier = ARGV[1]
local lockTimeout = ARGV[2]

local value = redis.call('get', key)

if value == identifier then
  redis.call('pexpire', key, lockTimeout)
  return 1
end

return 0
`;

const releaseMethodName = `${CLIENT_METHOD_PREFIX}_mutex_refresh`;
const releaseLua = `
local key = KEYS[1]
local identifier = ARGV[1]

if redis.call('get', key) == identifier then
  return redis.call('del', key)
end

return 0
`;

export class RedisMutex extends RedisLock {
  protected _type = 'mutex';

  constructor(client: Redis, key: string) {
    RedisMutex.augment(client);
    super(client, 'mutex', key);
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
    while (Date.now() < end && ++attempt <= acquireAttemptsLimit) {
      debug('acquire', this._key, instanceIdentifier, 'attempt', attempt);
      const result = await this._client.set(
        this._key,
        instanceIdentifier,
        'PX',
        lockTimeout,
        'NX'
      );
      debug('acquire', 'result', typeof result, result);
      if (result === 'OK') {
        debug('acquire', this._key, instanceIdentifier, 'acquired');
        return;
      } else {
        await sleep(retryInterval);
      }
    }
    debug('acquire', this._key, instanceIdentifier, 'timeout or reach limit');
    throw new TimeoutError(this._type, this._key, instanceIdentifier);
  }

  async refresh({
    instanceIdentifier,
    lockTimeout,
  }: RefreshArgs): Promise<void> {
    debug('refresh', this._key, instanceIdentifier);
    // @ts-expect-error - This method has been defined by `augment`
    const result = await this._client[refreshMethodName](
      this._key,
      instanceIdentifier,
      lockTimeout
    );
    debug('refresh', 'result', typeof result, result);
    if (+result !== 1) {
      throw new LostLockError(this._type, this._key, instanceIdentifier);
    }
  }

  async release({ instanceIdentifier }: ReleaseArgs): Promise<void> {
    debug('release', this._key, instanceIdentifier);
    // @ts-expect-error - This method has been defined by `augment`
    const result = await this._client[releaseMethodName](
      this._key,
      instanceIdentifier
    );
    debug('release', 'result', typeof result, result);
  }

  private static augment(client: Redis) {
    // @ts-expect-error - this is very dynamic programming
    if (!client[refreshMethodName]) {
      debug(`Augmenting client with ${refreshMethodName}`);
      client.defineCommand(refreshMethodName, {
        lua: refreshLua,
        numberOfKeys: 1,
      });
    }
    // @ts-expect-error - this is very dynamic programming
    if (!client[releaseMethodName]) {
      debug(`Augmenting client with ${releaseMethodName}`);
      client.defineCommand(releaseMethodName, {
        lua: releaseLua,
        numberOfKeys: 1,
      });
    }
  }
}

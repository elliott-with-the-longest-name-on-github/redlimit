import { Redis } from 'ioredis';

export abstract class RedisLock {
  protected _key: string;
  protected _client: Redis;
  protected abstract _type: string;

  constructor(client: Redis, keyPrefix: string, key: string) {
    this._client = client;
    this._key = `redlimit:${keyPrefix}:${key}`;
  }

  get key(): string {
    return this._key;
  }

  get type(): string {
    return this._type;
  }

  public abstract acquire(args: AcquireArgs): Promise<void>;
  public abstract refresh(args: RefreshArgs): Promise<void>;
  public abstract release(args: ReleaseArgs): Promise<void>;
}

export interface AcquireArgs {
  instanceIdentifier: string;
  lockTimeout: number;
  acquireTimeout: number;
  acquireAttemptsLimit: number;
  retryInterval: number;
}

export interface RefreshArgs {
  instanceIdentifier: string;
  lockTimeout: number;
}

export interface ReleaseArgs {
  instanceIdentifier: string;
}

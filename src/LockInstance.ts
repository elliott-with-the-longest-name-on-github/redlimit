import { randomUUID } from 'crypto';
import type { RedisLock } from './redis-client/lock.js';
import { InternalError } from './errors/InternalError.js';
import { AbortError } from './errors/AbortError.js';
import { LostLockError } from './errors/LostLockError.js';
import type { LockOptions } from './types.js';

const LOCK_INSTANCE_SYMBOL = Symbol('LockInstance');

type TimeoutValue = {
  brand: typeof LOCK_INSTANCE_SYMBOL;
  error: Error;
};

export class LockInstance {
  private _identifier: string;
  private _redisLock: RedisLock;
  private _options: Readonly<Required<LockOptions>>;
  private _state: 'initialized' | 'running' | 'consumed' = 'initialized';
  private _refreshing = false;

  private _timeoutInterval: NodeJS.Timeout | undefined;
  private _currentRefreshOp: Promise<void> = Promise.resolve();
  private _timeout: Promise<{
    brand: typeof LOCK_INSTANCE_SYMBOL;
    error: Error;
  }>;
  // @ts-expect-error - This is definitely assigned in the constructor, it just doesn't know it
  private _resolveTimeout: (error: Error) => void;
  private _abortController = new AbortController();

  constructor(redisLock: RedisLock, options: Required<LockOptions>) {
    this._identifier = randomUUID();
    this._redisLock = redisLock;
    this._options = options;

    this._timeout = new Promise((resolve) => {
      this._resolveTimeout = (error: Error) => {
        this._abortController.abort(error);
        resolve({ brand: LOCK_INSTANCE_SYMBOL, error });
      };
    });
    this.abort.bind(this);
  }

  async invoke<TReturn>(
    fn: (signal: AbortSignal) => TReturn
  ): Promise<TReturn> {
    if (this._state !== 'initialized') {
      throw new InternalError(
        'Attempted to run a function using an already-used LockInstance.'
      );
    }

    this._state = 'running';

    await this._redisLock.acquire({
      instanceIdentifier: this._identifier,
      lockTimeout: this._options.lockTimeout,
      acquireTimeout: this._options.acquireTimeout,
      acquireAttemptsLimit: this._options.acquireAttemptsLimit,
      retryInterval: this._options.retryInterval,
    });

    this._startRefresh();

    try {
      const result = await Promise.race([
        fn(this._abortController.signal),
        this._timeout,
      ]);

      if (LockInstance.isTimeoutValue(result)) {
        throw result.error;
      }

      return result;
    } finally {
      await this._stopRefresh();
      await this._redisLock.release({
        instanceIdentifier: this._identifier,
      });
      this._state = 'consumed';
    }
  }

  abort(): void {
    this._state = 'consumed';
    this._resolveTimeout(new AbortError());
  }

  private _startRefresh(): void {
    if (this._options.refreshInterval <= 0) {
      // if we're not refreshing, schedule this to expire when the lock will expire
      this._timeoutInterval = setTimeout(
        () =>
          this._resolveTimeout.bind(this)(
            new LostLockError(
              this._redisLock.type,
              this._redisLock.key,
              this._identifier
            )
          ),
        this._options.lockTimeout
      );
      this._timeoutInterval.unref();
      return;
    }
    this._timeoutInterval = setInterval(
      this._processRefresh.bind(this),
      this._options.refreshInterval
    );
    this._timeoutInterval.unref();
  }

  private async _stopRefresh(): Promise<void> {
    clearInterval(this._timeoutInterval);
    await this._currentRefreshOp;
  }

  /**
   * Since it's run inside a timeout, this function _cannot_ throw under any circumstances or it'll crash the entire Node
   * process. Instead, it should call {@link _resolveTimeout} with an error if something fails.
   */
  private async _processRefresh(): Promise<void> {
    if (this._refreshing) {
      return;
    }
    this._refreshing = true;
    try {
      // we save a reference to this promise so that we can make sure it's done
      // before releasing the lock at the end of our function execution.
      this._currentRefreshOp = this._redisLock.refresh({
        instanceIdentifier: this._identifier,
        lockTimeout: this._options.lockTimeout,
      });
      await this._currentRefreshOp;
    } catch (e) {
      this._resolveTimeout(e as Error);
    } finally {
      this._refreshing = false;
    }
  }

  private static isTimeoutValue(val: unknown): val is TimeoutValue {
    return (
      typeof val === 'object' &&
      val !== null &&
      'brand' in val &&
      val.brand === LOCK_INSTANCE_SYMBOL &&
      'error' in val &&
      val.error instanceof Error
    );
  }
}

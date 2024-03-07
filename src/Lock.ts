import { LockInstance } from './LockInstance.js';
import { RedisLock } from './redis-client/lock.js';
import type { LockOptions } from './types.js';

const defaultTimeoutOptions = {
  lockTimeout: 10000,
  refreshInterval: 0,
  acquireTimeout: 10000,
  acquireAttemptsLimit: Number.POSITIVE_INFINITY,
  retryInterval: 100,
} as const satisfies Required<LockOptions>;

export abstract class LockManager {
  protected _options: Readonly<Required<LockOptions>>;
  protected _redisLock: RedisLock;

  constructor(redisLock: RedisLock, options: LockOptions = {}) {
    this._options = {
      ...defaultTimeoutOptions,
      ...options,
    };
    this._redisLock = redisLock;
  }

  /**
   * Creates a protected function by wrapping every call to {@link fn} in a new lock instance.
   * The first argument to {@link fn} must be an {@link AbortSignal}. If your function performs an
   * abortable operation (such as a call made with `fetch`), it should pass this signal down or otherwise
   * listen to it. The signal will be aborted if any lock-related activities fail, helping you prevent
   * unlocked access to critical resources.
   *
   * @param fn - The function to protect. The first argument must be an {@link AbortSignal}.
   * @param options - Override options for the lock instances associated with this protected function only.
   * @returns A version of this function that will always be protected by this lock when executed.
   */
  protect<TArgs extends never[], TReturn>(
    fn: (signal: AbortSignal, ...args: TArgs) => TReturn,
    options?: LockOptions
  ): (...args: TArgs) => Promise<TReturn> {
    return async (...args) => {
      return await this.invoke((signal) => fn(signal, ...args), options);
    };
  }

  /**
   * Invoke a function in a protected context. You can think about this as being similar to:
   *
   * ```ts
   * const lock = new LockInstance();
   * try {
   *   await lock.acquire();
   *   return await fn();
   * } finally {
   *   await lock.release();
   * }
   * ```
   *
   * @param fn - The function to invoke.
   * @param options - Override options for this lock instance only.
   * @returns The result of calling {@link fn}
   */
  async invoke<TReturn>(
    fn: (signal: AbortSignal) => TReturn,
    options?: LockOptions
  ): Promise<TReturn> {
    const instance = new LockInstance(this._redisLock, {
      ...this._options,
      ...options,
    });
    return await instance.invoke(fn);
  }

  /**
   * Obtain a single-use lock instance. Only use this if you need to have the ability to abort an execution early. In most cases,
   * you should use your lock's settings (`lockTimeout` and `acquireTimeout`) instead.
   *
   * @example
   * ```ts
   * const instance = lock.getInstance();
   * const timeout = setTimeout(instance.abort, 1_000);
   * try {
   *   instance.invoke((signal) => myFunction(signal));
   * } catch (e) {
   *   if (e instanceof AbortError) {
   *     // aborted early
   *   }
   * } finally {
   *   clearTimeout(timeout);
   * }
   * ```
   *
   * @param options - Override options for this lock instance only.
   * @returns A new lock instance.
   */
  getInstance(options?: LockOptions): LockInstance {
    return new LockInstance(this._redisLock, {
      ...this._options,
      ...options,
    });
  }
}

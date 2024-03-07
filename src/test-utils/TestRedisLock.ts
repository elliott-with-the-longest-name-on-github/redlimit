import { vitest, type MockedFunction } from 'vitest';
import {
  RedisLock,
  type AcquireArgs,
  type RefreshArgs,
  type ReleaseArgs,
} from '../redis-client/lock.js';

export const mockAcquire: MockedFunction<(args: AcquireArgs) => Promise<void>> =
  vitest.fn().mockResolvedValue(undefined);
export const mockRefresh: MockedFunction<(args: RefreshArgs) => Promise<void>> =
  vitest.fn().mockResolvedValue(undefined);
export const mockRelease: MockedFunction<(args: ReleaseArgs) => Promise<void>> =
  vitest.fn().mockResolvedValue(undefined);

export const TestRedisLock: new () => RedisLock = vitest
  .fn()
  .mockImplementation(() => {
    return {
      acquire: mockAcquire,
      refresh: mockRefresh,
      release: mockRelease,
    };
  });

import { it, expect } from 'vitest';
import {
  Mutex,
  Semaphore,
  AbortError,
  LostLockError,
  TimeoutError,
} from './index.js';

it('should export the public API', () => {
  expect(Mutex).toBeDefined();
  expect(Semaphore).toBeDefined();
  expect(AbortError).toBeDefined();
  expect(LostLockError).toBeDefined();
  expect(TimeoutError).toBeDefined();
});

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { resetAuthForTests } from '../src/auth/store';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  resetAuthForTests();
});

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { resetAuthForTests } from '../src/auth/store';
import { resetOfflineForTests } from '../src/lib/offline';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  resetAuthForTests();
  resetOfflineForTests();
});

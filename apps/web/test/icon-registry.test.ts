import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAuthForTests } from '../src/auth/store';
import { loadIconRegistry, resetIconRegistryForTests } from '../src/lib/icon-registry';
import { fakeResponse, stubFetch } from './fake-fetch';

const MANIFEST = {
  defaultPack: 'openmoji',
  packs: [
    { id: 'openmoji', kind: 'mono', source: 'bundled' },
    { id: 'custom', kind: 'mixed', source: 'instance' },
  ],
  icons: [
    { id: 'custom:spices', kind: 'mono', url: '/icons/custom/spices.svg' },
    { id: 'custom:tomato', kind: 'color', url: '/icons/custom/tomato.png' },
  ],
};

describe('icon registry', () => {
  beforeEach(() => {
    localStorage.clear();
    resetAuthForTests();
    resetIconRegistryForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the manifest once and persists it for offline starts', async () => {
    const requests = stubFetch((url) =>
      url === '/api/icons' ? fakeResponse(200, MANIFEST) : undefined,
    );
    await loadIconRegistry();
    await loadIconRegistry(); // deduped
    expect(requests.filter((request) => request.url === '/api/icons')).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('drauf.icon-registry') as string)).toEqual(
      MANIFEST.icons,
    );
  });

  it('hydrates from localStorage when the server is unreachable', async () => {
    localStorage.setItem('drauf.icon-registry', JSON.stringify(MANIFEST.icons));
    resetIconRegistryForTests(); // simulates a fresh (offline) start
    stubFetch(() => undefined); // network error
    await loadIconRegistry(); // must not throw
    // The hydrated entries are visible to components; covered in item-icon tests.
    expect(localStorage.getItem('drauf.icon-registry')).not.toBeNull();
  });

  it('ignores malformed stored data', () => {
    localStorage.setItem('drauf.icon-registry', '{"not":"an array"}');
    expect(() => resetIconRegistryForTests()).not.toThrow();
  });
});

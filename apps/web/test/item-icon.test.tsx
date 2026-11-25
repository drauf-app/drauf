import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ItemIcon } from '../src/components/ItemIcon';
import { loadIconRegistry, resetIconRegistryForTests } from '../src/lib/icon-registry';
import { fakeResponse, stubFetch } from './fake-fetch';

describe('ItemIcon', () => {
  it('renders bundled icons as a masked span carrying the asset url', () => {
    const { container } = render(<ItemIcon icon="🥛" />);
    const icon = container.querySelector('.openmoji') as HTMLElement;
    expect(icon).not.toBeNull();
    expect(icon.tagName).toBe('SPAN');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.style.getPropertyValue('--openmoji-url')).toBe('url(/openmoji/1F95B.svg)');
  });

  it('falls back to the platform glyph for emoji without a bundled asset', () => {
    const { container } = render(<ItemIcon icon="🤷" />);
    expect(container.querySelector('.openmoji')).toBeNull();
    expect(container.textContent).toBe('🤷');
  });

  it('renders namespaced openmoji ids as the same masked span (#71)', () => {
    const { container } = render(<ItemIcon icon="openmoji:1F95B" />);
    const icon = container.querySelector('.openmoji') as HTMLElement;
    expect(icon).not.toBeNull();
    expect(icon.style.getPropertyValue('--openmoji-url')).toBe('url(/openmoji/1F95B.svg)');
  });

  it('degrades unknown namespaced ids to the emoji glyph or nothing (#71)', () => {
    // Hex-shaped key of an unbundled emoji: platform glyph.
    const shrug = render(<ItemIcon icon="openmoji:1F937" />);
    expect(shrug.container.querySelector('.openmoji')).toBeNull();
    expect(shrug.container.textContent).toBe('🤷');
    // Unknown pack with a non-hex key: decorative icon disappears entirely.
    const custom = render(<ItemIcon icon="custom:tomato" />);
    expect(custom.container.querySelector('.openmoji')).toBeNull();
    expect(custom.container.textContent).toBe('');
  });

  describe('with instance icons loaded (#71)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      resetIconRegistryForTests();
      localStorage.clear();
    });

    async function loadRegistry() {
      stubFetch((url) =>
        url === '/api/icons'
          ? fakeResponse(200, {
              defaultPack: 'openmoji',
              packs: [],
              icons: [
                { id: 'custom:spices', kind: 'mono', url: '/icons/custom/spices.svg' },
                { id: 'custom:tomato', kind: 'color', url: '/icons/custom/tomato.png' },
              ],
            })
          : undefined,
      );
      await loadIconRegistry();
    }

    it('renders mono instance icons through the themable mask', async () => {
      await loadRegistry();
      const { container } = render(<ItemIcon icon="custom:spices" />);
      const icon = container.querySelector('.openmoji') as HTMLElement;
      expect(icon).not.toBeNull();
      expect(icon.style.getPropertyValue('--openmoji-url')).toBe('url(/icons/custom/spices.svg)');
    });

    it('renders colored instance icons as plain images', async () => {
      await loadRegistry();
      const { container } = render(<ItemIcon icon="custom:tomato" />);
      const img = container.querySelector('img.icon-img') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.getAttribute('src')).toBe('/icons/custom/tomato.png');
      expect(img.getAttribute('alt')).toBe('');
      expect(img.getAttribute('aria-hidden')).toBe('true');
    });
  });
});

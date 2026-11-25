import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ItemIcon } from '../src/components/ItemIcon';

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
});

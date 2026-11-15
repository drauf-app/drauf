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
});

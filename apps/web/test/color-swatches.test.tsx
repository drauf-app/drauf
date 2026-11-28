import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ColorSwatches, LIST_COLORS } from '../src/components/ColorSwatches';

describe('ColorSwatches', () => {
  it('labels the row, rings the active dot in its own colour, reports picks', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <ColorSwatches value={LIST_COLORS[0] ?? ''} onChange={onChange} />,
    );

    expect(screen.getByText('Farbe')).toBeTruthy();
    const active = container.querySelector('.color-swatch.active') as HTMLElement;
    expect(active).toBeTruthy();
    expect(active.style.getPropertyValue('--swatch-color')).toBe(LIST_COLORS[0]);

    await userEvent.setup().click(screen.getByLabelText('Keine Farbe'));
    expect(onChange).toHaveBeenCalledWith('');
  });
});

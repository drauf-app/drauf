import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IconPicker } from '../src/components/IconPicker';
import { loadIconRegistry, resetIconRegistryForTests } from '../src/lib/icon-registry';
import { fakeResponse, stubFetch } from './fake-fetch';

describe('IconPicker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetIconRegistryForTests();
    localStorage.clear();
  });

  function renderPicker(onChange: (icon: string) => void) {
    return render(
      <IconPicker value="" clearLabel="Automatisch" pickLabel="Icon wählen" onChange={onChange} />,
    );
  }

  it('shows no custom section without instance icons', () => {
    renderPicker(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Icon wählen' }));
    expect(screen.queryByText('Eigene Icons')).toBeNull();
  });

  it('offers instance icons in their own section and emits the icon id (#71)', async () => {
    stubFetch((url) =>
      url === '/api/icons'
        ? fakeResponse(200, {
            defaultPack: 'openmoji',
            packs: [],
            icons: [{ id: 'custom:tomato', kind: 'color', url: '/icons/custom/tomato.png' }],
          })
        : undefined,
    );
    await loadIconRegistry();

    const picked: string[] = [];
    renderPicker((icon) => picked.push(icon));
    fireEvent.click(screen.getByRole('button', { name: 'Icon wählen' }));
    expect(screen.getByText('Eigene Icons')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'custom:tomato' }));
    expect(picked).toEqual(['custom:tomato']);
  });
});

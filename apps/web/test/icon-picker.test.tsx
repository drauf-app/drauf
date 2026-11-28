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

  it('filters bundled icons by German catalogue keywords (#85)', () => {
    renderPicker(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Icon wählen' }));
    expect(screen.getByRole('button', { name: '🍌' })).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Icon suchen …'), { target: { value: 'Tomate' } });
    expect(screen.getByRole('button', { name: '🍅' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: '🍌' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Icon suchen …'), { target: { value: 'xyzzy' } });
    expect(screen.getByText('Nichts gefunden.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: '🍅' })).toBeNull();
  });

  it('filters instance icons by their key (#85)', async () => {
    stubFetch((url) =>
      url === '/api/icons'
        ? fakeResponse(200, {
            defaultPack: 'openmoji',
            packs: [],
            icons: [
              { id: 'custom:tomato', kind: 'color', url: '/icons/custom/tomato.png' },
              { id: 'custom:glas', kind: 'mono', url: '/icons/custom/glas.svg' },
            ],
          })
        : undefined,
    );
    await loadIconRegistry();

    renderPicker(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Icon wählen' }));
    fireEvent.change(screen.getByLabelText('Icon suchen …'), { target: { value: 'glas' } });

    expect(screen.getByText('Eigene Icons')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'custom:glas' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'custom:tomato' })).toBeNull();
  });
});

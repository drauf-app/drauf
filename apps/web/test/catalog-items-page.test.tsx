import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { AdminCatalogItem } from '../src/api/catalog-admin';
import { CatalogItemsPage } from '../src/pages/CatalogItemsPage';
import { fakeResponse, type RecordedRequest, stubFetch } from './fake-fetch';

const CATEGORIES = [
  {
    id: 'c1',
    householdId: 'h1',
    key: 'fruit-vegetables',
    name: 'Obst & Gemüse',
    icon: null,
    sortOrder: 10,
    createdAt: '',
  },
];

const TOMATEN: AdminCatalogItem = {
  name: 'Tomaten',
  nameNormalized: 'tomaten',
  count: 2,
  categoryId: 'c1',
  icon: null,
  variants: ['passiert'],
  custom: true,
  updatedAt: '2026-11-26T10:00:00Z',
};

const TOMTAEN: AdminCatalogItem = {
  name: 'Tomtaen',
  nameNormalized: 'tomtaen',
  count: 1,
  categoryId: null,
  icon: null,
  variants: [],
  custom: true,
  updatedAt: '2026-11-25T10:00:00Z',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/settings/items']}>
      <CatalogItemsPage />
    </MemoryRouter>,
  );
}

describe('CatalogItemsPage', () => {
  it('lists learned items with badge, usage meta and category', async () => {
    stubFetch((url) => {
      if (url === '/api/categories') return fakeResponse(200, CATEGORIES);
      if (url.startsWith('/api/catalog/items'))
        return fakeResponse(200, { items: [TOMATEN, TOMTAEN], total: 2 });
      return undefined;
    });
    renderPage();

    expect(await screen.findByText('Tomaten')).toBeTruthy();
    expect(screen.getAllByText('eigener Artikel')).toHaveLength(2);
    expect(screen.getByText(/2× verwendet/)).toBeTruthy();
    expect(screen.getByText(/passiert/)).toBeTruthy();
    const select = screen.getByLabelText('Kategorie: Tomaten') as HTMLSelectElement;
    expect(select.value).toBe('c1');
  });

  it('renames via the edit form and reloads the merged list', async () => {
    let merged = false;
    let requests: RecordedRequest[] = [];
    requests = stubFetch((url, init) => {
      if (url === '/api/categories') return fakeResponse(200, CATEGORIES);
      if (url === '/api/catalog/items/tomtaen' && init?.method === 'PATCH') {
        merged = true;
        return fakeResponse(200, { ...TOMATEN, count: 3 });
      }
      if (url.startsWith('/api/catalog/items'))
        return fakeResponse(
          200,
          merged
            ? { items: [{ ...TOMATEN, count: 3 }], total: 1 }
            : { items: [TOMATEN, TOMTAEN], total: 2 },
        );
      return undefined;
    });
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Bearbeiten: Tomtaen'));
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Tomaten');
    await user.click(screen.getByText('Speichern'));

    await waitFor(() => expect(screen.queryByText('Tomtaen')).toBeNull());
    expect(screen.getByText(/3× verwendet/)).toBeTruthy();
    const patch = requests.find((request) => request.init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ name: 'Tomaten' });
  });

  it('deletes an item after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    stubFetch((url, init) => {
      if (url === '/api/categories') return fakeResponse(200, CATEGORIES);
      if (url === '/api/catalog/items/tomtaen' && init?.method === 'DELETE')
        return fakeResponse(204, undefined);
      if (url.startsWith('/api/catalog/items'))
        return fakeResponse(200, { items: [TOMATEN, TOMTAEN], total: 2 });
      return undefined;
    });
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Entfernen: Tomtaen'));

    await waitFor(() => expect(screen.queryByText('Tomtaen')).toBeNull());
    expect(screen.getByText('Tomaten')).toBeTruthy();
    confirm.mockRestore();
  });
});

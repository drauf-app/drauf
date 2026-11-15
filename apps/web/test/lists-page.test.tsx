import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { List } from '../src/api/types';
import { ListsPage } from '../src/pages/ListsPage';
import { fakeResponse, stubFetch } from './fake-fetch';

function list(id: string, name: string, archived = false): List {
  return {
    id,
    name,
    icon: null,
    color: null,
    archived,
    ownerId: 'u1',
    defaultStoreId: null,
    createdAt: '2026-11-12T00:00:00.000Z',
  };
}

describe('ListsPage', () => {
  it('shows active lists with their item summary and tucks archived ones away', async () => {
    stubFetch((url, init) =>
      url === '/api/lists' && (init?.method ?? 'GET') === 'GET'
        ? fakeResponse(200, [
            { ...list('l1', 'Wocheneinkauf'), openCount: 3, previewIcons: ['🍝', '🥛'] },
            list('l2', 'Geschenke', true),
          ])
        : undefined,
    );
    render(
      <MemoryRouter>
        <ListsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Wocheneinkauf')).toBeDefined();
    expect(screen.getByText('3 Artikel')).toBeDefined();
    expect(document.querySelectorAll('.list-preview .openmoji')).toHaveLength(2);
    // Lists without the summary (e.g. fresh ones) read as empty.
    expect(screen.getByText('Leer')).toBeDefined();
    expect(screen.getByText('Archivierte Listen')).toBeDefined();
  });

  it('creates a list and shows it', async () => {
    const posted: string[] = [];
    stubFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/lists' && method === 'GET') {
        return fakeResponse(200, []);
      }
      if (url === '/api/lists' && method === 'POST') {
        posted.push(String(init?.body));
        return fakeResponse(201, list('l9', 'Drogerie'));
      }
      return undefined;
    });
    render(
      <MemoryRouter>
        <ListsPage />
      </MemoryRouter>,
    );
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name der neuen Liste'), 'Drogerie');
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));

    expect(await screen.findByText('Drogerie')).toBeDefined();
    expect(JSON.parse(posted[0] ?? '{}')).toEqual({ name: 'Drogerie' });
  });
});

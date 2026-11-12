import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Category, EntryView, ListDetail, Suggestion } from '../src/api/types';
import { pendingOps } from '../src/lib/offline';
import { ListPage } from '../src/pages/ListPage';
import { fakeResponse, type RecordedRequest, stubFetch } from './fake-fetch';

const LIST: ListDetail = {
  id: 'l1',
  name: 'Wocheneinkauf',
  icon: null,
  color: null,
  archived: false,
  ownerId: 'u1',
  defaultStoreId: null,
  createdAt: '2026-11-12T00:00:00.000Z',
  members: [],
};

const CATEGORIES: Category[] = [
  {
    id: 'c1',
    householdId: 'h1',
    key: 'fruit-vegetables',
    name: 'Obst & Gemüse',
    sortOrder: 0,
    createdAt: '2026-11-12T00:00:00.000Z',
  },
  {
    id: 'c6',
    householdId: 'h1',
    key: 'pasta-rice-canned',
    name: 'Nudeln, Reis & Konserven',
    sortOrder: 5,
    createdAt: '2026-11-12T00:00:00.000Z',
  },
];

function entryView(overrides: Partial<EntryView>): EntryView {
  return {
    id: 'e1',
    listId: 'l1',
    name: 'Milch',
    nameNormalized: 'milch',
    variant: null,
    note: null,
    categoryId: 'c1',
    fieldTimes: null,
    checkedAt: null,
    checkedById: null,
    createdAt: '2026-11-12T00:00:00.000Z',
    quantities: [],
    portions: [],
    icon: null,
    ...overrides,
  };
}

const SUGGESTION: Suggestion = {
  name: 'Nudeln',
  source: 'history',
  icon: '🍝',
  categoryId: 'c6',
  sizes: ['500 g'],
  varieties: ['Spaghetti'],
  lastQuantity: 500,
  lastUnit: 'g',
  lastVariant: null,
};

interface StubOptions {
  entries?: EntryView[];
  onEntryPost?: (body: string) => EntryView;
  onEntryPatch?: (url: string, body: string) => EntryView;
  onCheck?: (url: string) => EntryView;
}

function stubListApi(options: StubOptions = {}): RecordedRequest[] {
  return stubFetch((url, init) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/lists/l1' && method === 'GET') {
      return fakeResponse(200, LIST);
    }
    if (url === '/api/lists/l1/entries' && method === 'GET') {
      return fakeResponse(200, options.entries ?? [entryView({})]);
    }
    if (url === '/api/categories' && method === 'GET') {
      return fakeResponse(200, CATEGORIES);
    }
    if (url === '/api/stores' && method === 'GET') {
      return fakeResponse(200, []);
    }
    if (url.startsWith('/api/catalog/suggest?') && method === 'GET') {
      return fakeResponse(200, [SUGGESTION]);
    }
    // Mutations without a configured handler fail like a network error.
    if (url === '/api/lists/l1/entries' && method === 'POST') {
      const view = options.onEntryPost?.(String(init?.body));
      return view === undefined ? undefined : fakeResponse(201, view);
    }
    if (url.endsWith('/check') && method === 'POST') {
      const view = options.onCheck?.(url);
      return view === undefined ? undefined : fakeResponse(200, view);
    }
    if (url.startsWith('/api/lists/l1/entries/') && method === 'PATCH') {
      const view = options.onEntryPatch?.(url, String(init?.body));
      return view === undefined ? undefined : fakeResponse(200, view);
    }
    return undefined;
  });
}

function renderListPage() {
  return render(
    <MemoryRouter initialEntries={['/lists/l1']}>
      <Routes>
        <Route path="/lists/:id" element={<ListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ListPage', () => {
  it('renders entries grouped under their category', async () => {
    stubListApi();
    renderListPage();

    expect(await screen.findByText('Milch')).toBeDefined();
    expect(screen.getByText('Obst & Gemüse')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Wocheneinkauf' })).toBeDefined();
  });

  it('adds a tapped suggestion bare and adjusts it via drawer chips', async () => {
    const posted: string[] = [];
    const patched: string[] = [];
    let current = entryView({
      id: 'e2',
      name: 'Nudeln',
      nameNormalized: 'nudeln',
      categoryId: 'c6',
    });
    stubListApi({
      onEntryPost: (body) => {
        posted.push(body);
        return current;
      },
      onEntryPatch: (_url, body) => {
        patched.push(body);
        const fields = JSON.parse(body) as { quantity?: number; unit?: string };
        current = {
          ...current,
          quantities:
            fields.quantity === undefined
              ? []
              : [{ unit: fields.unit ?? null, quantity: fields.quantity }],
        };
        return current;
      },
    });
    renderListPage();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Was brauchst du?'), 'nud');
    await user.click(await screen.findByRole('button', { name: /Nudeln/ }));

    // Added immediately and bare: no amount, no variety.
    expect(posted).toHaveLength(1);
    expect(JSON.parse(posted[0] ?? '{}')).toEqual({ name: 'Nudeln', categoryId: 'c6' });

    // The drawer shows the details view with the last-used size highlighted.
    expect(await screen.findByLabelText('Nächster Artikel …')).toBeDefined();
    const sizeChip = await screen.findByRole('button', { name: '500 g' });
    expect(sizeChip.className).toContain('highlighted');

    await user.click(sizeChip);
    expect(JSON.parse(patched[0] ?? '{}')).toEqual({ quantity: 500, unit: 'g' });

    // The chip is now active; tapping it again clears the amount.
    const activeChip = await screen.findByRole('button', { name: '500 g' });
    expect(activeChip.className).toContain('active');
    await user.click(activeChip);
    expect(JSON.parse(patched[1] ?? '{}')).toEqual({ unit: '' });

    // Typing the next article returns to suggestions.
    await user.type(screen.getByLabelText('Nächster Artikel …'), 'mi');
    expect(await screen.findByRole('button', { name: /Nudeln/ })).toBeDefined();
  });

  it('applies a custom variant through the + chip', async () => {
    const patched: string[] = [];
    stubListApi({
      onEntryPost: () =>
        entryView({ id: 'e5', name: 'Chips', nameNormalized: 'chips', categoryId: null }),
      onEntryPatch: (_url, body) => {
        patched.push(body);
        return entryView({
          id: 'e5',
          name: 'Chips',
          nameNormalized: 'chips',
          variant: 'Paprika',
        });
      },
    });
    renderListPage();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Was brauchst du?'), 'chips');
    await user.click(await screen.findByRole('button', { name: /Nudeln/ }));

    await user.click(await screen.findByRole('button', { name: 'Eigene Variante' }));
    await user.type(screen.getByLabelText('Eigene Variante'), 'Paprika');
    await user.click(screen.getByRole('button', { name: 'Variante übernehmen' }));

    expect(JSON.parse(patched[0] ?? '{}')).toEqual({ variant: 'Paprika' });
    expect(
      await screen.findByText('Paprika', { selector: '.entry-name .entry-variant' }),
    ).toBeDefined();
  });

  it('adds parsed free text on submit', async () => {
    const posted: string[] = [];
    stubListApi({
      onEntryPost: (body) => {
        posted.push(body);
        return entryView({ id: 'e3', name: 'Hack', nameNormalized: 'hack' });
      },
    });
    renderListPage();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Was brauchst du?'), '500 g Hack');
    await user.click(screen.getByRole('button', { name: 'Drauf!' }));

    expect(posted).toHaveLength(1);
    expect(JSON.parse(posted[0] ?? '{}')).toEqual({ name: 'Hack', quantity: 500, unit: 'g' });
  });

  it('keeps an offline add as a local placeholder and queues the operation', async () => {
    // No POST route: the request fails like a network error.
    stubListApi();
    renderListPage();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Was brauchst du?'), '2 Eier');
    await user.click(screen.getByRole('button', { name: 'Drauf!' }));

    expect(await screen.findByText('Eier', { selector: '.entry-name' })).toBeDefined();
    expect(pendingOps()).toHaveLength(1);
    expect(pendingOps()[0]).toMatchObject({
      type: 'entry.add',
      data: { listId: 'l1', name: 'Eier', quantity: 2 },
    });
  });

  it('moves a checked entry into the recent section', async () => {
    stubListApi({
      onCheck: () => entryView({ checkedAt: '2026-11-12T10:00:00.000Z', checkedById: 'u1' }),
    });
    renderListPage();
    const user = userEvent.setup();

    await screen.findByText('Milch');
    await user.click(screen.getByRole('button', { name: 'Abhaken' }));

    expect(await screen.findByText('Zuletzt gekauft')).toBeDefined();
    expect(screen.queryByText('Obst & Gemüse')).toBeNull();
  });
});

describe('entry editing', () => {
  it('saves only the changed fields and renders the updated entry', async () => {
    const patched: string[] = [];
    stubListApi({
      onEntryPatch: (_url, body) => {
        patched.push(body);
        return entryView({
          variant: 'Bio',
          categoryId: 'c6',
          quantities: [{ unit: 'g', quantity: 500 }],
        });
      },
    });
    renderListPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Bearbeiten: Milch' }));
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    expect(nameInput.value).toBe('Milch');

    await user.type(screen.getByLabelText('Menge'), '500');
    await user.type(screen.getByLabelText('Einheit'), 'g');
    await user.type(screen.getByLabelText('Variante'), 'Bio');
    await user.selectOptions(screen.getByLabelText('Kategorie'), 'c6');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(patched).toHaveLength(1);
    expect(JSON.parse(patched[0] ?? '{}')).toEqual({
      variant: 'Bio',
      categoryId: 'c6',
      quantity: 500,
      unit: 'g',
    });
    expect(await screen.findByText('Bio')).toBeDefined();
    expect(screen.getByText('500 g', { selector: '.entry-quantity' })).toBeDefined();
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('queues the edit as an offline operation when the server is unreachable', async () => {
    stubListApi(); // no PATCH handler: the request fails like a network error
    renderListPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Bearbeiten: Milch' }));
    await user.type(screen.getByLabelText('Variante'), 'Bio');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByText('Bio')).toBeDefined();
    expect(pendingOps()).toHaveLength(1);
    expect(pendingOps()[0]).toMatchObject({
      type: 'entry.setFields',
      data: { listId: 'l1', entryId: 'e1', fields: { variant: 'Bio' } },
    });
  });

  it('cancels without a request when nothing changed', async () => {
    const patched: string[] = [];
    stubListApi({
      onEntryPatch: (_url, body) => {
        patched.push(body);
        return entryView({});
      },
    });
    renderListPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Bearbeiten: Milch' }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(patched).toHaveLength(0);
    expect(screen.queryByLabelText('Name')).toBeNull();
  });
});

describe('tile view', () => {
  it('switches to tiles, persists the choice and checks off on tap', async () => {
    stubListApi({
      entries: [entryView({ icon: '🥛' })],
      onCheck: () => entryView({ icon: '🥛', checkedAt: '2026-11-12T10:00:00.000Z' }),
    });
    renderListPage();
    const user = userEvent.setup();

    await screen.findByText('Milch');
    await user.click(screen.getByRole('button', { name: 'Als Kacheln anzeigen' }));

    expect(localStorage.getItem('drauf.list-view')).toBe('tiles');
    expect(document.querySelector('.entries.tiles')).not.toBeNull();
    expect(screen.getByText('🥛')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Abhaken: Milch' }));
    expect(await screen.findByText('Zuletzt gekauft')).toBeDefined();
  });

  it('starts in tile view when previously chosen', async () => {
    localStorage.setItem('drauf.list-view', 'tiles');
    stubListApi();
    renderListPage();

    await screen.findByText('Milch');
    expect(document.querySelector('.entries.tiles')).not.toBeNull();
  });
});

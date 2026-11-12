import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Category, EntryView, ListDetail, Suggestion } from '../src/api/types';
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
    if (url === '/api/lists/l1/entries' && method === 'POST') {
      const view = options.onEntryPost?.(String(init?.body));
      return view === undefined ? fakeResponse(500, {}) : fakeResponse(201, view);
    }
    if (url.endsWith('/check') && method === 'POST') {
      const view = options.onCheck?.(url);
      return view === undefined ? fakeResponse(500, {}) : fakeResponse(200, view);
    }
    if (url.startsWith('/api/lists/l1/entries/') && method === 'PATCH') {
      const view = options.onEntryPatch?.(url, String(init?.body));
      return view === undefined ? fakeResponse(500, {}) : fakeResponse(200, view);
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

  it('adds a tapped suggestion and patches it via a size chip', async () => {
    const posted: string[] = [];
    const patched: string[] = [];
    stubListApi({
      onEntryPost: (body) => {
        posted.push(body);
        return entryView({ id: 'e2', name: 'Nudeln', nameNormalized: 'nudeln', categoryId: 'c6' });
      },
      onEntryPatch: (_url, body) => {
        patched.push(body);
        return entryView({
          id: 'e2',
          name: 'Nudeln',
          nameNormalized: 'nudeln',
          categoryId: 'c6',
          quantities: [{ unit: 'g', quantity: 500 }],
        });
      },
    });
    renderListPage();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Was brauchst du?'), 'nud');
    await user.click(await screen.findByRole('button', { name: /Nudeln/ }));

    expect(posted).toHaveLength(1);
    expect(JSON.parse(posted[0] ?? '{}')).toEqual({ name: 'Nudeln', categoryId: 'c6' });
    expect(await screen.findByText('Nudeln')).toBeDefined();

    // The chip bar for the new entry: the last size is highlighted.
    const sizeChip = await screen.findByRole('button', { name: '500 g' });
    expect(sizeChip.className).toContain('highlighted');
    await user.click(sizeChip);

    expect(patched).toHaveLength(1);
    expect(JSON.parse(patched[0] ?? '{}')).toEqual({ quantity: 500, unit: 'g' });
    expect(await screen.findByText('500 g', { selector: '.entry-quantity' })).toBeDefined();
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

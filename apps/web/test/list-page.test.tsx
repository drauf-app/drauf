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
    flags: null,
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
  lastNote: 'al dente',
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
        const fields = JSON.parse(body) as { quantity?: number; unit?: string; count?: number };
        current = {
          ...current,
          quantities:
            fields.quantity === undefined && fields.count === undefined
              ? []
              : [
                  {
                    unit: fields.unit === '' || fields.unit === undefined ? null : fields.unit,
                    quantity: fields.quantity ?? fields.count ?? 0,
                    ...(fields.quantity !== undefined && fields.count !== undefined
                      ? { count: fields.count }
                      : {}),
                  },
                ],
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

    // A count composes with the size instead of replacing it (2 × 500 g).
    const activeChip = await screen.findByRole('button', { name: '500 g' });
    expect(activeChip.className).toContain('active');
    await user.click(screen.getByRole('button', { name: '2' }));
    expect(JSON.parse(patched[1] ?? '{}')).toEqual({ count: 2, quantity: 500, unit: 'g' });

    // Tapping the active size keeps the count; tapping the count clears it.
    await user.click(await screen.findByRole('button', { name: '500 g' }));
    expect(JSON.parse(patched[2] ?? '{}')).toEqual({ count: 2 });

    // Typing the next article returns to suggestions.
    await user.type(screen.getByLabelText('Nächster Artikel …'), 'mi');
    expect(await screen.findByRole('button', { name: /Nudeln/ })).toBeDefined();
  });

  it('applies custom modifiers through the + chip and toggles them as multi-select', async () => {
    const patched: string[] = [];
    let variant: string | null = null;
    stubListApi({
      onEntryPost: () =>
        entryView({ id: 'e5', name: 'Chips', nameNormalized: 'chips', categoryId: null }),
      onEntryPatch: (_url, body) => {
        patched.push(body);
        variant = (JSON.parse(body) as { variant: string }).variant || null;
        return entryView({ id: 'e5', name: 'Chips', nameNormalized: 'chips', variant });
      },
    });
    renderListPage();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Was brauchst du?'), 'chips');
    await user.click(await screen.findByRole('button', { name: /Nudeln/ }));

    await user.click(await screen.findByRole('button', { name: 'Eigene Variante' }));
    await user.type(screen.getByLabelText('Eigene Variante'), 'Lays, Paprika');
    await user.click(screen.getByRole('button', { name: 'Variante übernehmen' }));

    // A typed comma list lands as several modifiers at once.
    expect(JSON.parse(patched[0] ?? '{}')).toEqual({ variant: 'Lays, Paprika' });
    expect(
      await screen.findByText('Lays, Paprika', { selector: '.entry-name .entry-variant' }),
    ).toBeDefined();

    // The catalogue variety joins the list instead of replacing it …
    await user.click(screen.getByRole('button', { name: 'Spaghetti' }));
    expect(JSON.parse(patched[1] ?? '{}')).toEqual({ variant: 'Lays, Paprika, Spaghetti' });

    // … and tapping an active modifier removes only that one.
    await user.click(await screen.findByRole('button', { name: 'Spaghetti' }));
    expect(JSON.parse(patched[2] ?? '{}')).toEqual({ variant: 'Lays, Paprika' });
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

describe('notes', () => {
  it('shows the note on tiles and offers the last note in the drawer', async () => {
    const patched: string[] = [];
    stubListApi({
      entries: [entryView({ icon: '🥛', note: 'die gute' })],
      onEntryPost: () =>
        entryView({ id: 'e8', name: 'Nudeln', nameNormalized: 'nudeln', note: null }),
      onEntryPatch: (_url, body) => {
        patched.push(body);
        return entryView({ id: 'e8', name: 'Nudeln', nameNormalized: 'nudeln', note: 'al dente' });
      },
    });
    localStorage.setItem('drauf.list-view', 'tiles');
    renderListPage();
    const user = userEvent.setup();

    expect(await screen.findByText(/die gute/)).toBeDefined();

    await user.type(screen.getByLabelText('Was brauchst du?'), 'nud');
    await user.click(await screen.findByRole('button', { name: /Nudeln/ }));

    const pill = await screen.findByRole('button', { name: /Letzte Notiz.*al dente/ });
    await user.click(pill);
    expect(JSON.parse(patched[0] ?? '{}')).toEqual({ note: 'al dente' });
    // Once the entry has a note, the pill disappears and the note shows.
    expect(screen.queryByRole('button', { name: /Letzte Notiz/ })).toBeNull();
    expect(await screen.findByText(/al dente/, { selector: '.drawer-note' })).toBeDefined();
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
    expect(document.querySelector('img.openmoji[src="/openmoji/1F95B.svg"]')).not.toBeNull();

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

describe('flags and the details editor', () => {
  function stubWithPatchReducer() {
    const patched: string[] = [];
    let current = entryView({ id: 'e7', name: 'Nudeln', nameNormalized: 'nudeln' });
    stubListApi({
      onEntryPost: () => current,
      onEntryPatch: (_url, body) => {
        patched.push(body);
        const fields = JSON.parse(body) as {
          quantity?: number;
          unit?: string;
          count?: number;
          variant?: string;
          flags?: string;
        };
        current = {
          ...current,
          ...(fields.variant === undefined ? {} : { variant: fields.variant || null }),
          ...(fields.flags === undefined ? {} : { flags: fields.flags || null }),
          ...(fields.quantity !== undefined || fields.count !== undefined
            ? {
                quantities: [
                  {
                    unit: fields.unit === '' || fields.unit === undefined ? null : fields.unit,
                    quantity: fields.quantity ?? fields.count ?? 0,
                    ...(fields.quantity !== undefined && fields.count !== undefined
                      ? { count: fields.count }
                      : {}),
                  },
                ],
              }
            : fields.unit !== undefined
              ? { quantities: [] }
              : {}),
        };
        return current;
      },
    });
    return patched;
  }

  async function openDetails(user: ReturnType<typeof userEvent.setup>) {
    await user.type(await screen.findByLabelText('Was brauchst du?'), 'nud');
    await user.click(await screen.findByRole('button', { name: /Nudeln/ }));
    await screen.findByLabelText('Nächster Artikel …');
  }

  it('toggles fixed flags and shows them as badges', async () => {
    const patched = stubWithPatchReducer();
    renderListPage();
    const user = userEvent.setup();
    await openDetails(user);

    await user.click(screen.getByRole('button', { name: 'Dringend' }));
    expect(JSON.parse(patched[0] ?? '{}')).toEqual({ flags: 'Dringend' });
    expect(await screen.findByText('Dringend', { selector: '.entry-flag' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Angebot' }));
    expect(JSON.parse(patched[1] ?? '{}')).toEqual({ flags: 'Dringend, Angebot' });
  });

  it('parses the details text field live in both directions', async () => {
    const patched = stubWithPatchReducer();
    renderListPage();
    const user = userEvent.setup();
    await openDetails(user);

    await user.click(screen.getByRole('button', { name: 'Eigene Details bearbeiten' }));
    const field = screen.getByLabelText('Details') as HTMLInputElement;
    expect(field.value).toBe('');

    await user.type(field, '3, 3-lagig, sehr weich');
    // The count chip reflects the field immediately, before any request.
    expect(screen.getByRole('button', { name: '3' }).className).toContain('active');

    // Tapping a chip while the field is open edits the text, not the entry.
    await user.click(screen.getByRole('button', { name: '500 g' }));
    expect(field.value).toBe('3, 500 g, 3-lagig, sehr weich');

    // Closing flushes one PATCH with everything parsed from the field.
    await user.click(screen.getByRole('button', { name: 'Details schließen' }));
    expect(JSON.parse(patched[patched.length - 1] ?? '{}')).toEqual({
      quantity: 500,
      unit: 'g',
      count: 3,
      variant: '3-lagig, sehr weich',
    });
  });
});

describe('deleting through the editor', () => {
  it('removes the entry via the edit form', async () => {
    const deleted: string[] = [];
    stubFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/lists/l1' && method === 'GET') {
        return fakeResponse(200, LIST);
      }
      if (url === '/api/lists/l1/entries' && method === 'GET') {
        return fakeResponse(200, [entryView({})]);
      }
      if (url === '/api/categories') return fakeResponse(200, CATEGORIES);
      if (url === '/api/stores') return fakeResponse(200, []);
      if (url === '/api/lists/l1/entries/e1' && method === 'DELETE') {
        deleted.push(url);
        return fakeResponse(204, {});
      }
      return undefined;
    });
    renderListPage();
    const user = userEvent.setup();

    // No delete on the row itself anymore — it lives in the editor.
    await screen.findByText('Milch');
    expect(screen.queryByRole('button', { name: 'Eintrag löschen' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Bearbeiten: Milch' }));
    await user.click(await screen.findByRole('button', { name: 'Eintrag löschen' }));

    expect(deleted).toHaveLength(1);
    expect(screen.queryByText('Milch')).toBeNull();
    expect(screen.queryByLabelText('Name')).toBeNull();
  });
});

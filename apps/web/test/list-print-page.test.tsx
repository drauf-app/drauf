import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Category, EntryView, ListDetail, StoreWithOrder } from '../src/api/types';
import type { CategoryGroup } from '../src/lib/entries';
import { ListPrintPage, splitGroups } from '../src/pages/ListPrintPage';
import { fakeResponse, stubFetch } from './fake-fetch';

const LIST: ListDetail = {
  id: 'l1',
  name: 'Wocheneinkauf',
  icon: null,
  color: null,
  archived: false,
  ownerId: 'u1',
  defaultStoreId: 'st1',
  createdAt: '',
  members: [],
};

const CATEGORIES: Category[] = [
  {
    id: 'c1',
    householdId: 'h1',
    key: null,
    name: 'Obst',
    icon: null,
    sortOrder: 10,
    createdAt: '',
  },
  {
    id: 'c2',
    householdId: 'h1',
    key: null,
    name: 'Getränke',
    icon: null,
    sortOrder: 20,
    createdAt: '',
  },
];

/** The store walks the aisles in the opposite of the household order. */
const STORES: StoreWithOrder[] = [
  { id: 'st1', householdId: 'h1', name: 'Kaufland', createdAt: '', categoryOrder: ['c2', 'c1'] },
];

function entry(overrides: Partial<EntryView> & { id: string; name: string }): EntryView {
  return {
    listId: 'l1',
    nameNormalized: overrides.name.toLowerCase(),
    variant: null,
    flags: null,
    note: null,
    categoryId: null,
    fieldTimes: null,
    checkedAt: null,
    checkedById: null,
    createdAt: '',
    quantities: [],
    portions: [],
    icon: null,
    ...overrides,
  };
}

const ENTRIES: EntryView[] = [
  entry({
    id: 'e1',
    name: 'Zwiebeln',
    categoryId: 'c1',
    quantities: [
      { unit: 'g', quantity: 500, count: 2 },
      { unit: 'Stück', quantity: 1 },
    ],
  }),
  entry({ id: 'e2', name: 'Apfelsaft', categoryId: 'c2' }),
  entry({ id: 'e3', name: 'Haferflocken', categoryId: 'c1', checkedAt: '2026-11-25T10:00:00Z' }),
];

function stubListApi(): void {
  stubFetch((url) => {
    if (url === '/api/lists/l1') return fakeResponse(200, LIST);
    if (url === '/api/lists/l1/entries') return fakeResponse(200, ENTRIES);
    if (url === '/api/categories') return fakeResponse(200, CATEGORIES);
    if (url === '/api/stores') return fakeResponse(200, STORES);
    return undefined;
  });
}

function renderPrint() {
  return render(
    <MemoryRouter initialEntries={['/lists/l1/print']}>
      <Routes>
        <Route path="/lists/:id/print" element={<ListPrintPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ListPrintPage', () => {
  it('groups in the default store order and re-sorts for the household order', async () => {
    stubListApi();
    const { container } = renderPrint();
    const user = userEvent.setup();

    await screen.findByText('Zwiebeln');
    const headings = () =>
      [...container.querySelectorAll('.print-group h2')].map((heading) => heading.textContent);
    // Kaufland (the list's default store) reverses the household order.
    expect(headings()).toEqual(['Getränke', 'Obst']);

    await user.selectOptions(screen.getByLabelText('Laden'), '');
    expect(headings()).toEqual(['Obst', 'Getränke']);
  });

  it('hides checked items until the toggle shows the recent block', async () => {
    stubListApi();
    renderPrint();
    const user = userEvent.setup();

    await screen.findByText('Zwiebeln');
    expect(screen.queryByText('Haferflocken')).toBeNull();

    await user.click(screen.getByLabelText('Erledigte zeigen'));
    expect(screen.getByText('Haferflocken')).toBeTruthy();
    expect(screen.getByText('Zuletzt gekauft')).toBeTruthy();
  });

  it('renders two explicit column stacks when two columns are selected', async () => {
    localStorage.setItem(
      'drauf.list-print-settings',
      JSON.stringify({ showRecent: false, columns: 2 }),
    );
    stubListApi();
    const { container } = renderPrint();

    await screen.findByText('Zwiebeln');
    const columns = [...container.querySelectorAll('.print-list .print-column')];
    expect(columns).toHaveLength(2);
    // One group per stack; store order (Getränke first) is preserved.
    expect(columns[0]?.textContent).toContain('Getränke');
    expect(columns[1]?.textContent).toContain('Obst');
  });

  it('splits groups into stacks of roughly equal line count', () => {
    const group = (id: string, items: number): CategoryGroup => ({
      category: {
        id,
        householdId: 'h1',
        key: null,
        name: id,
        icon: null,
        sortOrder: 0,
        createdAt: '',
      },
      entries: Array.from({ length: items }, (_, index) =>
        entry({ id: `${id}-${index}`, name: `${id}-${index}` }),
      ),
    });
    const [left, right] = splitGroups([group('a', 5), group('b', 4), group('c', 3), group('d', 2)]);
    // Weights 6+5 | 4+3: the halves stay in order and are nearly balanced.
    expect(left.map((item) => item.category?.id)).toEqual(['a', 'b']);
    expect(right.map((item) => item.category?.id)).toEqual(['c', 'd']);
  });

  it('prints merged quantities side by side', async () => {
    stubListApi();
    renderPrint();

    await screen.findByText('Zwiebeln');
    expect(screen.getByText('2 × 500 g + 1 Stück')).toBeTruthy();
  });
});

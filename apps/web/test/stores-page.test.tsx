import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Category, StoreWithOrder } from '../src/api/types';
import { StoresPage } from '../src/pages/StoresPage';
import { fakeResponse, stubFetch } from './fake-fetch';

const CATEGORIES: Category[] = [
  { id: 'c1', householdId: 'h1', key: null, name: 'Obst', sortOrder: 0, createdAt: '' },
  { id: 'c2', householdId: 'h1', key: null, name: 'Getränke', sortOrder: 1, createdAt: '' },
  { id: 'c3', householdId: 'h1', key: null, name: 'Haushalt', sortOrder: 2, createdAt: '' },
];

function store(overrides: Partial<StoreWithOrder> = {}): StoreWithOrder {
  return {
    id: 's1',
    householdId: 'h1',
    name: 'Supermarkt Ost',
    createdAt: '',
    categoryOrder: [],
    ...overrides,
  };
}

describe('StoresPage', () => {
  it('shows categories in the store order with the rest after', async () => {
    stubFetch((url) => {
      if (url === '/api/stores') return fakeResponse(200, [store({ categoryOrder: ['c2'] })]);
      if (url === '/api/categories') return fakeResponse(200, CATEGORIES);
      return undefined;
    });
    render(<StoresPage />);

    await screen.findByText('Supermarkt Ost');
    const names = screen
      .getAllByRole('listitem')
      .map((item) => item.querySelector('.category-order-name')?.textContent);
    expect(names).toEqual(['Getränke', 'Obst', 'Haushalt']);
  });

  it('moves a category down and PUTs the full order', async () => {
    const puts: string[] = [];
    stubFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/stores' && method === 'GET') return fakeResponse(200, [store()]);
      if (url === '/api/categories') return fakeResponse(200, CATEGORIES);
      if (url === '/api/stores/s1/category-order' && method === 'PUT') {
        puts.push(String(init?.body));
        return fakeResponse(200, store({ categoryOrder: ['c2', 'c1', 'c3'] }));
      }
      return undefined;
    });
    render(<StoresPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Nach unten: Obst' }));

    expect(puts).toHaveLength(1);
    expect(JSON.parse(puts[0] ?? '{}')).toEqual({ categoryIds: ['c2', 'c1', 'c3'] });
  });

  it('creates a store', async () => {
    const posted: string[] = [];
    stubFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/stores' && method === 'GET') return fakeResponse(200, []);
      if (url === '/api/categories') return fakeResponse(200, CATEGORIES);
      if (url === '/api/stores' && method === 'POST') {
        posted.push(String(init?.body));
        return fakeResponse(201, store({ id: 's9', name: 'Biomarkt' }));
      }
      return undefined;
    });
    render(<StoresPage />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name des neuen Ladens'), 'Biomarkt');
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));

    expect(await screen.findByText('Biomarkt')).toBeDefined();
    expect(JSON.parse(posted[0] ?? '{}')).toEqual({ name: 'Biomarkt' });
  });
});

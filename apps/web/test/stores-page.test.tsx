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

const DEFAULT_STAPLES = { staples: ['Salz', 'Öl'], custom: false };

describe('StoresPage', () => {
  it('shows compact rows with an order hint and disables reset on default order', async () => {
    stubFetch((url) => {
      if (url === '/api/stores')
        return fakeResponse(200, [
          store(),
          store({ id: 's2', name: 'Biomarkt', categoryOrder: ['c2'] }),
        ]);
      if (url === '/api/categories') return fakeResponse(200, CATEGORIES);
      if (url === '/api/households/staples') return fakeResponse(200, DEFAULT_STAPLES);
      return undefined;
    });
    render(<StoresPage />);

    await screen.findByText('Supermarkt Ost');
    expect(screen.getByText('Standard-Reihenfolge')).toBeDefined();
    expect(screen.getByText('eigene Reihenfolge')).toBeDefined();
    const resetDefault = screen.getByRole('button', {
      name: 'Zurücksetzen: Supermarkt Ost',
    }) as HTMLButtonElement;
    expect(resetDefault.disabled).toBe(true);
    // The category lists stay out of the overview until a dialog opens.
    expect(screen.queryByText('Obst')).toBeNull();
  });

  it('edits the order in a dialog and PUTs the full order', async () => {
    const puts: string[] = [];
    stubFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/stores' && method === 'GET')
        return fakeResponse(200, [store({ categoryOrder: ['c2'] })]);
      if (url === '/api/categories') return fakeResponse(200, CATEGORIES);
      if (url === '/api/households/staples') return fakeResponse(200, DEFAULT_STAPLES);
      if (url === '/api/stores/s1/category-order' && method === 'PUT') {
        puts.push(String(init?.body));
        return fakeResponse(200, store({ categoryOrder: ['c2', 'c1', 'c3'] }));
      }
      return undefined;
    });
    render(<StoresPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Bearbeiten: Supermarkt Ost' }));
    const dialog = await screen.findByRole('dialog');
    const names = [...dialog.querySelectorAll('.category-order-name')].map(
      (node) => node.textContent,
    );
    expect(names).toEqual(['Getränke', 'Obst', 'Haushalt']);

    await user.click(screen.getByRole('button', { name: 'Nach unten: Getränke' }));
    expect(puts).toHaveLength(1);
    expect(JSON.parse(puts[0] ?? '{}')).toEqual({ categoryIds: ['c1', 'c2', 'c3'] });
  });

  it('resets a custom order to the household default', async () => {
    const puts: string[] = [];
    stubFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/stores' && method === 'GET')
        return fakeResponse(200, [store({ categoryOrder: ['c2', 'c1'] })]);
      if (url === '/api/categories') return fakeResponse(200, CATEGORIES);
      if (url === '/api/households/staples') return fakeResponse(200, DEFAULT_STAPLES);
      if (url === '/api/stores/s1/category-order' && method === 'PUT') {
        puts.push(String(init?.body));
        return fakeResponse(200, store({ categoryOrder: [] }));
      }
      return undefined;
    });
    render(<StoresPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Zurücksetzen: Supermarkt Ost' }));
    expect(JSON.parse(puts[0] ?? '{}')).toEqual({ categoryIds: [] });
    expect(await screen.findByText('Standard-Reihenfolge')).toBeDefined();
  });

  it('renames the store through the dialog', async () => {
    const patches: string[] = [];
    stubFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/stores' && method === 'GET') return fakeResponse(200, [store()]);
      if (url === '/api/categories') return fakeResponse(200, CATEGORIES);
      if (url === '/api/households/staples') return fakeResponse(200, DEFAULT_STAPLES);
      if (url === '/api/stores/s1' && method === 'PATCH') {
        patches.push(String(init?.body));
        return fakeResponse(200, store({ name: 'Supermarkt West' }));
      }
      return undefined;
    });
    render(<StoresPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Bearbeiten: Supermarkt Ost' }));
    const nameInput = await screen.findByLabelText('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Supermarkt West');
    await user.click(screen.getByRole('button', { name: 'Fertig' }));

    expect(JSON.parse(patches[0] ?? '{}')).toEqual({ name: 'Supermarkt West' });
    expect(await screen.findByText('Supermarkt West')).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('creates a store', async () => {
    const posted: string[] = [];
    stubFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/stores' && method === 'GET') return fakeResponse(200, []);
      if (url === '/api/categories') return fakeResponse(200, CATEGORIES);
      if (url === '/api/households/staples') return fakeResponse(200, DEFAULT_STAPLES);
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

  describe('staples section', () => {
    it('lists the staples and saves the full list on add and remove', async () => {
      const puts: string[] = [];
      stubFetch((url, init) => {
        const method = init?.method ?? 'GET';
        if (url === '/api/stores') return fakeResponse(200, []);
        if (url === '/api/categories') return fakeResponse(200, CATEGORIES);
        if (url === '/api/households/staples' && method === 'GET')
          return fakeResponse(200, DEFAULT_STAPLES);
        if (url === '/api/households/staples' && method === 'PUT') {
          puts.push(String(init?.body));
          const { staples } = JSON.parse(String(init?.body)) as { staples: string[] };
          return fakeResponse(200, { staples, custom: true });
        }
        return undefined;
      });
      render(<StoresPage />);
      const user = userEvent.setup();

      expect(await screen.findByText('Salz')).toBeDefined();
      await user.type(screen.getByLabelText('Zutat für den Grundvorrat'), 'Brühwürfel');
      await user.click(screen.getByRole('button', { name: 'Hinzufügen' }));
      expect(await screen.findByText('Brühwürfel')).toBeDefined();
      expect(JSON.parse(puts[0] ?? '{}')).toEqual({ staples: ['Salz', 'Öl', 'Brühwürfel'] });

      await user.click(screen.getByRole('button', { name: 'Entfernen: Salz' }));
      expect(JSON.parse(puts[1] ?? '{}')).toEqual({ staples: ['Öl', 'Brühwürfel'] });
      expect(screen.queryByText('Salz')).toBeNull();
    });

    it('offers a reset back to the defaults once the list is custom', async () => {
      let deleted = 0;
      stubFetch((url, init) => {
        const method = init?.method ?? 'GET';
        if (url === '/api/stores') return fakeResponse(200, []);
        if (url === '/api/categories') return fakeResponse(200, CATEGORIES);
        if (url === '/api/households/staples' && method === 'GET')
          return fakeResponse(200, { staples: ['Brühwürfel'], custom: true });
        if (url === '/api/households/staples' && method === 'DELETE') {
          deleted += 1;
          return fakeResponse(200, DEFAULT_STAPLES);
        }
        return undefined;
      });
      render(<StoresPage />);
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Standard wiederherstellen' }));
      expect(deleted).toBe(1);
      expect(await screen.findByText('Salz')).toBeDefined();
      expect(screen.queryByRole('button', { name: 'Standard wiederherstellen' })).toBeNull();
    });
  });
});

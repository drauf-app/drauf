import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Category } from '../src/api/types';
import { StoresPage } from '../src/pages/StoresPage';
import { fakeResponse, stubFetch } from './fake-fetch';

const BASE: Category = {
  id: 'c1',
  householdId: 'h1',
  key: 'drinks',
  name: 'Getränke',
  icon: '🥤',
  sortOrder: 10,
  createdAt: '',
};

const CUSTOM: Category = {
  id: 'c2',
  householdId: 'h1',
  key: null,
  name: 'Tierbedarf',
  icon: null,
  sortOrder: 20,
  createdAt: '',
};

function stubApi(
  onMutation: (method: string, url: string, body: Record<string, unknown>) => Response | undefined,
) {
  return stubFetch((url, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') {
      if (url === '/api/stores') return fakeResponse(200, []);
      if (url === '/api/categories') return fakeResponse(200, [BASE, CUSTOM]);
      if (url === '/api/households/staples')
        return fakeResponse(200, { staples: [], custom: false });
      return undefined;
    }
    return onMutation(method, url, JSON.parse(String(init?.body ?? '{}')));
  });
}

describe('category management (#114)', () => {
  it('creates a household category', async () => {
    stubApi((method, url, body) => {
      if (method === 'POST' && url === '/api/categories') {
        return fakeResponse(201, { ...CUSTOM, id: 'c3', name: body.name, sortOrder: 30 });
      }
      return undefined;
    });
    render(<StoresPage />);
    const user = userEvent.setup();

    const input = await screen.findByLabelText('Name der neuen Kategorie');
    await user.type(input, 'Garten{Enter}');

    expect(await screen.findByText('Garten')).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('renames a base category inline', async () => {
    stubApi((method, url, body) => {
      if (method === 'PATCH' && url === '/api/categories/c1') {
        return fakeResponse(200, { ...BASE, name: body.name });
      }
      return undefined;
    });
    render(<StoresPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Bearbeiten: Getränke'));
    const field = screen.getByLabelText('Name');
    await user.clear(field);
    await user.type(field, 'Getränke & Säfte');
    await user.click(screen.getByText('Speichern'));

    expect(await screen.findByText('Getränke & Säfte')).toBeTruthy();
  });

  it('deletes only custom categories, after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    stubApi((method, url) => {
      if (method === 'DELETE' && url === '/api/categories/c2') {
        return fakeResponse(204, undefined);
      }
      return undefined;
    });
    render(<StoresPage />);
    const user = userEvent.setup();

    await screen.findByText('Tierbedarf');
    // The seeded base set has no delete button (L5).
    expect(screen.queryByLabelText('Löschen: Getränke')).toBeNull();

    await user.click(screen.getByLabelText('Löschen: Tierbedarf'));
    await waitFor(() => expect(screen.queryByText('Tierbedarf')).toBeNull());
    confirm.mockRestore();
  });

  it('reorders by swapping sort orders with the neighbour', async () => {
    const patched: Array<{ url: string; sortOrder: number }> = [];
    stubApi((method, url, body) => {
      if (method === 'PATCH' && url.startsWith('/api/categories/')) {
        patched.push({ url, sortOrder: body.sortOrder as number });
        const row = url.endsWith('c1') ? BASE : CUSTOM;
        return fakeResponse(200, { ...row, sortOrder: body.sortOrder });
      }
      return undefined;
    });
    render(<StoresPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Kategorie nach unten: Getränke'));

    await waitFor(() => expect(patched).toHaveLength(2));
    expect(patched).toEqual(
      expect.arrayContaining([
        { url: '/api/categories/c1', sortOrder: 20 },
        { url: '/api/categories/c2', sortOrder: 10 },
      ]),
    );
    // The custom category now renders first.
    const names = screen.getAllByText(/Getränke|Tierbedarf/).map((node) => node.textContent);
    expect(names[0]).toBe('Tierbedarf');
  });
});

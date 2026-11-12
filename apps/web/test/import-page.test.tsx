import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { ImportPreview } from '../src/api/import';
import type { List, MealSlot } from '../src/api/types';
import { ImportPage } from '../src/pages/ImportPage';
import { fakeResponse, stubFetch } from './fake-fetch';

const LISTS: List[] = [
  {
    id: 'l1',
    name: 'Wocheneinkauf',
    icon: null,
    color: null,
    archived: false,
    ownerId: 'u1',
    defaultStoreId: null,
    createdAt: '',
  },
  {
    id: 'l2',
    name: 'Drogerie',
    icon: null,
    color: null,
    archived: false,
    ownerId: 'u1',
    defaultStoreId: null,
    createdAt: '',
  },
];

const SLOTS: MealSlot[] = [
  { id: 's1', householdId: 'h1', name: 'Mittagessen', sortOrder: 10, createdAt: '' },
];

const PREVIEW: ImportPreview = {
  provider: 'cookidoo',
  url: 'https://example.com/r/1',
  title: 'Gemüsecurry',
  imageUrl: null,
  servings: 4,
  ingredients: [
    { raw: '500 g Reis', name: 'Reis', quantity: 500, unit: 'g', isStaple: false },
    { raw: '2 Zwiebeln', name: 'Zwiebeln', quantity: 2, isStaple: false },
    { raw: 'Salz', name: 'Salz', isStaple: true },
  ],
};

function stubImportApi(onApply?: (body: string) => void) {
  stubFetch((url, init) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/lists') return fakeResponse(200, LISTS);
    if (url === '/api/plan/slots') return fakeResponse(200, SLOTS);
    if (url === '/api/import/preview' && method === 'POST') return fakeResponse(200, PREVIEW);
    if (url === '/api/import/apply' && method === 'POST') {
      onApply?.(String(init?.body));
      return fakeResponse(201, { entries: [] });
    }
    return undefined;
  });
}

function renderImport() {
  return render(
    <MemoryRouter initialEntries={['/import']}>
      <Routes>
        <Route path="/import" element={<ImportPage />} />
        <Route path="/lists/:id" element={<div>LIST VIEW</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function loadPreview(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    await screen.findByLabelText('Rezept-Link oder geteilter Text'),
    'https://example.com/r/1',
  );
  await user.click(screen.getByRole('button', { name: 'Vorschau' }));
  await screen.findByText('Gemüsecurry');
}

describe('ImportPage', () => {
  it('shows the preview with staples deselected', async () => {
    stubImportApi();
    renderImport();
    const user = userEvent.setup();
    await loadPreview(user);

    expect(screen.getByLabelText('500 g Reis')).toHaveProperty('checked', true);
    expect(screen.getByLabelText('Salz')).toHaveProperty('checked', false);
  });

  it('scales quantities with the servings stepper', async () => {
    stubImportApi();
    renderImport();
    const user = userEvent.setup();
    await loadPreview(user);

    await user.click(screen.getByRole('button', { name: 'Mehr Portionen' }));
    await user.click(screen.getByRole('button', { name: 'Mehr Portionen' }));

    expect(screen.getByText('6 Portionen')).toBeDefined();
    expect(screen.getByLabelText('750 g Reis')).toBeDefined();
    expect(screen.getByLabelText('3 Zwiebeln')).toBeDefined();
  });

  it('preselects the remembered list and applies the selection', async () => {
    localStorage.setItem('drauf.last-list', 'l2');
    const applied: string[] = [];
    stubImportApi((body) => applied.push(body));
    renderImport();
    const user = userEvent.setup();
    await loadPreview(user);

    await user.click(screen.getByRole('button', { name: 'Importieren' }));

    expect(await screen.findByText('LIST VIEW')).toBeDefined();
    expect(applied).toHaveLength(1);
    expect(JSON.parse(applied[0] ?? '{}')).toEqual({
      list: {
        id: 'l2',
        items: [
          { name: 'Reis', quantity: 500, unit: 'g' },
          { name: 'Zwiebeln', quantity: 2 },
        ],
      },
    });
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { HouseholdInfo, MealSlot, PlanEntry } from '../src/api/types';
import { weekDays } from '../src/lib/week';
import { PlanPage } from '../src/pages/PlanPage';
import { fakeResponse, stubFetch } from './fake-fetch';

const SLOTS: MealSlot[] = [
  { id: 's2', householdId: 'h1', name: 'Abendessen', sortOrder: 20, createdAt: '' },
  { id: 's1', householdId: 'h1', name: 'Mittagessen', sortOrder: 10, createdAt: '' },
];

const HOUSEHOLD: HouseholdInfo = {
  id: 'h1',
  name: 'Zuhause',
  members: [
    { userId: 'u1', username: 'kathrin', displayName: 'Kathrin' },
    { userId: 'u2', username: 'christian', displayName: 'Christian' },
  ],
};

const DAYS = weekDays(0);

function planEntry(overrides: Partial<PlanEntry>): PlanEntry {
  return {
    id: 'p1',
    householdId: 'h1',
    date: DAYS[0] ?? '',
    slotId: 's1',
    text: 'Pasta',
    link: null,
    imageUrl: null,
    cookId: 'u2',
    createdAt: '',
    ...overrides,
  };
}

interface StubOptions {
  onPost?: (body: string) => PlanEntry;
  recipes?: unknown[];
}

function stubPlanApi(entries: PlanEntry[], options: StubOptions = {}) {
  stubFetch((url, init) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/plan/slots') return fakeResponse(200, SLOTS);
    if (url === '/api/households/me') return fakeResponse(200, HOUSEHOLD);
    if (url.startsWith('/api/plan/entries?') && method === 'GET') {
      return fakeResponse(200, entries);
    }
    if (url.startsWith('/api/plan/recipes?') && method === 'GET') {
      return fakeResponse(200, options.recipes ?? []);
    }
    if (url === '/api/plan/entries' && method === 'POST') {
      const view = options.onPost?.(String(init?.body));
      return view === undefined ? fakeResponse(500, {}) : fakeResponse(201, view);
    }
    return undefined;
  });
}

describe('PlanPage', () => {
  it('renders seven days with the slots in order and shows the cook', async () => {
    stubPlanApi([planEntry({})]);
    render(
      <MemoryRouter>
        <PlanPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Pasta')).toBeDefined();
    expect(screen.getByText('Christian')).toBeDefined();
    // The slot renders as a label tag on the entry, not as empty cells.
    expect(screen.getAllByText('Mittagessen')).toHaveLength(1);
    expect(screen.queryByText('Abendessen')).toBeNull();
    // One add button per day: days hold any number of entries.
    expect(screen.getAllByRole('button', { name: /Eintrag hinzufügen/ })).toHaveLength(7);
  });

  it('shows the source label as a clickable link next to the title', async () => {
    stubPlanApi([
      planEntry({ text: 'Tomatensuppe', link: 'https://cookidoo.de/recipes/recipe/de-DE/r1' }),
    ]);
    render(
      <MemoryRouter>
        <PlanPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Tomatensuppe')).toBeDefined();
    const source = screen.getByRole('link', { name: '(Cookidoo)' });
    expect(source.getAttribute('href')).toBe('https://cookidoo.de/recipes/recipe/de-DE/r1');
  });

  it('creates an entry with text and cook in an empty slot', async () => {
    const posted: string[] = [];
    stubPlanApi([], {
      onPost: (body) => {
        posted.push(body);
        return planEntry({ id: 'p9', text: 'Flammkuchen', cookId: 'u1', slotId: 's2' });
      },
    });
    render(
      <MemoryRouter>
        <PlanPage />
      </MemoryRouter>,
    );
    const user = userEvent.setup();

    const addButtons = await screen.findAllByRole('button', { name: /Eintrag hinzufügen/ });
    const firstDay = addButtons[0];
    if (firstDay === undefined) throw new Error('no day cell found');
    await user.click(firstDay);

    // The editor opens as a dialog instead of squeezing into the day column.
    expect(screen.getByRole('dialog')).toBeDefined();
    await user.type(screen.getByLabelText('Gericht oder Link'), 'Flammkuchen');
    await user.selectOptions(screen.getByLabelText('Wer kocht?'), 'u1');
    await user.selectOptions(screen.getByLabelText('Mahlzeit'), 's2');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByText('Flammkuchen')).toBeDefined();
    expect(posted).toHaveLength(1);
    expect(JSON.parse(posted[0] ?? '{}')).toEqual({
      date: DAYS[0],
      slotId: 's2',
      text: 'Flammkuchen',
      cookId: 'u1',
    });
  });

  it('offers cooked recipes while typing and carries the link on pick (#88)', async () => {
    const threeWeeksAgo = new Date();
    threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21);
    const lastCookedAt = `${threeWeeksAgo.getFullYear()}-${String(
      threeWeeksAgo.getMonth() + 1,
    ).padStart(2, '0')}-${String(threeWeeksAgo.getDate()).padStart(2, '0')}`;
    const posted: string[] = [];
    stubPlanApi([], {
      recipes: [
        {
          text: 'Lasagne',
          link: 'https://example.com/r/lasagne',
          imageUrl: null,
          lastCookedAt,
          timesCooked: 2,
        },
      ],
      onPost: (body) => {
        posted.push(body);
        return planEntry({ id: 'p9', text: 'Lasagne', cookId: null, slotId: 's1' });
      },
    });
    render(
      <MemoryRouter>
        <PlanPage />
      </MemoryRouter>,
    );
    const user = userEvent.setup();

    const addButtons = await screen.findAllByRole('button', { name: /Eintrag hinzufügen/ });
    const firstCell = addButtons[0];
    if (firstCell === undefined) throw new Error('no plan cell found');
    await user.click(firstCell);
    await user.type(screen.getByLabelText('Gericht oder Link'), 'Lasa');

    // The suggestion shows the short last-cooked label.
    const suggestion = await screen.findByRole('button', { name: /Lasagne.*vor 3 Wochen/ });
    await user.click(suggestion);
    const input = screen.getByLabelText('Gericht oder Link') as HTMLInputElement;
    expect(input.value).toBe('Lasagne');

    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Lasagne')).toBeDefined();
    expect(JSON.parse(posted[0] ?? '{}')).toEqual({
      date: DAYS[0],
      text: 'Lasagne',
      link: 'https://example.com/r/lasagne',
    });
  });
});

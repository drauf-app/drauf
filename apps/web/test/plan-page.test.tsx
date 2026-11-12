import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function stubPlanApi(entries: PlanEntry[], onPost?: (body: string) => PlanEntry) {
  stubFetch((url, init) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/plan/slots') return fakeResponse(200, SLOTS);
    if (url === '/api/households/me') return fakeResponse(200, HOUSEHOLD);
    if (url.startsWith('/api/plan/entries?') && method === 'GET') {
      return fakeResponse(200, entries);
    }
    if (url === '/api/plan/entries' && method === 'POST') {
      const view = onPost?.(String(init?.body));
      return view === undefined ? fakeResponse(500, {}) : fakeResponse(201, view);
    }
    return undefined;
  });
}

describe('PlanPage', () => {
  it('renders seven days with the slots in order and shows the cook', async () => {
    stubPlanApi([planEntry({})]);
    render(<PlanPage />);

    expect(await screen.findByText('Pasta')).toBeDefined();
    expect(screen.getByText('Christian')).toBeDefined();
    // Two slots on each of the seven days, sorted by sortOrder.
    expect(screen.getAllByText('Mittagessen')).toHaveLength(7);
    expect(screen.getAllByText('Abendessen')).toHaveLength(7);
  });

  it('creates an entry with text and cook in an empty slot', async () => {
    const posted: string[] = [];
    stubPlanApi([], (body) => {
      posted.push(body);
      return planEntry({ id: 'p9', text: 'Flammkuchen', cookId: 'u1', slotId: 's2' });
    });
    render(<PlanPage />);
    const user = userEvent.setup();

    const addButtons = await screen.findAllByRole('button', { name: /Eintrag hinzufügen/ });
    const firstDayDinner = addButtons.find((button) =>
      button.getAttribute('aria-label')?.includes('Abendessen'),
    );
    if (firstDayDinner === undefined) throw new Error('no dinner cell found');
    await user.click(firstDayDinner);

    await user.type(screen.getByLabelText('Gericht oder Link'), 'Flammkuchen');
    await user.selectOptions(screen.getByLabelText('Wer kocht?'), 'u1');
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
});

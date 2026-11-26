import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { HouseholdInfo, MealSlot, PlanEntry } from '../src/api/types';
import { daysFrom } from '../src/lib/week';
import { PlanPrintPage } from '../src/pages/PlanPrintPage';
import { fakeResponse, stubFetch } from './fake-fetch';

const SLOTS: MealSlot[] = [
  { id: 's1', householdId: 'h1', name: 'Mittagessen', sortOrder: 10, createdAt: '' },
  { id: 's2', householdId: 'h1', name: 'Abendessen', sortOrder: 20, createdAt: '' },
];

const HOUSEHOLD: HouseholdInfo = {
  id: 'h1',
  name: 'Zuhause',
  members: [{ userId: 'u1', username: 'kathrin', displayName: 'Kathrin' }],
};

function stubPlanApi(entries: PlanEntry[]): void {
  stubFetch((url) => {
    if (url === '/api/plan/slots') return fakeResponse(200, SLOTS);
    if (url === '/api/households/me') return fakeResponse(200, HOUSEHOLD);
    if (url.startsWith('/api/plan/entries?')) return fakeResponse(200, entries);
    return undefined;
  });
}

function renderPrint() {
  return render(
    <MemoryRouter initialEntries={['/plan/print']}>
      <PlanPrintPage />
    </MemoryRouter>,
  );
}

describe('PlanPrintPage', () => {
  it('renders a Friday-to-Friday week from stored settings with entries and cooks', async () => {
    localStorage.setItem(
      'drauf.print-settings',
      JSON.stringify({ template: 'week', startDay: 5, days: 8 }),
    );
    const days = daysFrom(5, 0, 8);
    stubPlanApi([
      {
        id: 'p1',
        householdId: 'h1',
        date: days[0] ?? '',
        slotId: 's2',
        text: 'Pizza',
        link: null,
        imageUrl: null,
        cookId: 'u1',
        createdAt: '',
      },
    ]);
    renderPrint();

    expect(await screen.findByText('Pizza')).toBeDefined();
    expect(screen.getByText('kocht: Kathrin')).toBeDefined();
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings).toHaveLength(8);
    expect(headings[0]?.textContent).toContain('Freitag');
    expect(headings[7]?.textContent).toContain('Freitag');
  });

  it('keeps the label column for entries without a slot', async () => {
    const days = daysFrom(1, 0, 7);
    stubPlanApi([
      {
        id: 'p1',
        householdId: 'h1',
        date: days[0] ?? '',
        slotId: 's1',
        text: 'Suppe',
        link: null,
        imageUrl: null,
        cookId: null,
        createdAt: '',
      },
      {
        id: 'p2',
        householdId: 'h1',
        date: days[0] ?? '',
        slotId: null,
        text: 'Kuchen backen',
        link: null,
        imageUrl: null,
        cookId: null,
        createdAt: '',
      },
    ]);
    const { container } = renderPrint();

    await screen.findByText('Kuchen backen');
    const labels = [...container.querySelectorAll('.print-slot .print-slot-name')];
    // Both rows carry the label span so their lines start at the same x.
    expect(labels.map((label) => label.textContent)).toEqual(['Mittagessen', '']);
  });

  it('switches to the calendar template with days as columns', async () => {
    stubPlanApi([]);
    renderPrint();
    const user = userEvent.setup();

    await screen.findByText('Drucken');
    await user.selectOptions(screen.getByLabelText('Vorlage'), 'calendar');

    const table = await screen.findByRole('table');
    // Header row: seven day columns; entries list inside each day cell.
    expect(table.querySelectorAll('thead th')).toHaveLength(7);
    expect(table.querySelectorAll('tbody td')).toHaveLength(7);
  });
});

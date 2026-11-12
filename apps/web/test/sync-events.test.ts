import { describe, expect, it } from 'vitest';
import type { EntryView, MealSlot, PlanEntry } from '../src/api/types';
import { applyListEvent } from '../src/lib/entries';
import { applyPlanEvent } from '../src/lib/plan-events';

function entry(id: string, overrides: Partial<EntryView> = {}): EntryView {
  return {
    id,
    listId: 'l1',
    name: id,
    nameNormalized: id,
    variant: null,
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

describe('applyListEvent', () => {
  it('inserts, updates and removes entries', () => {
    let entries: EntryView[] = [];
    entries = applyListEvent(entries, { type: 'entry.created', data: entry('e1') });
    entries = applyListEvent(entries, {
      type: 'entry.checked',
      data: entry('e1', { checkedAt: '2026-11-12T10:00:00.000Z' }),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.checkedAt).not.toBeNull();

    entries = applyListEvent(entries, { type: 'entry.deleted', data: { id: 'e1' } });
    expect(entries).toEqual([]);
  });

  it('ignores unknown event types', () => {
    const entries = [entry('e1')];
    expect(applyListEvent(entries, { type: 'member.added', data: {} })).toBe(entries);
  });
});

describe('applyPlanEvent', () => {
  const slot = (id: string, sortOrder: number): MealSlot => ({
    id,
    householdId: 'h1',
    name: id,
    sortOrder,
    createdAt: '',
  });
  const planEntry = (id: string): PlanEntry => ({
    id,
    householdId: 'h1',
    date: '2026-11-12',
    slotId: 's1',
    text: 'Pasta',
    link: null,
    imageUrl: null,
    cookId: null,
    createdAt: '',
  });

  it('upserts and deletes plan entries', () => {
    let state = { entries: [] as PlanEntry[], slots: [] as MealSlot[] };
    state = applyPlanEvent(state, { type: 'plan.entry.created', data: planEntry('p1') });
    state = applyPlanEvent(state, {
      type: 'plan.entry.updated',
      data: { ...planEntry('p1'), text: 'Curry' },
    });
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]?.text).toBe('Curry');
    state = applyPlanEvent(state, { type: 'plan.entry.deleted', data: { id: 'p1' } });
    expect(state.entries).toEqual([]);
  });

  it('keeps slots sorted on slot events', () => {
    let state = { entries: [] as PlanEntry[], slots: [slot('s2', 20)] };
    state = applyPlanEvent(state, { type: 'slot.created', data: slot('s1', 10) });
    expect(state.slots.map((item) => item.id)).toEqual(['s1', 's2']);
    state = applyPlanEvent(state, { type: 'slot.deleted', data: { id: 's1' } });
    expect(state.slots.map((item) => item.id)).toEqual(['s2']);
  });
});

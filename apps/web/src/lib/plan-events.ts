import type { MealSlot, PlanEntry } from '../api/types';

export interface PlanState {
  entries: PlanEntry[];
  slots: MealSlot[];
}

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index === -1) {
    return [...items, item];
  }
  const next = [...items];
  next[index] = item;
  return next;
}

/** Applies one live sync event from the plan topic to local plan state. */
export function applyPlanEvent(
  state: PlanState,
  event: { type: string; data: unknown },
): PlanState {
  switch (event.type) {
    case 'plan.entry.created':
    case 'plan.entry.updated':
      return { ...state, entries: upsert(state.entries, event.data as PlanEntry) };
    case 'plan.entry.deleted': {
      const { id } = event.data as { id: string };
      return { ...state, entries: state.entries.filter((entry) => entry.id !== id) };
    }
    case 'slot.created':
    case 'slot.updated': {
      const slots = upsert(state.slots, event.data as MealSlot);
      return { ...state, slots: slots.sort((a, b) => a.sortOrder - b.sortOrder) };
    }
    case 'slot.deleted': {
      const { id } = event.data as { id: string };
      return { ...state, slots: state.slots.filter((slot) => slot.id !== id) };
    }
    default:
      return state;
  }
}

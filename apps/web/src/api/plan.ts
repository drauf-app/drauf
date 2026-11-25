import { apiFetch, apiJson } from '../auth/store';
import type { HouseholdInfo, MealSlot, PlanEntry } from './types';

export interface PlanEntryInput {
  date: string;
  /** Optional meal label; days hold 1..n entries. */
  slotId?: string;
  text?: string;
  link?: string;
  imageUrl?: string;
  cookId?: string;
}

export interface PlanEntryPatch {
  date?: string;
  /** The meal label; '' clears it, like the other optional fields. */
  slotId?: string;
  /** '' clears an optional field. */
  text?: string;
  link?: string;
  imageUrl?: string;
  cookId?: string;
}

/** A previously cooked meal from the plan history (#88). */
export interface RecipeSuggestion {
  text: string;
  link: string | null;
  imageUrl: string | null;
  /** ISO calendar date of the most recent time this was on the plan. */
  lastCookedAt: string;
  timesCooked: number;
}

export function fetchHousehold(): Promise<HouseholdInfo> {
  return apiJson<HouseholdInfo>('/api/households/me');
}

export function fetchSlots(): Promise<MealSlot[]> {
  return apiJson<MealSlot[]>('/api/plan/slots');
}

export function fetchPlanEntries(from: string, to: string): Promise<PlanEntry[]> {
  const query = new URLSearchParams({ from, to });
  return apiJson<PlanEntry[]>(`/api/plan/entries?${query.toString()}`);
}

export function fetchRecipeSuggestions(q: string): Promise<RecipeSuggestion[]> {
  const query = new URLSearchParams({ q });
  return apiJson<RecipeSuggestion[]>(`/api/plan/recipes?${query.toString()}`);
}

export function createPlanEntry(input: PlanEntryInput): Promise<PlanEntry> {
  return apiJson<PlanEntry>('/api/plan/entries', { method: 'POST', body: JSON.stringify(input) });
}

export function patchPlanEntry(entryId: string, patch: PlanEntryPatch): Promise<PlanEntry> {
  return apiJson<PlanEntry>(`/api/plan/entries/${encodeURIComponent(entryId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deletePlanEntry(entryId: string): Promise<void> {
  await apiFetch(`/api/plan/entries/${encodeURIComponent(entryId)}`, { method: 'DELETE' });
}

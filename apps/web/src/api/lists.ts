import { apiFetch, apiJson } from '../auth/store';
import type { Category, EntryView, List, ListDetail, Suggestion } from './types';

export interface AddEntryInput {
  name: string;
  quantity?: number;
  unit?: string;
  variant?: string;
  note?: string;
  categoryId?: string;
}

export interface PatchEntryInput {
  name?: string;
  quantity?: number;
  unit?: string;
  variant?: string;
  note?: string;
  categoryId?: string;
}

export function fetchLists(): Promise<List[]> {
  return apiJson<List[]>('/api/lists');
}

export function createList(name: string): Promise<List> {
  return apiJson<List>('/api/lists', { method: 'POST', body: JSON.stringify({ name }) });
}

export function fetchList(listId: string): Promise<ListDetail> {
  return apiJson<ListDetail>(`/api/lists/${encodeURIComponent(listId)}`);
}

export function patchList(
  listId: string,
  patch: { name?: string; archived?: boolean; defaultStoreId?: string | null },
): Promise<List> {
  return apiJson<List>(`/api/lists/${encodeURIComponent(listId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteList(listId: string): Promise<void> {
  await apiFetch(`/api/lists/${encodeURIComponent(listId)}`, { method: 'DELETE' });
}

export function fetchEntries(listId: string): Promise<EntryView[]> {
  return apiJson<EntryView[]>(`/api/lists/${encodeURIComponent(listId)}/entries`);
}

export function addEntry(listId: string, input: AddEntryInput): Promise<EntryView> {
  return apiJson<EntryView>(`/api/lists/${encodeURIComponent(listId)}/entries`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function patchEntry(
  listId: string,
  entryId: string,
  patch: PatchEntryInput,
): Promise<EntryView> {
  return apiJson<EntryView>(
    `/api/lists/${encodeURIComponent(listId)}/entries/${encodeURIComponent(entryId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
}

export function checkEntry(listId: string, entryId: string, checked: boolean): Promise<EntryView> {
  const action = checked ? 'check' : 'uncheck';
  return apiJson<EntryView>(
    `/api/lists/${encodeURIComponent(listId)}/entries/${encodeURIComponent(entryId)}/${action}`,
    { method: 'POST' },
  );
}

export async function deleteEntry(listId: string, entryId: string): Promise<void> {
  await apiFetch(
    `/api/lists/${encodeURIComponent(listId)}/entries/${encodeURIComponent(entryId)}`,
    { method: 'DELETE' },
  );
}

export function fetchCategories(): Promise<Category[]> {
  return apiJson<Category[]>('/api/categories');
}

export function fetchSuggestions(q: string, limit = 8): Promise<Suggestion[]> {
  const query = new URLSearchParams({ q, limit: String(limit) });
  return apiJson<Suggestion[]>(`/api/catalog/suggest?${query.toString()}`);
}

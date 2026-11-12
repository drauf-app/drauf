import { apiFetch, apiJson } from '../auth/store';
import type { StoreWithOrder } from './types';

export function fetchStores(): Promise<StoreWithOrder[]> {
  return apiJson<StoreWithOrder[]>('/api/stores');
}

export function createStore(name: string): Promise<StoreWithOrder> {
  return apiJson<StoreWithOrder>('/api/stores', { method: 'POST', body: JSON.stringify({ name }) });
}

export function renameStore(storeId: string, name: string): Promise<StoreWithOrder> {
  return apiJson<StoreWithOrder>(`/api/stores/${encodeURIComponent(storeId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function deleteStore(storeId: string): Promise<void> {
  await apiFetch(`/api/stores/${encodeURIComponent(storeId)}`, { method: 'DELETE' });
}

export function setStoreCategoryOrder(
  storeId: string,
  categoryIds: string[],
): Promise<StoreWithOrder> {
  return apiJson<StoreWithOrder>(`/api/stores/${encodeURIComponent(storeId)}/category-order`, {
    method: 'PUT',
    body: JSON.stringify({ categoryIds }),
  });
}

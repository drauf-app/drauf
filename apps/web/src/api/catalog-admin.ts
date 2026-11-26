import { apiFetch, apiJson } from '../auth/store';

/** One learned/custom item as the admin editor sees it (#111). */
export interface AdminCatalogItem {
  name: string;
  nameNormalized: string;
  count: number;
  categoryId: string | null;
  /** Effective icon: the household's pick, else the catalogue match. */
  icon: string | null;
  variants: string[];
  /** True when the base catalogue does not know this name. */
  custom: boolean;
  updatedAt: string;
}

export interface AdminCatalogItemPage {
  items: AdminCatalogItem[];
  total: number;
}

export interface AdminCatalogItemPatch {
  name?: string;
  categoryId?: string | null;
  /** '' clears the picked icon back to the catalogue match. */
  icon?: string;
  clearVariants?: boolean;
  clearLastUsed?: boolean;
}

export function fetchCatalogItems(params: {
  q?: string;
  custom?: boolean;
  offset?: number;
  limit?: number;
}): Promise<AdminCatalogItemPage> {
  const query = new URLSearchParams();
  if (params.q !== undefined && params.q !== '') query.set('q', params.q);
  if (params.custom === true) query.set('custom', 'true');
  if (params.offset !== undefined) query.set('offset', String(params.offset));
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  const suffix = query.size === 0 ? '' : `?${query.toString()}`;
  return apiJson<AdminCatalogItemPage>(`/api/catalog/items${suffix}`);
}

export function patchCatalogItem(
  nameNormalized: string,
  patch: AdminCatalogItemPatch,
): Promise<AdminCatalogItem> {
  return apiJson<AdminCatalogItem>(`/api/catalog/items/${encodeURIComponent(nameNormalized)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteCatalogItem(nameNormalized: string): Promise<void> {
  await apiFetch(`/api/catalog/items/${encodeURIComponent(nameNormalized)}`, {
    method: 'DELETE',
  });
}

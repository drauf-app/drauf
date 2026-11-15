import { apiJson } from '../auth/store';

export interface HouseholdStaples {
  /** Effective staples list: the household's own one, or the defaults. */
  staples: string[];
  /** True once the household saved its own list. */
  custom: boolean;
}

export function fetchStaples(): Promise<HouseholdStaples> {
  return apiJson<HouseholdStaples>('/api/households/staples');
}

export function saveStaples(staples: string[]): Promise<HouseholdStaples> {
  return apiJson<HouseholdStaples>('/api/households/staples', {
    method: 'PUT',
    body: JSON.stringify({ staples }),
  });
}

/** Removes the household's own list; the defaults apply again. */
export function resetStaples(): Promise<HouseholdStaples> {
  return apiJson<HouseholdStaples>('/api/households/staples', { method: 'DELETE' });
}

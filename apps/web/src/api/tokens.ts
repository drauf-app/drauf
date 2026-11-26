import type { ApiTokenScope } from '@drauf/shared';
import { apiFetch, apiJson } from '../auth/store';

export interface ApiTokenInfo {
  id: string;
  name: string;
  scopes: ApiTokenScope[];
  createdAt: string;
  lastUsedAt: string | null;
}

/** The creation response carries the plaintext token — exactly once. */
export interface CreatedApiToken extends ApiTokenInfo {
  token: string;
}

export function listApiTokens(): Promise<ApiTokenInfo[]> {
  return apiJson<ApiTokenInfo[]>('/api/auth/tokens');
}

export function createApiToken(name: string, scopes: ApiTokenScope[]): Promise<CreatedApiToken> {
  return apiJson<CreatedApiToken>('/api/auth/tokens', {
    method: 'POST',
    body: JSON.stringify({ name, scopes }),
  });
}

export async function revokeApiToken(id: string): Promise<void> {
  await apiFetch(`/api/auth/tokens/${id}`, { method: 'DELETE' });
}

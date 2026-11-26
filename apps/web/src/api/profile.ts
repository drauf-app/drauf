import { apiFetch, apiJson } from '../auth/store';
import type { PublicUser } from './types';

export function updateProfile(displayName: string): Promise<PublicUser> {
  return apiJson<PublicUser>('/api/auth/me', {
    method: 'PATCH',
    body: JSON.stringify({ displayName }),
  });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiFetch('/api/auth/password', {
    method: 'PUT',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

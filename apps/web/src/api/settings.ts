import { apiJson } from '../auth/store';

export type SettingValue = boolean | string;

/** One admin-managed instance setting; env-pinned ones arrive locked. */
export interface InstanceSetting {
  key: string;
  type: 'boolean' | 'string';
  default: SettingValue;
  envLock?: SettingValue;
  info?: string;
  stored?: SettingValue;
  effective: SettingValue;
}

export async function fetchSettings(): Promise<InstanceSetting[]> {
  const response = await apiJson<{ settings: InstanceSetting[] }>('/api/admin/settings');
  return response.settings;
}

export function updateSetting(key: string, value: SettingValue): Promise<InstanceSetting> {
  return apiJson<InstanceSetting>('/api/admin/settings', {
    method: 'PUT',
    body: JSON.stringify({ key, value }),
  });
}

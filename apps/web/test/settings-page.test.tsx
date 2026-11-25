import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { InstanceSetting } from '../src/api/settings';
import { SettingsPage } from '../src/pages/SettingsPage';
import { fakeResponse, stubFetch } from './fake-fetch';

function settingsResponse(settings: InstanceSetting[]) {
  return fakeResponse(200, { settings });
}

describe('SettingsPage', () => {
  it('shows provider toggles and saves a change', async () => {
    const puts: string[] = [];
    stubFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/admin/settings' && method === 'GET')
        return settingsResponse([
          { key: 'import.provider.cookidoo', type: 'boolean', default: true, effective: true },
          {
            key: 'categorize.enabled',
            type: 'boolean',
            default: false,
            envLock: false,
            effective: false,
          },
        ]);
      if (url === '/api/admin/settings' && method === 'PUT') {
        puts.push(String(init?.body));
        return fakeResponse(200, {
          key: 'import.provider.cookidoo',
          type: 'boolean',
          default: true,
          stored: false,
          effective: false,
        });
      }
      return undefined;
    });
    render(<SettingsPage />);
    const user = userEvent.setup();

    const toggle = (await screen.findByLabelText('Cookidoo')) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    await user.click(toggle);
    expect(JSON.parse(puts[0] ?? '{}')).toEqual({ key: 'import.provider.cookidoo', value: false });
    // The unconfigured LLM section explains itself instead of showing controls.
    expect(screen.getByText(/Nicht konfiguriert/)).toBeDefined();
  });

  it('renders env-pinned settings locked', async () => {
    stubFetch((url) =>
      url === '/api/admin/settings'
        ? settingsResponse([
            {
              key: 'import.provider.cookidoo',
              type: 'boolean',
              default: true,
              envLock: false,
              effective: false,
            },
            {
              key: 'categorize.enabled',
              type: 'boolean',
              default: true,
              effective: true,
              info: 'anthropic',
            },
            {
              key: 'categorize.model',
              type: 'string',
              default: 'claude-haiku-5-5',
              envLock: 'claude-haiku-5-5',
              effective: 'claude-haiku-5-5',
              info: 'anthropic',
            },
          ])
        : undefined,
    );
    render(<SettingsPage />);

    const provider = (await screen.findByLabelText(/Cookidoo/)) as HTMLInputElement;
    expect(provider.disabled).toBe(true);
    expect(provider.checked).toBe(false);
    const model = screen.getByLabelText(/Modell/) as HTMLInputElement;
    expect(model.disabled).toBe(true);
    expect(model.value).toBe('claude-haiku-5-5');
    expect(screen.getAllByText('über Umgebungsvariable festgelegt').length).toBeGreaterThanOrEqual(
      2,
    );
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { InstanceSetting } from '../src/api/settings';
import { SettingsPage } from '../src/pages/SettingsPage';
import { fakeResponse, stubFetch } from './fake-fetch';

function settingsResponse(settings: InstanceSetting[]) {
  return fakeResponse(200, { settings });
}

describe('SettingsPage', () => {
  it('checks for updates on demand and shows the badge', async () => {
    stubFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/admin/settings' && method === 'GET')
        return settingsResponse([
          { key: 'updates.check', type: 'boolean', default: false, effective: false },
        ]);
      if (url === '/api/admin/settings/update-check' && method === 'GET')
        return fakeResponse(200, { enabled: false, result: null });
      if (url === '/api/admin/settings/update-check' && method === 'POST')
        return fakeResponse(200, {
          enabled: false,
          result: {
            currentVersion: '0.1.3',
            latestVersion: '9.9.9',
            latestUrl: 'https://github.com/drauf-app/drauf/releases/tag/v9.9.9',
            updateAvailable: true,
            checkedAt: '2026-11-25T00:00:00.000Z',
          },
        });
      return undefined;
    });
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Jetzt prüfen' }));
    const badge = await screen.findByRole('link', { name: '9.9.9 verfügbar' });
    expect(badge.getAttribute('href')).toContain('/releases/tag/v9.9.9');
  });

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
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    const user = userEvent.setup();

    const toggle = (await screen.findByLabelText('Cookidoo')) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    await user.click(toggle);
    expect(JSON.parse(puts[0] ?? '{}')).toEqual({ key: 'import.provider.cookidoo', value: false });
    // The unconfigured LLM section explains itself instead of showing controls.
    expect(screen.getByText(/Nicht konfiguriert/)).toBeDefined();
  });

  it('offers the icon pack as a select and saves the choice (#83)', async () => {
    const puts: string[] = [];
    stubFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/admin/settings' && method === 'GET')
        return settingsResponse([
          {
            key: 'icons.pack',
            type: 'string',
            default: 'openmoji',
            values: ['openmoji', 'fluent'],
            effective: 'openmoji',
          },
        ]);
      if (url === '/api/admin/settings' && method === 'PUT') {
        puts.push(String(init?.body));
        return fakeResponse(200, {
          key: 'icons.pack',
          type: 'string',
          default: 'openmoji',
          values: ['openmoji', 'fluent'],
          stored: 'fluent',
          effective: 'fluent',
        });
      }
      return undefined;
    });
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    const user = userEvent.setup();

    const select = (await screen.findByLabelText('Icon-Stil')) as HTMLSelectElement;
    expect(select.value).toBe('openmoji');
    await user.selectOptions(select, 'Fluent (farbig)');
    expect(JSON.parse(puts[0] ?? '{}')).toEqual({ key: 'icons.pack', value: 'fluent' });
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
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

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

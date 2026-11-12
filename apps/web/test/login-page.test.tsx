import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { AuthProviders, PublicUser } from '../src/api/types';
import { LoginPage } from '../src/pages/LoginPage';
import { fakeResponse, type RouteHandler, stubFetch } from './fake-fetch';

const USER: PublicUser = {
  id: 'u1',
  username: 'kathrin',
  displayName: 'Kathrin',
  isAdmin: false,
  createdAt: '2026-11-12T00:00:00.000Z',
};

function providersRoute(providers: AuthProviders, rest?: RouteHandler) {
  return stubFetch((url, init) => {
    if (url === '/api/auth/providers') {
      return fakeResponse(200, providers);
    }
    return rest?.(url, init);
  });
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route index element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  it('shows the local form and the OIDC button when both are enabled', async () => {
    providersRoute({ localLogin: true, oidc: true });
    renderLogin();

    expect(await screen.findByLabelText('Benutzername')).toBeDefined();
    expect(screen.getByLabelText('Passwort')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Mit Single Sign-on anmelden' })).toBeDefined();
  });

  it('hides the local form when only OIDC is enabled', async () => {
    providersRoute({ localLogin: false, oidc: true });
    renderLogin();

    expect(
      await screen.findByRole('button', { name: 'Mit Single Sign-on anmelden' }),
    ).toBeDefined();
    expect(screen.queryByLabelText('Benutzername')).toBeNull();
  });

  it('signs in and navigates home', async () => {
    providersRoute({ localLogin: true, oidc: false }, (url) =>
      url === '/api/auth/login'
        ? fakeResponse(200, { accessToken: 'a', refreshToken: 'r', user: USER })
        : undefined,
    );
    renderLogin();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Benutzername'), 'kathrin');
    await user.type(screen.getByLabelText('Passwort'), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));

    expect(await screen.findByText('HOME')).toBeDefined();
  });

  it('shows the mapped error message for rejected credentials', async () => {
    providersRoute({ localLogin: true, oidc: false }, (url) =>
      url === '/api/auth/login' ? fakeResponse(401, { error: 'invalid_credentials' }) : undefined,
    );
    renderLogin();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Benutzername'), 'kathrin');
    await user.type(screen.getByLabelText('Passwort'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));

    expect(await screen.findByText('Benutzername oder Passwort ist falsch.')).toBeDefined();
  });
});

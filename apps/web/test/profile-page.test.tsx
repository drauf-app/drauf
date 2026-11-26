import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { PublicUser } from '../src/api/types';
import { loginLocal, resetAuthForTests } from '../src/auth/store';
import { Avatar } from '../src/components/Avatar';
import { ProfilePage } from '../src/pages/ProfilePage';
import { fakeResponse, type RouteHandler, stubFetch } from './fake-fetch';

function publicUser(overrides: Partial<PublicUser> = {}): PublicUser {
  return {
    id: 'user-1',
    username: 'resi',
    displayName: 'Resi',
    isAdmin: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    avatarUrl: null,
    hasPassword: true,
    ...overrides,
  };
}

async function signIn(user: PublicUser, extra: RouteHandler = () => undefined) {
  const requests = stubFetch((url, init) => {
    if (url === '/api/auth/login' && init?.method === 'POST') {
      return fakeResponse(200, { accessToken: 'at', refreshToken: 'rt', user });
    }
    return extra(url, init);
  });
  await loginLocal('resi', 'correct-horse-battery');
  return requests;
}

describe('ProfilePage', () => {
  afterEach(() => {
    resetAuthForTests();
  });

  it('saves a trimmed display name and reflects it in the auth store', async () => {
    const requests = await signIn(publicUser(), (url, init) => {
      if (url === '/api/auth/me' && init?.method === 'PATCH') {
        return fakeResponse(200, publicUser({ displayName: 'Resi B.' }));
      }
      return undefined;
    });
    render(<ProfilePage />);
    const user = userEvent.setup();

    const input = screen.getByLabelText('Anzeigename');
    await user.clear(input);
    await user.type(input, '  Resi B.  ');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByText('Gespeichert.')).toBeTruthy();
    const patch = requests.find((request) => request.init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ displayName: 'Resi B.' });
  });

  it('changes the password and maps server errors to German', async () => {
    let attempt = 0;
    await signIn(publicUser(), (url, init) => {
      if (url === '/api/auth/password' && init?.method === 'PUT') {
        attempt += 1;
        return attempt === 1
          ? fakeResponse(403, { error: 'invalid_password' })
          : fakeResponse(204, {});
      }
      return undefined;
    });
    render(<ProfilePage />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Aktuelles Passwort'), 'wrong-password');
    await user.type(screen.getByLabelText('Neues Passwort'), 'brand-new-password');
    await user.type(screen.getByLabelText('Neues Passwort wiederholen'), 'does-not-match');
    const submit = screen.getByRole('button', { name: 'Passwort ändern' });
    await user.click(submit);
    expect(await screen.findByText('Die Passwörter stimmen nicht überein.')).toBeTruthy();

    await user.clear(screen.getByLabelText('Neues Passwort wiederholen'));
    await user.type(screen.getByLabelText('Neues Passwort wiederholen'), 'brand-new-password');
    await user.click(submit);
    expect(await screen.findByText('Das aktuelle Passwort ist falsch.')).toBeTruthy();

    await user.click(submit);
    expect(await screen.findByText('Passwort geändert.')).toBeTruthy();
    expect((screen.getByLabelText('Aktuelles Passwort') as HTMLInputElement).value).toBe('');
  });

  it('hides the password section for OIDC-only accounts', async () => {
    await signIn(publicUser({ hasPassword: false }));
    render(<ProfilePage />);
    expect(screen.getByLabelText('Anzeigename')).toBeTruthy();
    expect(screen.queryByText('Passwort ändern')).toBeNull();
  });
});

describe('Avatar', () => {
  it('renders the image when a URL is set and initials otherwise', () => {
    const { container, rerender } = render(
      <Avatar name="Resi" userId="user-1" url="/avatars/abc.png" />,
    );
    expect(container.querySelector('img.avatar')?.getAttribute('src')).toBe('/avatars/abc.png');

    rerender(<Avatar name="resi" userId="user-1" url={null} />);
    const initials = container.querySelector('span.avatar');
    expect(initials?.textContent).toBe('R');
    expect(initials?.getAttribute('style')).toContain('background-color');
  });
});

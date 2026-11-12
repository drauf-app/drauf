import { type FormEvent, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import type { AuthProviders } from '../api/types';
import { ApiError, deviceName, loginLocal, useAuth } from '../auth/store';
import { type Messages, useT } from '../i18n';

const KNOWN_LOGIN_ERRORS = [
  'invalid_credentials',
  'account_locked',
  'local_login_disabled',
] as const;
type KnownLoginError = (typeof KNOWN_LOGIN_ERRORS)[number];

function loginErrorMessage(err: unknown, t: Messages): string {
  if (err instanceof ApiError) {
    if ((KNOWN_LOGIN_ERRORS as readonly string[]).includes(err.code)) {
      return t.login.errors[err.code as KnownLoginError];
    }
    return t.login.errors.failed;
  }
  return t.login.errors.network;
}

export function LoginPage() {
  const t = useT();
  const auth = useAuth();
  const navigate = useNavigate();
  const [providers, setProviders] = useState<AuthProviders>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/providers')
      .then((response) => response.json() as Promise<AuthProviders>)
      .then((result) => {
        if (!cancelled) setProviders(result);
      })
      .catch(() => {
        if (!cancelled) setError(t.login.errors.network);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  if (auth.status === 'signedIn') {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await loginLocal(username, password);
      await navigate('/', { replace: true });
    } catch (err) {
      setError(loginErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  function startOidcLogin(): void {
    const query = new URLSearchParams({ redirect: '/auth/callback', deviceName: deviceName() });
    window.location.assign(`/api/auth/oidc/login?${query.toString()}`);
  }

  return (
    <div className="screen-center">
      <div className="card login-card">
        <h1 className="brand">{t.appName}</h1>
        <h2>{t.login.title}</h2>
        {providers?.localLogin === true && (
          <form onSubmit={(event) => void onSubmit(event)}>
            <label>
              {t.login.username}
              <input
                type="text"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label>
              {t.login.password}
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button type="submit" className="primary" disabled={busy}>
              {t.login.submit}
            </button>
          </form>
        )}
        {providers?.localLogin === true && providers.oidc && (
          <div className="login-divider">{t.login.or}</div>
        )}
        {providers?.oidc === true && (
          <button type="button" className="secondary" onClick={startOidcLogin}>
            {t.login.oidc}
          </button>
        )}
        {providers !== undefined && !providers.localLogin && !providers.oidc && (
          <p className="error">{t.login.errors.no_methods}</p>
        )}
        {error !== undefined && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

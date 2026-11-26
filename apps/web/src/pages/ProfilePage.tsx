import { API_TOKEN_NAME_MAX_LENGTH, API_TOKEN_SCOPES, type ApiTokenScope } from '@drauf/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { changePassword, updateProfile } from '../api/profile';
import { type ApiTokenInfo, createApiToken, listApiTokens, revokeApiToken } from '../api/tokens';
import { ApiError, setCurrentUser, useAuth } from '../auth/store';
import { Avatar } from '../components/Avatar';
import { useT } from '../i18n';

/** Per-user settings behind the header's user link (#98). */
export function ProfilePage() {
  const t = useT();
  const auth = useAuth();
  const user = auth.user;
  if (user === undefined) {
    return null;
  }

  return (
    <section className="profile">
      <h2>{t.profile.title}</h2>
      <div className="profile-head">
        <Avatar name={user.displayName} userId={user.id} url={user.avatarUrl} size="large" />
        <div>
          <strong>{user.displayName}</strong>
          <p className="profile-username">
            {t.profile.username}: {user.username}
          </p>
        </div>
      </div>
      <DisplayNameForm current={user.displayName} />
      {user.hasPassword && <PasswordForm />}
      <TokensSection />
    </section>
  );
}

const TOKEN_DATE_FORMAT = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** API tokens for integrations (#97): create, one-time reveal, revoke. */
function TokensSection() {
  const t = useT();
  const [tokens, setTokens] = useState<ApiTokenInfo[]>([]);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiTokenScope[]>([]);
  const [revealed, setRevealed] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listApiTokens()
      .then(setTokens)
      .catch(() => setFailed(true));
  }, []);

  function toggleScope(scope: ApiTokenScope, checked: boolean): void {
    setScopes((current) =>
      checked ? [...current, scope] : current.filter((entry) => entry !== scope),
    );
  }

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFailed(false);
    try {
      const { token, ...info } = await createApiToken(name.trim(), scopes);
      setTokens((current) => [...current, info]);
      setRevealed({ name: info.name, token });
      setCopied(false);
      setName('');
      setScopes([]);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(id: string): Promise<void> {
    setFailed(false);
    try {
      await revokeApiToken(id);
      setTokens((current) => current.filter((token) => token.id !== id));
    } catch {
      setFailed(true);
    }
  }

  async function onCopy(token: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      // Clipboard unavailable (permissions, http): the token stays selectable.
    }
  }

  return (
    <section className="profile-form profile-tokens">
      <h3>{t.profile.tokens.title}</h3>
      <p className="profile-tokens-intro">{t.profile.tokens.intro}</p>

      {revealed !== null && (
        <div className="token-reveal">
          <strong>
            {t.profile.tokens.revealTitle}: {revealed.name}
          </strong>
          <p className="profile-tokens-intro">{t.profile.tokens.revealHint}</p>
          <code className="token-value">{revealed.token}</code>
          <div className="profile-form-actions">
            <button type="button" onClick={() => void onCopy(revealed.token)}>
              {t.profile.tokens.copy}
            </button>
            <button type="button" onClick={() => setRevealed(null)}>
              {t.profile.tokens.done}
            </button>
            {copied && <span className="profile-ok">{t.profile.tokens.copied}</span>}
          </div>
        </div>
      )}

      {tokens.length === 0 ? (
        <p className="profile-tokens-intro">{t.profile.tokens.empty}</p>
      ) : (
        <ul className="token-list">
          {tokens.map((token) => (
            <li key={token.id} className="token-row">
              <div className="token-row-main">
                <strong>{token.name}</strong>
                <span className="token-scopes">
                  {token.scopes.map((scope) => t.profile.tokens.scopeLabels[scope]).join(', ')}
                </span>
                <span className="token-dates">
                  {t.profile.tokens.created} {TOKEN_DATE_FORMAT.format(new Date(token.createdAt))}
                  {' · '}
                  {t.profile.tokens.lastUsed}{' '}
                  {token.lastUsedAt === null
                    ? t.profile.tokens.never
                    : TOKEN_DATE_FORMAT.format(new Date(token.lastUsedAt))}
                </span>
              </div>
              <button type="button" onClick={() => void onRevoke(token.id)}>
                {t.profile.tokens.revoke}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="token-create" onSubmit={(event) => void onCreate(event)}>
        <label>
          {t.profile.tokens.name}
          <input
            type="text"
            value={name}
            maxLength={API_TOKEN_NAME_MAX_LENGTH}
            placeholder={t.profile.tokens.namePlaceholder}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <fieldset className="token-scope-picker">
          <legend>{t.profile.tokens.scopes}</legend>
          {API_TOKEN_SCOPES.map((scope) => (
            <label key={scope} className="token-scope-option">
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={(event) => toggleScope(scope, event.target.checked)}
              />
              {t.profile.tokens.scopeLabels[scope]}
            </label>
          ))}
        </fieldset>
        <div className="profile-form-actions">
          <button type="submit" disabled={name.trim() === '' || scopes.length === 0 || busy}>
            {t.profile.tokens.create}
          </button>
          {failed && <span className="error">{t.common.error}</span>}
        </div>
      </form>
    </section>
  );
}

function DisplayNameForm({ current }: { current: string }) {
  const t = useT();
  const [name, setName] = useState(current);
  const [message, setMessage] = useState<'saved' | 'error' | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = name.trim() !== current && name.trim() !== '';

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const user = await updateProfile(name.trim());
      setCurrentUser(user);
      setName(user.displayName);
      setMessage('saved');
    } catch {
      setMessage('error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="profile-form" onSubmit={(event) => void onSubmit(event)}>
      <label>
        {t.profile.displayName}
        <input
          type="text"
          value={name}
          maxLength={128}
          onChange={(event) => {
            setName(event.target.value);
            setMessage(null);
          }}
        />
      </label>
      <div className="profile-form-actions">
        <button type="submit" disabled={!changed || busy}>
          {t.common.save}
        </button>
        {message === 'saved' && <span className="profile-ok">{t.profile.saved}</span>}
        {message === 'error' && <span className="error">{t.common.error}</span>}
      </div>
    </form>
  );
}

function PasswordForm() {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setMessage(null);
    setChanged(false);
    if (next !== repeat) {
      setMessage(t.profile.password.mismatch);
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setRepeat('');
      setChanged(true);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : '';
      const known = t.profile.password.errors[code as keyof typeof t.profile.password.errors];
      setMessage(known ?? t.common.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="profile-form" onSubmit={(event) => void onSubmit(event)}>
      <h3>{t.profile.password.title}</h3>
      <label>
        {t.profile.password.current}
        <input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
      </label>
      <label>
        {t.profile.password.new}
        <input
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
      </label>
      <label>
        {t.profile.password.repeat}
        <input
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
        />
      </label>
      <div className="profile-form-actions">
        <button type="submit" disabled={current === '' || next === '' || repeat === '' || busy}>
          {t.profile.password.submit}
        </button>
        {changed && <span className="profile-ok">{t.profile.password.changed}</span>}
        {message !== null && <span className="error">{message}</span>}
      </div>
    </form>
  );
}

import { type FormEvent, useState } from 'react';
import { changePassword, updateProfile } from '../api/profile';
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

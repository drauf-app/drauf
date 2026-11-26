import { NavLink, Outlet, useNavigate } from 'react-router';
import { logout, useAuth } from '../auth/store';
import { useT } from '../i18n';
import { Avatar } from './Avatar';

export function Layout() {
  const t = useT();
  const auth = useAuth();
  const navigate = useNavigate();

  async function onLogout(): Promise<void> {
    await logout();
    await navigate('/login', { replace: true });
  }

  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">
          <img className="brand-logo" src="/icon.svg" alt="" />
          {t.appName}
        </span>
        <nav>
          <NavLink to="/" end>
            {t.nav.lists}
          </NavLink>
          <NavLink to="/plan">{t.nav.plan}</NavLink>
          <NavLink to="/stores">{t.nav.stores}</NavLink>
          <NavLink to="/import">{t.nav.import}</NavLink>
          {auth.user?.isAdmin === true && <NavLink to="/settings">{t.nav.settings}</NavLink>}
        </nav>
        <div className="user-menu">
          {auth.user !== undefined && (
            <NavLink className="user-link" to="/profile" title={t.profile.title}>
              <Avatar
                name={auth.user.displayName}
                userId={auth.user.id}
                url={auth.user.avatarUrl}
              />
              <span className="user-name">{auth.user.displayName}</span>
            </NavLink>
          )}
          <button type="button" onClick={() => void onLogout()}>
            {t.common.logout}
          </button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

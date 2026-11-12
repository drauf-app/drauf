import { NavLink, Outlet, useNavigate } from 'react-router';
import { logout, useAuth } from '../auth/store';
import { useT } from '../i18n';

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
        <span className="brand">{t.appName}</span>
        <nav>
          <NavLink to="/" end>
            {t.nav.lists}
          </NavLink>
          <NavLink to="/plan">{t.nav.plan}</NavLink>
          <NavLink to="/stores">{t.nav.stores}</NavLink>
        </nav>
        <div className="user-menu">
          <span className="user-name">{auth.user?.displayName}</span>
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

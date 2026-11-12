import { Navigate, Outlet } from 'react-router';
import { useAuth } from '../auth/store';
import { useT } from '../i18n';

export function RequireAuth() {
  const auth = useAuth();
  const t = useT();
  if (auth.status === 'loading') {
    return <div className="screen-center">{t.common.loading}</div>;
  }
  if (auth.status === 'signedOut') {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

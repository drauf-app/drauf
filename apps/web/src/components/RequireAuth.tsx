import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router';
import { useAuth } from '../auth/store';
import { useT } from '../i18n';
import { loadIconRegistry } from '../lib/icon-registry';

export function RequireAuth() {
  const auth = useAuth();
  const t = useT();
  useEffect(() => {
    if (auth.status === 'signedIn') {
      // Instance icons are needed everywhere items render (#71).
      void loadIconRegistry();
    }
  }, [auth.status]);
  if (auth.status === 'loading') {
    return <div className="screen-center">{t.common.loading}</div>;
  }
  if (auth.status === 'signedOut') {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

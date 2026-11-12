import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { exchangeOidcCode } from '../auth/store';
import { useT } from '../i18n';

/** Landing page for the server's OIDC callback redirect (?login_code=…). */
export function AuthCallbackPage() {
  const t = useT();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // The login code is one-time; guard against StrictMode's double effect.
    if (started.current) {
      return;
    }
    started.current = true;
    const code = new URLSearchParams(window.location.search).get('login_code');
    if (code === null) {
      void navigate('/login', { replace: true });
      return;
    }
    exchangeOidcCode(code)
      .then(() => navigate('/', { replace: true }))
      .catch(() => setFailed(true));
  }, [navigate]);

  return (
    <div className="screen-center">
      {failed ? (
        <div className="card">
          <p className="error">{t.authCallback.failed}</p>
          <Link to="/login">{t.authCallback.backToLogin}</Link>
        </div>
      ) : (
        <p>{t.authCallback.completing}</p>
      )}
    </div>
  );
}

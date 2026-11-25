import { useEffect, useState } from 'react';
import { fetchVersion, releasesUrl, type ServerVersion } from '../api/version';

/** Quiet "Drauf 0.1.3 (abc1234)" line linking to the release notes (#74). */
export function VersionLine() {
  const [version, setVersion] = useState<ServerVersion>();

  useEffect(() => {
    let cancelled = false;
    void fetchVersion().then((result) => {
      if (!cancelled && result !== undefined) setVersion(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (version === undefined) {
    return null;
  }
  return (
    <p className="version-line">
      <a href={releasesUrl(version.version)} target="_blank" rel="noreferrer">
        Drauf {version.version}
        {version.commit !== null ? ` (${version.commit.slice(0, 7)})` : ''}
      </a>
    </p>
  );
}

/** Which build the server runs (#74); public, so plain fetch (login page). */
export interface ServerVersion {
  version: string;
  commit: string | null;
}

let cached: Promise<ServerVersion | undefined> | undefined;

export function fetchVersion(): Promise<ServerVersion | undefined> {
  cached ??= fetch('/api/version')
    .then((response) => (response.ok ? (response.json() as Promise<ServerVersion>) : undefined))
    .catch(() => undefined);
  return cached;
}

export function releasesUrl(version: string): string {
  return /^\d+\.\d+\.\d+$/.test(version)
    ? `https://github.com/drauf-app/drauf/releases/tag/v${version}`
    : 'https://github.com/drauf-app/drauf/releases';
}

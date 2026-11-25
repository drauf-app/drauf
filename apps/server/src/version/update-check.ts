/**
 * Update availability against the GitHub releases of this project (#74).
 * Server-side only (clients never contact third parties), cached, and
 * failure-silent: an unreachable GitHub affects nothing but the hint.
 * Whether the daily check runs at all is an admin setting (default off);
 * the manual "Jetzt prüfen" button always may.
 */
const RELEASES_API = 'https://api.github.com/repos/drauf-app/drauf/releases/latest';
const RELEASES_PAGE = 'https://github.com/drauf-app/drauf/releases';
const MIN_INTERVAL_MS = 15 * 60 * 1000;
export const DAILY_MS = 24 * 60 * 60 * 1000;

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  latestUrl: string;
  updateAvailable: boolean;
  checkedAt: string;
}

export interface UpdateChecker {
  cached(): UpdateCheckResult | undefined;
  /** Refreshes when the cache is older than maxAgeMs; never throws. */
  check(maxAgeMs?: number): Promise<UpdateCheckResult | undefined>;
}

function parseSemver(version: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (match === null) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True only when both sides are releases and latest is really newer. */
export function isNewer(latest: string, current: string): boolean {
  const latestParts = parseSemver(latest);
  const currentParts = parseSemver(current);
  if (latestParts === null || currentParts === null) {
    // dev or main@<sha> builds have no meaningful ordering: never nag.
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    const difference = (latestParts[index] ?? 0) - (currentParts[index] ?? 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }
  return false;
}

export function createUpdateChecker(options: {
  currentVersion: string;
  fetchImpl?: typeof fetch;
}): UpdateChecker {
  const fetchImpl = options.fetchImpl ?? fetch;
  let last: UpdateCheckResult | undefined;
  let lastAttempt = 0;

  return {
    cached() {
      return last;
    },
    async check(maxAgeMs = 0) {
      const now = Date.now();
      if (last !== undefined && now - Date.parse(last.checkedAt) < maxAgeMs) {
        return last;
      }
      // Even manual checks keep a floor between real requests.
      if (now - lastAttempt < MIN_INTERVAL_MS && last !== undefined) {
        return last;
      }
      if (now - lastAttempt < MIN_INTERVAL_MS) {
        return undefined;
      }
      lastAttempt = now;
      try {
        const response = await fetchImpl(RELEASES_API, {
          signal: AbortSignal.timeout(10_000),
          headers: {
            accept: 'application/vnd.github+json',
            'user-agent': 'Drauf (self-hosted update check)',
          },
        });
        if (!response.ok) {
          return last;
        }
        const body = (await response.json()) as { tag_name?: string; html_url?: string };
        if (typeof body.tag_name !== 'string' || body.tag_name === '') {
          return last;
        }
        last = {
          currentVersion: options.currentVersion,
          latestVersion: body.tag_name.replace(/^v/, ''),
          latestUrl: typeof body.html_url === 'string' ? body.html_url : RELEASES_PAGE,
          updateAvailable: isNewer(body.tag_name, options.currentVersion),
          checkedAt: new Date(now).toISOString(),
        };
        return last;
      } catch {
        return last;
      }
    },
  };
}

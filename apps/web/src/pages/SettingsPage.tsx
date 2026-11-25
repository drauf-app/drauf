import { useEffect, useState } from 'react';
import { fetchSettings, type InstanceSetting, updateSetting } from '../api/settings';
import { fetchVersion, releasesUrl, type ServerVersion } from '../api/version';
import { apiJson } from '../auth/store';
import { useT } from '../i18n';
import { refreshIconRegistry } from '../lib/icon-registry';

const PROVIDER_PREFIX = 'import.provider.';

function providerLabel(setting: InstanceSetting): string {
  const id = setting.key.slice(PROVIDER_PREFIX.length);
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * Admin-managed runtime settings (#73). Environment-pinned settings render
 * disabled with a hint — the environment stays the single source of truth
 * for anything it sets.
 */
export function SettingsPage() {
  const t = useT();
  const [settings, setSettings] = useState<InstanceSetting[]>();
  const [error, setError] = useState(false);
  const [version, setVersion] = useState<ServerVersion>();
  const [update, setUpdate] = useState<UpdateState>();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchVersion().then((result) => {
      if (!cancelled) setVersion(result);
    });
    apiJson<UpdateState>('/api/admin/settings/update-check')
      .then((state) => {
        if (!cancelled) setUpdate(state);
      })
      .catch(() => {});
    fetchSettings()
      .then((result) => {
        if (!cancelled) setSettings(result);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function save(key: string, value: boolean | string): void {
    setError(false);
    updateSetting(key, value)
      .then((updated) => {
        setSettings((previous) =>
          (previous ?? []).map((item) => (item.key === updated.key ? updated : item)),
        );
        if (key === 'icons.pack') {
          // Icons on this page (and everywhere) follow the new pack right away.
          void refreshIconRegistry();
        }
      })
      .catch(() => setError(true));
  }

  if (settings === undefined) {
    return <p className="placeholder">{error ? t.common.error : t.common.loading}</p>;
  }

  const providers = settings.filter((setting) => setting.key.startsWith(PROVIDER_PREFIX));
  const updatesToggle = settings.find((setting) => setting.key === 'updates.check');

  function checkNow(): void {
    setChecking(true);
    apiJson<UpdateState>('/api/admin/settings/update-check', { method: 'POST' })
      .then(setUpdate)
      .catch(() => setError(true))
      .finally(() => setChecking(false));
  }
  const categorizeEnabled = settings.find((setting) => setting.key === 'categorize.enabled');
  const categorizeModel = settings.find((setting) => setting.key === 'categorize.model');
  const iconsPack = settings.find((setting) => setting.key === 'icons.pack');

  function renderToggle(setting: InstanceSetting, label: string) {
    const locked = setting.envLock !== undefined;
    return (
      <label key={setting.key} className="setting-row">
        <span className="setting-label">
          {label}
          {locked && <span className="setting-locked">{t.settings.lockedByEnv}</span>}
        </span>
        <input
          type="checkbox"
          checked={setting.effective === true}
          disabled={locked}
          onChange={(event) => save(setting.key, event.target.checked)}
        />
      </label>
    );
  }

  return (
    <section>
      <h1>{t.settings.title}</h1>
      <p className="placeholder">{t.settings.intro}</p>

      <h2>{t.settings.importSection}</h2>
      <div className="settings-group">
        {providers.map((setting) => renderToggle(setting, providerLabel(setting)))}
      </div>

      <h2>{t.settings.categorizeSection}</h2>
      {categorizeEnabled !== undefined && categorizeEnabled.envLock === false ? (
        <p className="placeholder">{t.settings.categorizeUnconfigured}</p>
      ) : (
        <div className="settings-group">
          {categorizeEnabled !== undefined &&
            renderToggle(categorizeEnabled, t.settings.categorizeEnabled)}
          {categorizeModel !== undefined && (
            <label className="setting-row setting-row-text">
              <span className="setting-label">
                {t.settings.categorizeModel}
                {categorizeModel.envLock !== undefined && (
                  <span className="setting-locked">{t.settings.lockedByEnv}</span>
                )}
              </span>
              <input
                type="text"
                defaultValue={String(categorizeModel.effective)}
                maxLength={100}
                disabled={categorizeModel.envLock !== undefined}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value !== '' && value !== String(categorizeModel.effective)) {
                    save(categorizeModel.key, value);
                  }
                }}
              />
            </label>
          )}
        </div>
      )}

      {iconsPack !== undefined && (
        <>
          <h2>{t.settings.iconsSection}</h2>
          <div className="settings-group">
            <label className="setting-row">
              <span className="setting-label">
                {t.settings.iconsPack}
                {iconsPack.envLock !== undefined && (
                  <span className="setting-locked">{t.settings.lockedByEnv}</span>
                )}
              </span>
              <select
                value={String(iconsPack.effective)}
                disabled={iconsPack.envLock !== undefined}
                onChange={(event) => save(iconsPack.key, event.target.value)}
              >
                {(iconsPack.values ?? []).map((value) => (
                  <option key={value} value={value}>
                    {t.settings.packNames[value as keyof typeof t.settings.packNames] ?? value}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      )}

      <h2>{t.settings.updatesSection}</h2>
      <div className="settings-group">
        {version !== undefined && (
          <p className="setting-row">
            <span className="setting-label">{t.settings.versionLabel}</span>
            <a href={releasesUrl(version.version)} target="_blank" rel="noreferrer">
              {version.version}
              {version.commit !== null ? ` (${version.commit.slice(0, 7)})` : ''}
            </a>
          </p>
        )}
        {updatesToggle !== undefined && renderToggle(updatesToggle, t.settings.updatesToggle)}
        <div className="setting-row">
          <button type="button" disabled={checking} onClick={checkNow}>
            {t.settings.checkNow}
          </button>
          {update?.result != null &&
            (update.result.updateAvailable ? (
              <a
                className="update-available"
                href={update.result.latestUrl}
                target="_blank"
                rel="noreferrer"
              >
                {update.result.latestVersion} {t.settings.updateAvailable}
              </a>
            ) : (
              <span className="setting-locked">{t.settings.upToDate}</span>
            ))}
        </div>
      </div>

      {error && <p className="error">{t.common.error}</p>}
    </section>
  );
}

interface UpdateState {
  enabled: boolean;
  result: {
    currentVersion: string;
    latestVersion: string;
    latestUrl: string;
    updateAvailable: boolean;
    checkedAt: string;
  } | null;
}

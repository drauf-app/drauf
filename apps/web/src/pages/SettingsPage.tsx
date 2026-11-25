import { useEffect, useState } from 'react';
import { fetchSettings, type InstanceSetting, updateSetting } from '../api/settings';
import { useT } from '../i18n';

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

  useEffect(() => {
    let cancelled = false;
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
      .then((updated) =>
        setSettings((previous) =>
          (previous ?? []).map((item) => (item.key === updated.key ? updated : item)),
        ),
      )
      .catch(() => setError(true));
  }

  if (settings === undefined) {
    return <p className="placeholder">{error ? t.common.error : t.common.loading}</p>;
  }

  const providers = settings.filter((setting) => setting.key.startsWith(PROVIDER_PREFIX));
  const categorizeEnabled = settings.find((setting) => setting.key === 'categorize.enabled');
  const categorizeModel = settings.find((setting) => setting.key === 'categorize.model');

  function renderToggle(setting: InstanceSetting, label: string) {
    const locked = setting.envLock !== undefined;
    return (
      <label key={setting.key} className="setting-row">
        <input
          type="checkbox"
          checked={setting.effective === true}
          disabled={locked}
          onChange={(event) => save(setting.key, event.target.checked)}
        />
        <span className="setting-label">
          {label}
          {locked && <span className="setting-locked">{t.settings.lockedByEnv}</span>}
        </span>
      </label>
    );
  }

  return (
    <section>
      <h1>{t.settings.title}</h1>
      <p className="placeholder">{t.settings.intro}</p>

      <h2>{t.settings.importSection}</h2>
      {providers.map((setting) => renderToggle(setting, providerLabel(setting)))}

      <h2>{t.settings.categorizeSection}</h2>
      {categorizeEnabled !== undefined && categorizeEnabled.envLock === false ? (
        <p className="placeholder">{t.settings.categorizeUnconfigured}</p>
      ) : (
        <>
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
        </>
      )}

      {error && <p className="error">{t.common.error}</p>}
    </section>
  );
}

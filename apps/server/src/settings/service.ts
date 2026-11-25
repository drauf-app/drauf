import type { RecipeProvider } from '@drauf/providers';
import type { Config } from '../config.js';
import type { Database } from '../db/index.js';
import { listInstanceSettings, upsertInstanceSetting } from '../db/repositories.js';

export type SettingValue = boolean | string;

/**
 * One runtime-changeable instance setting (#73). Environment variables keep
 * bootstrap and secrets; these are the operational toggles an admin may
 * flip without a redeploy. The precedence rule is deliberately boring: a
 * set environment variable wins and the setting shows as locked.
 */
export interface SettingDefinition {
  key: string;
  type: 'boolean' | 'string';
  default: SettingValue;
  /** Present when an environment variable pins this setting. */
  envLock?: SettingValue;
  /** Context for the UI (e.g. the configured LLM provider). */
  info?: string;
}

export interface ResolvedSetting extends SettingDefinition {
  /** The stored value, when an admin saved one. */
  stored?: SettingValue;
  /** envLock ?? stored ?? default — what the server acts on. */
  effective: SettingValue;
}

export class SettingError extends Error {
  readonly code: 'unknown_setting' | 'locked_setting' | 'invalid_value';

  constructor(code: 'unknown_setting' | 'locked_setting' | 'invalid_value') {
    super(code);
    this.code = code;
  }
}

/**
 * The known settings, derived from the server's wiring: one toggle per
 * registered recipe provider (env-disabled ones locked off) and the LLM
 * categorization switch + model (locked while CATEGORIZE_MODEL pins it,
 * locked off while no provider is configured at all).
 */
export function buildSettingDefinitions(
  config: Config,
  providers: RecipeProvider[],
): SettingDefinition[] {
  const definitions: SettingDefinition[] = providers.map((provider) => ({
    key: `import.provider.${provider.id}`,
    type: 'boolean' as const,
    default: true,
    ...(config.disabledProviders.includes(provider.id) ? { envLock: false } : {}),
    info: provider.id,
  }));
  if (config.categorize === undefined) {
    definitions.push({
      key: 'categorize.enabled',
      type: 'boolean',
      default: false,
      // Not configured: nothing to turn on; CATEGORIZE_LLM is the bootstrap.
      envLock: false,
    });
  } else {
    definitions.push(
      {
        key: 'categorize.enabled',
        type: 'boolean',
        default: true,
        info: config.categorize.provider,
      },
      {
        key: 'categorize.model',
        type: 'string',
        default: config.categorize.model,
        // The model came from the environment when CATEGORIZE_MODEL is set;
        // the anthropic default is editable.
        ...(config.categorize.modelFromEnv ? { envLock: config.categorize.model } : {}),
        info: config.categorize.provider,
      },
    );
  }
  definitions.push({
    key: 'updates.check',
    type: 'boolean',
    // Privacy by default: the daily check is an explicit admin choice;
    // the manual button works regardless.
    default: false,
    ...(config.updateCheck === undefined ? {} : { envLock: config.updateCheck }),
  });
  return definitions;
}

export interface SettingsService {
  list(): Promise<ResolvedSetting[]>;
  effective(key: string): Promise<SettingValue>;
  /** Validates key, lock and type; persists and updates the cache. */
  set(key: string, value: SettingValue): Promise<ResolvedSetting>;
  providerEnabled(providerId: string): Promise<boolean>;
}

export function createSettingsService(
  database: Database,
  definitions: SettingDefinition[],
): SettingsService {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  // Reads sit in the import request path: load once, update on write.
  let cache: Map<string, SettingValue> | undefined;

  async function stored(): Promise<Map<string, SettingValue>> {
    if (cache === undefined) {
      cache = new Map();
      for (const row of await listInstanceSettings(database)) {
        const definition = byKey.get(row.key);
        if (definition === undefined) {
          continue; // Keys from older versions stay ignored, not fatal.
        }
        try {
          const value: unknown = JSON.parse(row.value);
          if (typeof value === definition.type) {
            cache.set(row.key, value as SettingValue);
          }
        } catch {
          // Unreadable rows fall back to the default.
        }
      }
    }
    return cache;
  }

  function resolve(
    definition: SettingDefinition,
    values: Map<string, SettingValue>,
  ): ResolvedSetting {
    const storedValue = values.get(definition.key);
    return {
      ...definition,
      ...(storedValue === undefined ? {} : { stored: storedValue }),
      effective: definition.envLock ?? storedValue ?? definition.default,
    };
  }

  return {
    async list() {
      const values = await stored();
      return definitions.map((definition) => resolve(definition, values));
    },
    async effective(key) {
      const definition = byKey.get(key);
      if (definition === undefined) {
        throw new SettingError('unknown_setting');
      }
      return resolve(definition, await stored()).effective;
    },
    async set(key, value) {
      const definition = byKey.get(key);
      if (definition === undefined) {
        throw new SettingError('unknown_setting');
      }
      if (definition.envLock !== undefined) {
        throw new SettingError('locked_setting');
      }
      if (typeof value !== definition.type) {
        throw new SettingError('invalid_value');
      }
      if (definition.type === 'string' && (value as string).length > 200) {
        throw new SettingError('invalid_value');
      }
      await upsertInstanceSetting(database, key, JSON.stringify(value));
      (await stored()).set(key, value);
      return resolve(definition, await stored());
    },
    async providerEnabled(providerId) {
      const definition = byKey.get(`import.provider.${providerId}`);
      if (definition === undefined) {
        return false;
      }
      return (await this.effective(definition.key)) === true;
    },
  };
}

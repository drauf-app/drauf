import { join } from 'node:path';
import { envSchema } from 'env-schema';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export type DatabaseConfig =
  | { dialect: 'postgres'; url: string }
  | { dialect: 'sqlite'; file: string };

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string | undefined;
  scopes: string;
  groupsClaim: string;
  adminGroup: string | undefined;
  /** Allowed non-relative client redirects (e.g. an app scheme like drauf://auth). */
  appRedirects: string[];
}

/**
 * Optional LLM category guessing (#22). Off unless configured; enabling it
 * means item names are sent to the configured endpoint.
 */
export type CategorizeConfig =
  | { provider: 'anthropic'; apiKey: string; model: string; modelFromEnv: boolean }
  | {
      provider: 'openai';
      baseUrl: string;
      apiKey: string | undefined;
      model: string;
      modelFromEnv: boolean;
    };

export interface Config {
  host: string;
  port: number;
  logLevel: LogLevel;
  database: DatabaseConfig;
  /** Signs access tokens. Required, at least 32 characters. */
  authSecret: string;
  /** Local username/password login can be turned off for OIDC-only installs. */
  localLoginEnabled: boolean;
  /** Public base URL of this instance; required for OIDC (callback URL). */
  publicUrl: string | undefined;
  oidc: OidcConfig | undefined;
  /** Provider ids (e.g. "cookidoo") whose recipe import is turned off. */
  disabledProviders: string[];
  /** Directory with the built web app; served when it exists. */
  webDir: string;
  /** LLM category guessing; undefined = off (the default). */
  categorize: CategorizeConfig | undefined;
}

interface Env {
  HOST: string;
  PORT: number;
  LOG_LEVEL: LogLevel;
  DATABASE_URL?: string;
  DATA_DIR: string;
  AUTH_SECRET: string;
  AUTH_LOCAL_ENABLED: boolean;
  PUBLIC_URL?: string;
  OIDC_ISSUER?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  OIDC_SCOPES: string;
  OIDC_GROUPS_CLAIM: string;
  OIDC_ADMIN_GROUP?: string;
  OIDC_APP_REDIRECTS?: string;
  IMPORT_DISABLED_PROVIDERS?: string;
  WEB_DIR: string;
  CATEGORIZE_LLM?: 'anthropic' | 'openai';
  CATEGORIZE_MODEL?: string;
  CATEGORIZE_BASE_URL: string;
  CATEGORIZE_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}

const schema = {
  type: 'object',
  required: ['AUTH_SECRET'],
  properties: {
    HOST: { type: 'string', default: '0.0.0.0' },
    PORT: { type: 'number', minimum: 1, maximum: 65535, default: 3000 },
    LOG_LEVEL: { type: 'string', enum: [...LOG_LEVELS], default: 'info' },
    DATABASE_URL: { type: 'string' },
    DATA_DIR: { type: 'string', default: './data' },
    AUTH_SECRET: { type: 'string', minLength: 32 },
    AUTH_LOCAL_ENABLED: { type: 'boolean', default: true },
    PUBLIC_URL: { type: 'string' },
    OIDC_ISSUER: { type: 'string' },
    OIDC_CLIENT_ID: { type: 'string' },
    OIDC_CLIENT_SECRET: { type: 'string' },
    OIDC_SCOPES: { type: 'string', default: 'openid profile' },
    OIDC_GROUPS_CLAIM: { type: 'string', default: 'groups' },
    OIDC_ADMIN_GROUP: { type: 'string' },
    OIDC_APP_REDIRECTS: { type: 'string' },
    IMPORT_DISABLED_PROVIDERS: { type: 'string' },
    WEB_DIR: { type: 'string', default: '../web/dist' },
    CATEGORIZE_LLM: { type: 'string', enum: ['anthropic', 'openai'] },
    CATEGORIZE_MODEL: { type: 'string' },
    CATEGORIZE_BASE_URL: { type: 'string', default: 'https://api.openai.com/v1' },
    CATEGORIZE_API_KEY: { type: 'string' },
    ANTHROPIC_API_KEY: { type: 'string' },
  },
} as const;

function requireUrl(value: string, name: string): void {
  try {
    new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

function resolveOidc(env: Env): OidcConfig | undefined {
  if (env.OIDC_ISSUER === undefined) {
    return undefined;
  }
  requireUrl(env.OIDC_ISSUER, 'OIDC_ISSUER');
  if (env.OIDC_CLIENT_ID === undefined) {
    throw new Error('OIDC_CLIENT_ID is required when OIDC_ISSUER is set');
  }
  if (env.PUBLIC_URL === undefined) {
    throw new Error('PUBLIC_URL is required when OIDC_ISSUER is set (for the callback URL)');
  }
  requireUrl(env.PUBLIC_URL, 'PUBLIC_URL');
  return {
    issuer: env.OIDC_ISSUER,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    scopes: env.OIDC_SCOPES,
    groupsClaim: env.OIDC_GROUPS_CLAIM,
    adminGroup: env.OIDC_ADMIN_GROUP,
    appRedirects: (env.OIDC_APP_REDIRECTS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ''),
  };
}

function resolveCategorize(env: Env): CategorizeConfig | undefined {
  if (env.CATEGORIZE_LLM === undefined) {
    return undefined;
  }
  if (env.CATEGORIZE_LLM === 'anthropic') {
    if (env.ANTHROPIC_API_KEY === undefined) {
      throw new Error('ANTHROPIC_API_KEY is required when CATEGORIZE_LLM=anthropic');
    }
    return {
      provider: 'anthropic',
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.CATEGORIZE_MODEL ?? 'claude-opus-5-5',
      modelFromEnv: env.CATEGORIZE_MODEL !== undefined,
    };
  }
  // 'openai' also covers local models: Ollama, LM Studio and vLLM expose
  // the same chat-completions API, so self-hosters need no third backend.
  if (env.CATEGORIZE_MODEL === undefined) {
    throw new Error('CATEGORIZE_MODEL is required when CATEGORIZE_LLM=openai');
  }
  requireUrl(env.CATEGORIZE_BASE_URL, 'CATEGORIZE_BASE_URL');
  return {
    provider: 'openai',
    baseUrl: env.CATEGORIZE_BASE_URL.replace(/\/$/, ''),
    apiKey: env.CATEGORIZE_API_KEY,
    model: env.CATEGORIZE_MODEL,
    modelFromEnv: true,
  };
}

function resolveDatabase(url: string | undefined, dataDir: string): DatabaseConfig {
  if (url === undefined || url === '') {
    return { dialect: 'sqlite', file: join(dataDir, 'drauf.db') };
  }
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    return { dialect: 'postgres', url };
  }
  if (url.startsWith('sqlite://')) {
    return { dialect: 'sqlite', file: url.slice('sqlite://'.length) };
  }
  throw new Error('DATABASE_URL must start with postgres://, postgresql:// or sqlite://');
}

/**
 * Database-only configuration for CLI tools (e.g. create-user): they must
 * work without AUTH_SECRET and the other server settings.
 */
export function loadDatabaseConfig(data: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const env = envSchema<Pick<Env, 'DATABASE_URL' | 'DATA_DIR'>>({
    schema: {
      type: 'object',
      properties: {
        DATABASE_URL: { type: 'string' },
        DATA_DIR: { type: 'string', default: './data' },
      },
    } as const,
    data,
  });
  return resolveDatabase(env.DATABASE_URL, env.DATA_DIR);
}

/** Reads and validates configuration from environment variables (the only config source). */
export function loadConfig(data: NodeJS.ProcessEnv = process.env): Config {
  const env = envSchema<Env>({ schema, data });
  return {
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    database: resolveDatabase(env.DATABASE_URL, env.DATA_DIR),
    authSecret: env.AUTH_SECRET,
    localLoginEnabled: env.AUTH_LOCAL_ENABLED,
    publicUrl: env.PUBLIC_URL?.replace(/\/$/, ''),
    oidc: resolveOidc(env),
    disabledProviders: (env.IMPORT_DISABLED_PROVIDERS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ''),
    webDir: env.WEB_DIR,
    categorize: resolveCategorize(env),
  };
}

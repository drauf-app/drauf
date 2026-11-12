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
  };
}

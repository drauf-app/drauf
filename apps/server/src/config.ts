import { join } from 'node:path';
import { envSchema } from 'env-schema';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export type DatabaseConfig =
  | { dialect: 'postgres'; url: string }
  | { dialect: 'sqlite'; file: string };

export interface Config {
  host: string;
  port: number;
  logLevel: LogLevel;
  database: DatabaseConfig;
}

interface Env {
  HOST: string;
  PORT: number;
  LOG_LEVEL: LogLevel;
  DATABASE_URL?: string;
  DATA_DIR: string;
}

const schema = {
  type: 'object',
  properties: {
    HOST: { type: 'string', default: '0.0.0.0' },
    PORT: { type: 'number', minimum: 1, maximum: 65535, default: 3000 },
    LOG_LEVEL: { type: 'string', enum: [...LOG_LEVELS], default: 'info' },
    DATABASE_URL: { type: 'string' },
    DATA_DIR: { type: 'string', default: './data' },
  },
} as const;

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
  };
}

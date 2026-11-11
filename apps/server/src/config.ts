import { envSchema } from 'env-schema';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  host: string;
  port: number;
  logLevel: LogLevel;
}

interface Env {
  HOST: string;
  PORT: number;
  LOG_LEVEL: LogLevel;
}

const schema = {
  type: 'object',
  properties: {
    HOST: { type: 'string', default: '0.0.0.0' },
    PORT: { type: 'number', minimum: 1, maximum: 65535, default: 3000 },
    LOG_LEVEL: { type: 'string', enum: [...LOG_LEVELS], default: 'info' },
  },
} as const;

/** Reads and validates configuration from environment variables (the only config source). */
export function loadConfig(data: NodeJS.ProcessEnv = process.env): Config {
  const env = envSchema<Env>({ schema, data });
  return {
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
  };
}

import type { Database } from '../db/index.js';
import {
  createRefreshToken,
  deleteRefreshToken,
  getRefreshTokenByHash,
  getUserById,
  getUserByUsername,
  updateUserLoginState,
} from '../db/repositories.js';
import type { User } from '../db/schema/types.js';
import { verifyAgainstDummy, verifyPassword } from './passwords.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  REFRESH_TOKEN_TTL_SECONDS,
  signAccessToken,
} from './tokens.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export type LoginResult =
  | ({ ok: true; user: User } & TokenPair)
  | { ok: false; reason: 'invalid_credentials' | 'account_locked' };

export async function issueTokens(
  database: Database,
  secret: string,
  user: User,
  deviceName: string | null,
): Promise<TokenPair> {
  const accessToken = await signAccessToken(secret, { userId: user.id, isAdmin: user.isAdmin });
  const refreshToken = generateRefreshToken();
  await createRefreshToken(database, {
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    deviceName,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
  });
  return { accessToken, refreshToken };
}

export async function login(
  database: Database,
  secret: string,
  input: { username: string; password: string; deviceName?: string },
): Promise<LoginResult> {
  const user = await getUserByUsername(database, input.username);
  if (user === undefined || user.passwordHash === null) {
    await verifyAgainstDummy(input.password);
    return { ok: false, reason: 'invalid_credentials' };
  }

  if (user.lockedUntil !== null && user.lockedUntil > new Date()) {
    return { ok: false, reason: 'account_locked' };
  }

  if (!(await verifyPassword(user.passwordHash, input.password))) {
    const failedLogins = user.failedLogins + 1;
    const locked = failedLogins >= MAX_FAILED_LOGINS;
    await updateUserLoginState(database, user.id, {
      failedLogins,
      lockedUntil: locked ? new Date(Date.now() + LOCK_DURATION_MS) : null,
    });
    return { ok: false, reason: locked ? 'account_locked' : 'invalid_credentials' };
  }

  if (user.failedLogins > 0 || user.lockedUntil !== null) {
    await updateUserLoginState(database, user.id, { failedLogins: 0, lockedUntil: null });
  }

  const tokens = await issueTokens(database, secret, user, input.deviceName ?? null);
  return { ok: true, user, ...tokens };
}

/** Rotates the refresh token: the presented token is revoked, a new pair is issued. */
export async function refresh(
  database: Database,
  secret: string,
  refreshTokenValue: string,
): Promise<TokenPair | undefined> {
  const row = await getRefreshTokenByHash(database, hashRefreshToken(refreshTokenValue));
  if (row === undefined) {
    return undefined;
  }
  await deleteRefreshToken(database, row.id);
  if (row.expiresAt <= new Date()) {
    return undefined;
  }
  const user = await getUserById(database, row.userId);
  if (user === undefined) {
    return undefined;
  }
  return issueTokens(database, secret, user, row.deviceName);
}

export async function logout(database: Database, refreshTokenValue: string): Promise<void> {
  const row = await getRefreshTokenByHash(database, hashRefreshToken(refreshTokenValue));
  if (row !== undefined) {
    await deleteRefreshToken(database, row.id);
  }
}

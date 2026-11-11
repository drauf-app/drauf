import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface AccessTokenClaims {
  userId: string;
  isAdmin: boolean;
}

export async function signAccessToken(
  secret: string,
  claims: AccessTokenClaims,
  ttlSeconds: number = ACCESS_TOKEN_TTL_SECONDS,
): Promise<string> {
  return new SignJWT({ adm: claims.isAdmin })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(new TextEncoder().encode(secret));
}

export async function verifyAccessToken(
  secret: string,
  token: string,
): Promise<AccessTokenClaims | undefined> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    if (typeof payload.sub !== 'string') {
      return undefined;
    }
    return { userId: payload.sub, isAdmin: payload.adm === true };
  } catch {
    return undefined;
  }
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Refresh tokens are stored hashed; a database leak must not leak usable tokens. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

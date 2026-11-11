import argon2 from 'argon2';

export const MIN_PASSWORD_LENGTH = 10;

export function hashPassword(password: string): Promise<string> {
  // Library defaults are argon2id with current OWASP-recommended parameters.
  return argon2.hash(password);
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password).catch(() => false);
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifies against a throwaway hash so that login attempts for unknown
 * usernames take as long as attempts for existing ones. Computed lazily to
 * keep module import cheap.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(await dummyHash, password);
}

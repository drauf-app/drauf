import { hashPassword, MIN_PASSWORD_LENGTH } from '../auth/passwords.js';
import type { Database } from '../db/index.js';
import {
  addHouseholdMember,
  createUser,
  getDefaultHousehold,
  getUserByUsername,
} from '../db/repositories.js';
import type { User } from '../db/schema/types.js';

/** Lowercase to avoid duplicate accounts that differ only in case. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: Date;
  /** Cached IdP profile picture (#98); null = clients render initials. */
  avatarUrl: string | null;
  /** Whether the password section applies; OIDC-only accounts have none. */
  hasPassword: boolean;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt,
    avatarUrl: user.avatarKey === null ? null : `/avatars/${user.avatarKey}`,
    hasPassword: user.passwordHash !== null,
  };
}

export type CreateLocalUserResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'invalid_username' | 'password_too_short' | 'username_taken' };

/** Creates a local account and makes it a member of the default household. */
export async function createLocalUser(
  database: Database,
  input: { username: string; password: string; displayName: string; isAdmin: boolean },
): Promise<CreateLocalUserResult> {
  if (!USERNAME_PATTERN.test(input.username)) {
    return { ok: false, reason: 'invalid_username' };
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: 'password_too_short' };
  }
  if ((await getUserByUsername(database, input.username)) !== undefined) {
    return { ok: false, reason: 'username_taken' };
  }

  const passwordHash = await hashPassword(input.password);
  let user: User;
  try {
    user = await createUser(database, {
      username: input.username,
      displayName: input.displayName,
      passwordHash,
      isAdmin: input.isAdmin,
    });
  } catch {
    // Unique constraint race between the pre-check and the insert.
    return { ok: false, reason: 'username_taken' };
  }

  const household = await getDefaultHousehold(database);
  if (household !== undefined) {
    await addHouseholdMember(database, household.id, user.id);
  }
  return { ok: true, user };
}

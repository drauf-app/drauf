/** Server-side PublicUser as it arrives over JSON (dates are ISO strings). */
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthProviders {
  localLogin: boolean;
  oidc: boolean;
}

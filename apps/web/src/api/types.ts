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

export interface List {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  archived: boolean;
  ownerId: string;
  defaultStoreId: string | null;
  createdAt: string;
}

export interface ListDetail extends List {
  members: PublicUser[];
}

export interface Category {
  id: string;
  householdId: string;
  /** Stable identifier of seeded base categories; null for household-created ones. */
  key: string | null;
  name: string;
  sortOrder: number;
  createdAt: string;
}

export interface QuantityGroup {
  unit: string | null;
  quantity: number;
}

export interface EntryPortion {
  id: string;
  entryId: string;
  quantity: number | null;
  unit: string | null;
  origin: 'manual' | 'recipe';
  addedById: string | null;
  createdAt: string;
}

export interface EntryView {
  id: string;
  listId: string;
  name: string;
  nameNormalized: string;
  variant: string | null;
  note: string | null;
  categoryId: string | null;
  fieldTimes: string | null;
  checkedAt: string | null;
  checkedById: string | null;
  createdAt: string;
  /** Summed per unit; different units stay side by side (no conversion). */
  quantities: QuantityGroup[];
  portions: EntryPortion[];
}

/** One quick-add suggestion; history entries come first. */
export interface Suggestion {
  name: string;
  source: 'history' | 'catalog';
  icon: string | null;
  categoryId: string | null;
  sizes: string[];
  varieties: string[];
  count?: number;
  lastQuantity?: number | null;
  lastUnit?: string | null;
  lastVariant?: string | null;
}

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
  /** Overview extras from GET /api/lists (absent on other list responses). */
  openCount?: number;
  previewIcons?: string[];
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
  /** Resolved icon id: the household's override or the base default (#71). */
  icon: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface QuantityGroup {
  unit: string | null;
  quantity: number;
  /** Pack count, only when one counted portion makes up the group (2 × 500 g). */
  count?: number;
}

export interface EntryPortion {
  id: string;
  entryId: string;
  quantity: number | null;
  unit: string | null;
  count: number | null;
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
  /** Comma list of fixed shopping flags (Angebot, Dringend, …). */
  flags: string | null;
  note: string | null;
  categoryId: string | null;
  fieldTimes: string | null;
  checkedAt: string | null;
  checkedById: string | null;
  createdAt: string;
  /** Summed per unit; different units stay side by side (no conversion). */
  quantities: QuantityGroup[];
  portions: EntryPortion[];
  /** Catalogue icon for tile views; null when the item is unknown. */
  icon: string | null;
  /** Transient: the server is asking the LLM for a category right now. */
  categorizing?: boolean;
}

/** One quick-add suggestion; history entries come first. */
export interface Suggestion {
  name: string;
  source: 'history' | 'catalog';
  icon: string | null;
  categoryId: string | null;
  sizes: string[];
  varieties: string[];
  /** This household's recently used variants, most recent first. */
  recentVariants?: string[];
  count?: number;
  lastQuantity?: number | null;
  lastUnit?: string | null;
  lastCount?: number | null;
  lastVariant?: string | null;
  lastNote?: string | null;
}

export interface StoreWithOrder {
  id: string;
  householdId: string;
  name: string;
  createdAt: string;
  /** Category ids in this store's aisle order; empty = household order. */
  categoryOrder: string[];
}

export interface MealSlot {
  id: string;
  householdId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
}

export interface PlanEntry {
  id: string;
  householdId: string;
  /** ISO calendar date (YYYY-MM-DD). */
  date: string;
  slotId: string;
  text: string | null;
  link: string | null;
  imageUrl: string | null;
  cookId: string | null;
  createdAt: string;
}

export interface HouseholdMember {
  userId: string;
  username: string;
  displayName: string;
}

export interface HouseholdInfo {
  id: string;
  name: string;
  members: HouseholdMember[];
}

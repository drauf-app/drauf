import { useSyncExternalStore } from 'react';
import { apiJson } from '../auth/store';

/** One instance icon from GET /api/icons (#71). */
export interface InstanceIconEntry {
  id: string;
  kind: 'mono' | 'color';
  url: string;
}

interface IconManifest {
  defaultPack: string;
  icons: InstanceIconEntry[];
}

export interface IconRegistry {
  /** How bare emoji ids render: 'openmoji' (mono) or 'fluent' (color) (#83). */
  defaultPack: string;
  icons: readonly InstanceIconEntry[];
  byId: ReadonlyMap<string, InstanceIconEntry>;
}

const STORAGE_KEY = 'drauf.icon-registry';

function parseEntries(parsed: unknown): InstanceIconEntry[] {
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(
    (entry): entry is InstanceIconEntry =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as InstanceIconEntry).id === 'string' &&
      typeof (entry as InstanceIconEntry).url === 'string' &&
      ((entry as InstanceIconEntry).kind === 'mono' ||
        (entry as InstanceIconEntry).kind === 'color'),
  );
}

// localStorage keeps the last manifest so icons render on an offline start;
// it can throw (private mode, blocked site data) and is then simply skipped.
function readStored(): { defaultPack: string; icons: InstanceIconEntry[] } {
  const fallback = { defaultPack: 'openmoji', icons: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return fallback;
    }
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Pre-#83 shape: just the icon list.
      return { defaultPack: 'openmoji', icons: parseEntries(parsed) };
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return fallback;
    }
    const shaped = parsed as { defaultPack?: unknown; icons?: unknown };
    return {
      defaultPack: typeof shaped.defaultPack === 'string' ? shaped.defaultPack : 'openmoji',
      icons: parseEntries(shaped.icons),
    };
  } catch {
    return fallback;
  }
}

function writeStored(defaultPack: string, entries: readonly InstanceIconEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ defaultPack, icons: entries }));
  } catch {
    // Offline start just has no custom icons then.
  }
}

function toRegistry(defaultPack: string, entries: readonly InstanceIconEntry[]): IconRegistry {
  return {
    defaultPack,
    icons: entries,
    byId: new Map(entries.map((entry) => [entry.id, entry])),
  };
}

const hydrated = readStored();
let registry: IconRegistry = toRegistry(hydrated.defaultPack, hydrated.icons);
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();

function setRegistry(defaultPack: string, entries: readonly InstanceIconEntry[]): void {
  registry = toRegistry(defaultPack, entries);
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current instance icons; re-renders when the manifest arrives. */
export function useIconRegistry(): IconRegistry {
  return useSyncExternalStore(subscribe, () => registry);
}

/**
 * Fetches the manifest once per session (call after sign-in). Failures keep
 * the hydrated state: icons are decorative, offline must not break anything.
 */
export function loadIconRegistry(): Promise<void> {
  loading ??= apiJson<IconManifest>('/api/icons')
    .then((manifest) => {
      setRegistry(manifest.defaultPack, manifest.icons);
      writeStored(manifest.defaultPack, manifest.icons);
    })
    .catch(() => {
      loading = undefined; // A later call may retry, e.g. after a re-login.
    });
  return loading;
}

/** Re-fetches the manifest now, e.g. after the admin switched icons.pack. */
export function refreshIconRegistry(): Promise<void> {
  loading = undefined;
  return loadIconRegistry();
}

/** Test seam: drops module state and re-hydrates from localStorage. */
export function resetIconRegistryForTests(): void {
  loading = undefined;
  listeners.clear();
  const stored = readStored();
  registry = toRegistry(stored.defaultPack, stored.icons);
}

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
  icons: readonly InstanceIconEntry[];
  byId: ReadonlyMap<string, InstanceIconEntry>;
}

const STORAGE_KEY = 'drauf.icon-registry';

// localStorage keeps the last manifest so icons render on an offline start;
// it can throw (private mode, blocked site data) and is then simply skipped.
function readStored(): InstanceIconEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
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
  } catch {
    return [];
  }
}

function writeStored(entries: readonly InstanceIconEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Offline start just has no custom icons then.
  }
}

function toRegistry(entries: readonly InstanceIconEntry[]): IconRegistry {
  return { icons: entries, byId: new Map(entries.map((entry) => [entry.id, entry])) };
}

let registry: IconRegistry = toRegistry(readStored());
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();

function setRegistry(entries: readonly InstanceIconEntry[]): void {
  registry = toRegistry(entries);
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
      setRegistry(manifest.icons);
      writeStored(manifest.icons);
    })
    .catch(() => {
      loading = undefined; // A later call may retry, e.g. after a re-login.
    });
  return loading;
}

/** Test seam: drops module state and re-hydrates from localStorage. */
export function resetIconRegistryForTests(): void {
  loading = undefined;
  listeners.clear();
  registry = toRegistry(readStored());
}

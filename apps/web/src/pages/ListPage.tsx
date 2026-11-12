import { normalizeItemName, splitVariants } from '@drauf/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  type AddEntryInput,
  addEntry,
  checkEntry,
  deleteEntry,
  deleteList,
  fetchCategories,
  fetchEntries,
  fetchList,
  type PatchEntryInput,
  patchEntry,
  patchList,
} from '../api/lists';
import { fetchStores } from '../api/stores';
import type { Category, EntryView, ListDetail, StoreWithOrder } from '../api/types';
import { ApiError, useAuth } from '../auth/store';
import { EntryEditForm } from '../components/EntryEditForm';
import { QuickAdd } from '../components/QuickAdd';
import { useT } from '../i18n';
import {
  applyListEvent,
  formatQuantities,
  groupEntries,
  recentEntries,
  upsertEntry,
} from '../lib/entries';
import { enqueueOp, flushQueue, newLocalEntryId, newOpId, pendingOps } from '../lib/offline';
import { type SyncEvent, useSync } from '../lib/sync';

/** Thrown Response/ApiError = the server answered; anything else = offline. */
function isOfflineError(err: unknown): boolean {
  return !(err instanceof ApiError);
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Placeholder entry shown until the queued offline add reaches the server. */
function localEntryView(listId: string, input: AddEntryInput): EntryView {
  return {
    id: newLocalEntryId(),
    listId,
    name: input.name.trim().replace(/\s+/g, ' '),
    nameNormalized: normalizeItemName(input.name),
    variant: input.variant ?? null,
    flags: null,
    note: input.note ?? null,
    categoryId: input.categoryId ?? null,
    fieldTimes: null,
    checkedAt: null,
    checkedById: null,
    createdAt: nowIso(),
    quantities:
      input.quantity === undefined ? [] : [{ unit: input.unit ?? null, quantity: input.quantity }],
    portions: [],
    icon: null,
  };
}

/** Local mirror of the server's portion replacement for offline amount edits. */
function localQuantities(patch: PatchEntryInput): EntryView['quantities'] {
  const quantity = patch.quantity ?? null;
  const count = patch.count ?? null;
  const unit = patch.unit === '' || patch.unit === undefined ? null : patch.unit;
  if (quantity !== null) {
    return count !== null && count > 1
      ? [{ unit, quantity, count }]
      : [{ unit, quantity: (count ?? 1) * quantity }];
  }
  if (count !== null) {
    return [{ unit: null, quantity: count }];
  }
  return [];
}

/** Mirrors a queued entry.setFields locally while offline ('' clears a field). */
function patchEntryLocally(entry: EntryView, patch: PatchEntryInput): EntryView {
  const cleared = (value: string | undefined) => (value === '' ? null : value);
  const hasAmount =
    patch.quantity !== undefined || patch.unit !== undefined || patch.count !== undefined;
  return {
    ...entry,
    ...(patch.name === undefined || patch.name === '' ? {} : { name: patch.name }),
    ...(patch.variant === undefined ? {} : { variant: cleared(patch.variant) ?? null }),
    ...(patch.flags === undefined ? {} : { flags: cleared(patch.flags) ?? null }),
    ...(patch.note === undefined ? {} : { note: cleared(patch.note) ?? null }),
    ...(patch.categoryId === undefined ? {} : { categoryId: cleared(patch.categoryId) ?? null }),
    ...(hasAmount ? { quantities: localQuantities(patch) } : {}),
  };
}

interface EntryRowProps {
  entry: EntryView;
  onToggle: (entry: EntryView) => void;
  onDelete: (entry: EntryView) => void;
  onEdit: (entry: EntryView) => void;
}

function EntryRow({ entry, onToggle, onDelete, onEdit }: EntryRowProps) {
  const t = useT();
  const checked = entry.checkedAt !== null;
  const quantities = formatQuantities(entry.quantities);
  return (
    <li className={checked ? 'entry checked' : 'entry'}>
      <button
        type="button"
        className="entry-main"
        aria-label={checked ? t.list.uncheckEntry : t.list.checkEntry}
        onClick={() => onToggle(entry)}
      >
        <span className="entry-check" aria-hidden="true">
          {checked ? '✓' : ''}
        </span>
        <span className="entry-text">
          <span className="entry-name">
            {entry.name}
            {entry.variant !== null && <span className="entry-variant"> {entry.variant}</span>}
            {splitVariants(entry.flags).map((flag) => (
              <span key={flag} className="entry-flag">
                {flag}
              </span>
            ))}
          </span>
          {entry.note !== null && <span className="entry-note">{entry.note}</span>}
        </span>
        {quantities !== '' && <span className="entry-quantity">{quantities}</span>}
      </button>
      <button
        type="button"
        className="entry-edit-button"
        aria-label={`${t.list.editEntry}: ${entry.name}`}
        onClick={() => onEdit(entry)}
      >
        ✎
      </button>
      <button
        type="button"
        className="entry-delete"
        aria-label={t.list.deleteEntry}
        onClick={() => onDelete(entry)}
      >
        ×
      </button>
    </li>
  );
}

/** Tile variant of an entry: tap checks off, corner buttons edit/delete. */
function EntryTile({ entry, onToggle, onDelete, onEdit }: EntryRowProps) {
  const t = useT();
  const checked = entry.checkedAt !== null;
  const quantities = formatQuantities(entry.quantities);
  const meta = [quantities, entry.variant ?? ''].filter((part) => part !== '').join(' · ');
  return (
    <li className={checked ? 'tile checked' : 'tile'}>
      <button
        type="button"
        className="tile-main"
        aria-label={
          checked ? `${t.list.uncheckEntry}: ${entry.name}` : `${t.list.checkEntry}: ${entry.name}`
        }
        onClick={() => onToggle(entry)}
      >
        <span className="tile-icon" aria-hidden="true">
          {checked ? '✓' : (entry.icon ?? '')}
        </span>
        <span className="tile-name">{entry.name}</span>
        {meta !== '' && <span className="tile-meta">{meta}</span>}
        {entry.flags !== null && (
          <span className="tile-flags">
            {splitVariants(entry.flags).map((flag) => (
              <span key={flag} className="entry-flag">
                {flag}
              </span>
            ))}
          </span>
        )}
      </button>
      <span className="tile-actions">
        <button
          type="button"
          aria-label={`${t.list.editEntry}: ${entry.name}`}
          onClick={() => onEdit(entry)}
        >
          ✎
        </button>
        <button type="button" aria-label={t.list.deleteEntry} onClick={() => onDelete(entry)}>
          ×
        </button>
      </span>
    </li>
  );
}

function loadListView(): 'rows' | 'tiles' {
  try {
    return localStorage.getItem('drauf.list-view') === 'tiles' ? 'tiles' : 'rows';
  } catch {
    return 'rows';
  }
}

export function ListPage() {
  const t = useT();
  const auth = useAuth();
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const listId = params.id ?? '';

  const [list, setList] = useState<ListDetail>();
  const [entries, setEntries] = useState<EntryView[]>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [stores, setStores] = useState<StoreWithOrder[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const [renaming, setRenaming] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [listView, setListView] = useState<'rows' | 'tiles'>(loadListView);

  function switchView(view: 'rows' | 'tiles'): void {
    setListView(view);
    try {
      localStorage.setItem('drauf.list-view', view);
    } catch {
      // The choice then lasts only for this visit.
    }
  }

  const reload = useCallback(async () => {
    const [listResult, entriesResult, categoriesResult, storesResult] = await Promise.all([
      fetchList(listId),
      fetchEntries(listId),
      fetchCategories(),
      fetchStores(),
    ]);
    setList(listResult);
    setEntries(entriesResult);
    setCategories(categoriesResult);
    setStores(storesResult);
  }, [listId]);

  useEffect(() => {
    let cancelled = false;
    reload().catch(() => {
      if (!cancelled) setNotFound(true);
    });
    // Replay offline work, then refetch so local placeholders are replaced
    // by the server's merged entries.
    const flushAndReload = () => {
      const hadWork = pendingOps().length > 0;
      void flushQueue().then((drained) => {
        if (drained && hadWork && !cancelled) {
          void reload().catch(() => {});
        }
      });
    };
    flushAndReload();
    const onFocus = () => {
      void reload().catch(() => {});
      flushAndReload();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', flushAndReload);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', flushAndReload);
    };
  }, [reload]);

  // Remembered for the recipe import's list preselection.
  useEffect(() => {
    try {
      localStorage.setItem('drauf.last-list', listId);
    } catch {
      // Preselection is a convenience only.
    }
  }, [listId]);

  useSync({ lists: [listId] }, (_topic, event: SyncEvent) => {
    if (event.type === 'list.deleted' || event.type === 'evicted') {
      void navigate('/', { replace: true });
      return;
    }
    if (event.type === 'list.updated') {
      setList((previous) =>
        previous === undefined ? previous : { ...previous, ...(event.data as Partial<ListDetail>) },
      );
      return;
    }
    setEntries((previous) => (previous === undefined ? previous : applyListEvent(previous, event)));
  });

  // Any state-changing call that fails shows one retryable error line.
  function run(action: () => Promise<void>): void {
    setActionFailed(false);
    action().catch(() => setActionFailed(true));
  }

  function applyView(view: EntryView): void {
    setEntries((previous) => upsertEntry(previous ?? [], view));
  }

  async function handleAdd(input: AddEntryInput): Promise<EntryView | undefined> {
    setActionFailed(false);
    try {
      const view = await addEntry(listId, input);
      applyView(view);
      return view;
    } catch (err) {
      if (!isOfflineError(err)) {
        setActionFailed(true);
        return undefined;
      }
      // Offline (L10): keep a placeholder and queue the add for replay.
      const local = localEntryView(listId, input);
      applyView(local);
      enqueueOp({
        id: newOpId(),
        type: 'entry.add',
        time: nowIso(),
        localEntryId: local.id,
        data: { listId, ...input },
      });
      return local;
    }
  }

  /** Field edit with offline fallback: queue entry.setFields and apply locally. */
  function setFields(entryId: string, fields: PatchEntryInput): void {
    setActionFailed(false);
    void (async () => {
      try {
        applyView(await patchEntry(listId, entryId, fields));
      } catch (err) {
        if (!isOfflineError(err)) {
          setActionFailed(true);
          return;
        }
        enqueueOp({
          id: newOpId(),
          type: 'entry.setFields',
          time: nowIso(),
          data: { listId, entryId, fields },
        });
        setEntries((previous) =>
          (previous ?? []).map((item) =>
            item.id === entryId ? patchEntryLocally(item, fields) : item,
          ),
        );
      }
    })();
  }

  function handleToggle(entry: EntryView): void {
    const check = entry.checkedAt === null;
    setActionFailed(false);
    void (async () => {
      try {
        applyView(await checkEntry(listId, entry.id, check));
      } catch (err) {
        if (!isOfflineError(err)) {
          setActionFailed(true);
          return;
        }
        enqueueOp({
          id: newOpId(),
          type: check ? 'entry.check' : 'entry.uncheck',
          time: nowIso(),
          data: { listId, entryId: entry.id },
        });
        applyView({ ...entry, checkedAt: check ? nowIso() : null });
      }
    })();
  }

  function handleDelete(entry: EntryView): void {
    setActionFailed(false);
    void (async () => {
      try {
        await deleteEntry(listId, entry.id);
      } catch (err) {
        if (!isOfflineError(err)) {
          setActionFailed(true);
          return;
        }
        enqueueOp({
          id: newOpId(),
          type: 'entry.delete',
          time: nowIso(),
          data: { listId, entryId: entry.id },
        });
      }
      setEntries((previous) => (previous ?? []).filter((item) => item.id !== entry.id));
    })();
  }

  function handleEditSave(entry: EntryView, fields: PatchEntryInput): void {
    setEditingId(undefined);
    setFields(entry.id, fields);
  }

  function handleRename(event: FormEvent): void {
    event.preventDefault();
    const name = renaming?.trim() ?? '';
    if (name === '') {
      setRenaming(undefined);
      return;
    }
    run(async () => {
      const updated = await patchList(listId, { name });
      setList((previous) => (previous === undefined ? previous : { ...previous, ...updated }));
    });
    setRenaming(undefined);
  }

  function handleArchive(): void {
    if (list === undefined) {
      return;
    }
    run(async () => {
      const updated = await patchList(listId, { archived: !list.archived });
      setList((previous) => (previous === undefined ? previous : { ...previous, ...updated }));
    });
  }

  function handleStoreChange(storeId: string): void {
    run(async () => {
      const updated = await patchList(listId, {
        defaultStoreId: storeId === '' ? null : storeId,
      });
      setList((previous) => (previous === undefined ? previous : { ...previous, ...updated }));
    });
  }

  function handleDeleteList(): void {
    if (!window.confirm(t.list.deleteConfirm)) {
      return;
    }
    run(async () => {
      await deleteList(listId);
      await navigate('/', { replace: true });
    });
  }

  if (notFound) {
    return (
      <section>
        <p className="error">{t.list.notFound}</p>
        <Link to="/">{t.list.backToLists}</Link>
      </section>
    );
  }
  if (list === undefined || entries === undefined) {
    return <p className="placeholder">{t.common.loading}</p>;
  }

  const selectedStore = stores.find((store) => store.id === list.defaultStoreId);
  const groups = groupEntries(entries, categories, selectedStore?.categoryOrder);
  const recent = recentEntries(entries);

  function renderEntry(entry: EntryView) {
    if (entry.id === editingId) {
      return (
        <li key={entry.id} className="entry entry-editing">
          <EntryEditForm
            entry={entry}
            categories={categories}
            onSave={(fields) => handleEditSave(entry, fields)}
            onCancel={() => setEditingId(undefined)}
          />
        </li>
      );
    }
    const Renderer = listView === 'tiles' ? EntryTile : EntryRow;
    return (
      <Renderer
        key={entry.id}
        entry={entry}
        onToggle={handleToggle}
        onDelete={handleDelete}
        onEdit={(target) => setEditingId(target.id)}
      />
    );
  }

  const entriesClass = listView === 'tiles' ? 'entries tiles' : 'entries';

  return (
    <section className="list-page">
      <header className="list-header">
        {renaming === undefined ? (
          <h1>
            {list.icon !== null && <span className="list-icon">{list.icon}</span>}
            {list.name}
          </h1>
        ) : (
          <form className="rename-form" onSubmit={handleRename}>
            <input
              type="text"
              value={renaming}
              maxLength={100}
              aria-label={t.list.rename}
              // biome-ignore lint/a11y/noAutofocus: the form only appears on an explicit rename action.
              autoFocus
              onChange={(event) => setRenaming(event.target.value)}
            />
            <button type="submit">{t.common.save}</button>
          </form>
        )}
        {stores.length > 0 && (
          <select
            className="store-picker"
            aria-label={t.list.storePicker}
            value={list.defaultStoreId ?? ''}
            onChange={(event) => handleStoreChange(event.target.value)}
          >
            <option value="">{t.list.householdOrder}</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        )}
        <div className="view-toggle">
          <button
            type="button"
            className={listView === 'rows' ? 'active' : undefined}
            aria-label={t.list.viewRows}
            aria-pressed={listView === 'rows'}
            onClick={() => switchView('rows')}
          >
            ☰
          </button>
          <button
            type="button"
            className={listView === 'tiles' ? 'active' : undefined}
            aria-label={t.list.viewTiles}
            aria-pressed={listView === 'tiles'}
            onClick={() => switchView('tiles')}
          >
            ▦
          </button>
        </div>
        <div className="list-actions">
          <button type="button" onClick={() => setRenaming(list.name)}>
            {t.list.rename}
          </button>
          <button type="button" onClick={handleArchive}>
            {list.archived ? t.list.unarchive : t.list.archive}
          </button>
          {auth.user?.id === list.ownerId && (
            <button type="button" className="danger" onClick={handleDeleteList}>
              {t.list.delete}
            </button>
          )}
        </div>
      </header>

      {actionFailed && <p className="error">{t.common.error}</p>}

      {groups.length === 0 && <p className="placeholder">{t.list.empty}</p>}
      {groups.map((group) => (
        <div key={group.category?.id ?? 'uncategorized'} className="category-group">
          <h2>{group.category?.name ?? t.list.uncategorized}</h2>
          <ul className={entriesClass}>{group.entries.map(renderEntry)}</ul>
        </div>
      ))}

      {recent.length > 0 && (
        <details className="recent">
          <summary>{t.list.recent}</summary>
          <ul className={entriesClass}>{recent.map(renderEntry)}</ul>
        </details>
      )}

      <QuickAdd entries={entries} onAdd={handleAdd} onPatch={setFields} />
    </section>
  );
}

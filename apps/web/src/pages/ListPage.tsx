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
  patchEntry,
  patchList,
} from '../api/lists';
import { fetchStores } from '../api/stores';
import type { Category, EntryView, ListDetail, StoreWithOrder, Suggestion } from '../api/types';
import { useAuth } from '../auth/store';
import { ChipBar } from '../components/ChipBar';
import { QuickAdd } from '../components/QuickAdd';
import { useT } from '../i18n';
import { buildChipGroups, type Chip, type ChipGroups } from '../lib/chips';
import { formatQuantities, groupEntries, recentEntries, upsertEntry } from '../lib/entries';

interface ChipTarget {
  entryId: string;
  groups: ChipGroups;
}

interface EntryRowProps {
  entry: EntryView;
  categories: Category[];
  onToggle: (entry: EntryView) => void;
  onDelete: (entry: EntryView) => void;
  onSetCategory: (entry: EntryView, categoryId: string) => void;
}

function EntryRow({ entry, categories, onToggle, onDelete, onSetCategory }: EntryRowProps) {
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
          </span>
          {entry.note !== null && <span className="entry-note">{entry.note}</span>}
        </span>
        {quantities !== '' && <span className="entry-quantity">{quantities}</span>}
      </button>
      {!checked && entry.categoryId === null && categories.length > 0 && (
        <select
          className="entry-category"
          aria-label={t.list.setCategory}
          value=""
          onChange={(event) => {
            if (event.target.value !== '') {
              onSetCategory(entry, event.target.value);
            }
          }}
        >
          <option value="">{t.list.setCategory}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      )}
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
  const [chipTarget, setChipTarget] = useState<ChipTarget>();
  const [renaming, setRenaming] = useState<string>();

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
    // Without live sync yet, a refetch on focus keeps shared lists current.
    const onFocus = () => void reload().catch(() => {});
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [reload]);

  // Any state-changing call that fails shows one retryable error line.
  function run(action: () => Promise<void>): void {
    setActionFailed(false);
    action().catch(() => setActionFailed(true));
  }

  function applyView(view: EntryView): void {
    setEntries((previous) => upsertEntry(previous ?? [], view));
  }

  async function handleAdd(input: AddEntryInput, suggestion?: Suggestion): Promise<void> {
    setActionFailed(false);
    try {
      const view = await addEntry(listId, input);
      applyView(view);
      setChipTarget({ entryId: view.id, groups: buildChipGroups(suggestion) });
    } catch {
      setActionFailed(true);
    }
  }

  function handleChip(chip: Chip): void {
    const target = chipTarget;
    if (target === undefined) {
      return;
    }
    run(async () => {
      applyView(await patchEntry(listId, target.entryId, chip.patch));
    });
  }

  function handleToggle(entry: EntryView): void {
    run(async () => {
      applyView(await checkEntry(listId, entry.id, entry.checkedAt === null));
    });
    if (chipTarget?.entryId === entry.id) {
      setChipTarget(undefined);
    }
  }

  function handleDelete(entry: EntryView): void {
    run(async () => {
      await deleteEntry(listId, entry.id);
      setEntries((previous) => (previous ?? []).filter((item) => item.id !== entry.id));
    });
    if (chipTarget?.entryId === entry.id) {
      setChipTarget(undefined);
    }
  }

  function handleSetCategory(entry: EntryView, categoryId: string): void {
    run(async () => {
      applyView(await patchEntry(listId, entry.id, { categoryId }));
    });
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
          <ul className="entries">
            {group.entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                categories={categories}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onSetCategory={handleSetCategory}
              />
            ))}
          </ul>
        </div>
      ))}

      {recent.length > 0 && (
        <details className="recent">
          <summary>{t.list.recent}</summary>
          <ul className="entries">
            {recent.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                categories={categories}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onSetCategory={handleSetCategory}
              />
            ))}
          </ul>
        </details>
      )}

      <div className="quick-add-area">
        {chipTarget !== undefined && (
          <ChipBar
            groups={chipTarget.groups}
            onPick={handleChip}
            onDismiss={() => setChipTarget(undefined)}
          />
        )}
        <QuickAdd onAdd={handleAdd} />
      </div>
    </section>
  );
}

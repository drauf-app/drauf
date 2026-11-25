import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  fetchExport,
  fetchStaples,
  type HouseholdStaples,
  resetStaples,
  saveStaples,
} from '../api/households';
import { fetchCategories } from '../api/lists';
import {
  createStore,
  deleteStore,
  fetchStores,
  renameStore,
  setStoreCategoryOrder,
} from '../api/stores';
import type { Category, StoreWithOrder } from '../api/types';
import { VersionLine } from '../components/VersionLine';
import { useT } from '../i18n';
import { dropTargetIndex, moveItem } from '../lib/reorder';

/** The store's aisle order, falling back to the household order. */
function orderedCategories(store: StoreWithOrder, categories: Category[]): Category[] {
  const byHousehold = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
  if (store.categoryOrder.length === 0) {
    return byHousehold;
  }
  const position = new Map(store.categoryOrder.map((id, index) => [id, index]));
  const inStore = byHousehold.filter((category) => position.has(category.id));
  inStore.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
  return [...inStore, ...byHousehold.filter((category) => !position.has(category.id))];
}

interface StoreEditDialogProps {
  store: StoreWithOrder;
  categories: Category[];
  onChanged: (store: StoreWithOrder) => void;
  onError: () => void;
  onClose: () => void;
}

/** Modal editing one store: its name and its category (aisle) order. */
function StoreEditDialog({ store, categories, onChanged, onError, onClose }: StoreEditDialogProps) {
  const t = useT();
  const [name, setName] = useState(store.name);
  const [drag, setDrag] = useState<{ from: number; to: number }>();
  const listRef = useRef<HTMLOListElement>(null);
  // Row midpoints captured at drag start: the preview reorders the DOM, so
  // live positions would drift under the pointer.
  const midpoints = useRef<number[]>([]);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const ordered = orderedCategories(store, categories);

  function run(action: () => Promise<void>): void {
    action().catch(onError);
  }

  function saveOrder(from: number, to: number): void {
    if (from === to) {
      return;
    }
    const ids = moveItem(
      ordered.map((category) => category.id),
      from,
      to,
    );
    run(async () => {
      onChanged(await setStoreCategoryOrder(store.id, ids));
    });
  }

  function move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= ordered.length) {
      return;
    }
    saveOrder(index, target);
  }

  const saveOrderRef = useRef(saveOrder);
  saveOrderRef.current = saveOrder;
  const dragCleanup = useRef<(() => void) | undefined>(undefined);
  // A drag may outlive the dialog (close mid-drag): drop the listeners.
  useEffect(() => () => dragCleanup.current?.(), []);

  /**
   * The preview reorders the DOM, which cancels pointer capture on the
   * handle — so the drag is tracked with window-level listeners, registered
   * synchronously here so even the fastest drag never misses its events.
   */
  function startDrag(index: number, event: ReactPointerEvent<HTMLButtonElement>): void {
    const list = listRef.current;
    if (list === null || dragCleanup.current !== undefined) {
      return;
    }
    event.preventDefault();
    midpoints.current = [...list.querySelectorAll('li')].map((row) => {
      const rect = row.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    dragRef.current = { from: index, to: index };
    setDrag(dragRef.current);

    const onMove = (moveEvent: PointerEvent) => {
      const current = dragRef.current;
      if (current === undefined) {
        return;
      }
      moveEvent.preventDefault();
      const to = dropTargetIndex(midpoints.current, current.from, moveEvent.clientY);
      if (to !== current.to) {
        dragRef.current = { from: current.from, to };
        setDrag(dragRef.current);
      }
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      dragCleanup.current = undefined;
    };
    const onUp = () => {
      const current = dragRef.current;
      dragRef.current = undefined;
      setDrag(undefined);
      cleanup();
      if (current !== undefined) {
        saveOrderRef.current(current.from, current.to);
      }
    };
    const onCancel = () => {
      dragRef.current = undefined;
      setDrag(undefined);
      cleanup();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    dragCleanup.current = cleanup;
  }

  function saveName(): void {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === store.name) {
      return;
    }
    run(async () => {
      onChanged(await renameStore(store.id, trimmed));
    });
  }

  const closeRef = useRef(() => {});
  closeRef.current = () => {
    saveName();
    onClose();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        className="modal-backdrop"
        aria-label={t.quickAdd.close}
        onClick={() => closeRef.current()}
      />
      <div className="modal" role="dialog" aria-modal="true" aria-label={store.name}>
        <label>
          {t.stores.name}
          <input
            type="text"
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            onBlur={saveName}
          />
        </label>
        <h3>{t.stores.orderTitle}</h3>
        <ol className="category-order" ref={listRef}>
          {(drag === undefined ? ordered : moveItem(ordered, drag.from, drag.to)).map(
            (category, index) => (
              <li
                key={category.id}
                className={drag !== undefined && index === drag.to ? 'dragging' : undefined}
              >
                <button
                  type="button"
                  className="drag-handle"
                  tabIndex={-1}
                  aria-hidden="true"
                  onPointerDown={(event) => startDrag(index, event)}
                >
                  ⠿
                </button>
                <span className="category-order-name">{category.name}</span>
                <button
                  type="button"
                  aria-label={`${t.stores.moveUp}: ${category.name}`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`${t.stores.moveDown}: ${category.name}`}
                  disabled={index === ordered.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
              </li>
            ),
          )}
        </ol>
        <div className="modal-actions">
          <button type="button" className="primary" onClick={() => closeRef.current()}>
            {t.stores.done}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * The household's staples (salt, oil, …): ingredients the recipe import
 * does not preselect. Editing always saves the full list; removing the
 * custom list brings the defaults back.
 */
function StaplesSection() {
  const t = useT();
  const [data, setData] = useState<HouseholdStaples>();
  const [error, setError] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchStaples()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function run(action: () => Promise<HouseholdStaples>): void {
    setError(false);
    action()
      .then(setData)
      .catch(() => setError(true));
  }

  function onAdd(event: FormEvent): void {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '' || data === undefined) {
      return;
    }
    setName('');
    run(() => saveStaples([...data.staples, trimmed]));
  }

  return (
    <>
      <h2>{t.staples.title}</h2>
      <p className="placeholder">{t.staples.intro}</p>
      {data === undefined ? (
        <p className="placeholder">{error ? t.common.error : t.common.loading}</p>
      ) : (
        <>
          {data.staples.length === 0 && <p className="placeholder">{t.staples.empty}</p>}
          <ul className="staples">
            {data.staples.map((staple) => (
              <li key={staple} className="staple">
                {staple}
                <button
                  type="button"
                  aria-label={`${t.staples.remove}: ${staple}`}
                  onClick={() => run(() => saveStaples(data.staples.filter((s) => s !== staple)))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <form className="create-list" onSubmit={onAdd}>
            <input
              type="text"
              value={name}
              maxLength={100}
              placeholder={t.staples.newStaple}
              aria-label={t.staples.newStaple}
              onChange={(event) => setName(event.target.value)}
            />
            <button type="submit" className="primary">
              {t.staples.add}
            </button>
            {data.custom && (
              <button type="button" onClick={() => run(resetStaples)}>
                {t.staples.reset}
              </button>
            )}
          </form>
          {error && <p className="error">{t.common.error}</p>}
        </>
      )}
    </>
  );
}

/** Backup: downloads the household's JSON export as a file. */
function ExportSection() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function onDownload(): Promise<void> {
    setBusy(true);
    setError(false);
    try {
      const data = await fetchExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `drauf-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2>{t.backup.title}</h2>
      <p className="placeholder">{t.backup.intro}</p>
      <button type="button" disabled={busy} onClick={() => void onDownload()}>
        {t.backup.download}
      </button>
      {error && <p className="error">{t.common.error}</p>}
    </>
  );
}

export function StoresPage() {
  const t = useT();
  const [stores, setStores] = useState<StoreWithOrder[]>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState(false);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchStores(), fetchCategories()])
      .then(([storesResult, categoriesResult]) => {
        if (!cancelled) {
          setStores(storesResult);
          setCategories(categoriesResult);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function run(action: () => Promise<void>): void {
    setError(false);
    action().catch(() => setError(true));
  }

  function replaceStore(changed: StoreWithOrder): void {
    setStores((previous) =>
      (previous ?? []).map((item) => (item.id === changed.id ? changed : item)),
    );
  }

  function handleReset(store: StoreWithOrder): void {
    run(async () => {
      replaceStore(await setStoreCategoryOrder(store.id, []));
    });
  }

  function handleDelete(store: StoreWithOrder): void {
    if (!window.confirm(t.stores.deleteConfirm)) {
      return;
    }
    run(async () => {
      await deleteStore(store.id);
      setStores((previous) => (previous ?? []).filter((item) => item.id !== store.id));
    });
  }

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      return;
    }
    setError(false);
    try {
      const store = await createStore(trimmed);
      setStores((previous) => [...(previous ?? []), store]);
      setName('');
    } catch {
      setError(true);
    }
  }

  if (stores === undefined) {
    return <p className="placeholder">{error ? t.common.error : t.common.loading}</p>;
  }

  const editingStore = stores.find((store) => store.id === editingId);

  return (
    <section>
      <h1>{t.stores.title}</h1>
      <p className="placeholder">{t.stores.intro}</p>
      {stores.length === 0 && <p className="placeholder">{t.stores.empty}</p>}
      <ul className="store-rows">
        {stores.map((store) => (
          <li key={store.id} className="store-row">
            <span className="store-row-text">
              <span className="store-row-name">{store.name}</span>
              <span className="store-hint">
                {store.categoryOrder.length === 0 ? t.stores.defaultOrder : t.stores.customOrder}
              </span>
            </span>
            <button
              type="button"
              aria-label={`${t.stores.edit}: ${store.name}`}
              onClick={() => setEditingId(store.id)}
            >
              {t.stores.edit}
            </button>
            <button
              type="button"
              aria-label={`${t.stores.reset}: ${store.name}`}
              disabled={store.categoryOrder.length === 0}
              onClick={() => handleReset(store)}
            >
              {t.stores.reset}
            </button>
            <button
              type="button"
              className="danger"
              aria-label={`${t.stores.delete}: ${store.name}`}
              onClick={() => handleDelete(store)}
            >
              {t.stores.delete}
            </button>
          </li>
        ))}
      </ul>
      <form className="create-list" onSubmit={(event) => void onCreate(event)}>
        <input
          type="text"
          value={name}
          maxLength={100}
          placeholder={t.stores.newStoreName}
          aria-label={t.stores.newStoreName}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" className="primary">
          {t.stores.create}
        </button>
      </form>
      {error && <p className="error">{t.common.error}</p>}
      <StaplesSection />
      <ExportSection />
      <VersionLine />
      {editingStore !== undefined && (
        <StoreEditDialog
          store={editingStore}
          categories={categories}
          onChanged={replaceStore}
          onError={() => setError(true)}
          onClose={() => setEditingId(undefined)}
        />
      )}
    </section>
  );
}

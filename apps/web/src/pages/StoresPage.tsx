import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { fetchCategories } from '../api/lists';
import {
  createStore,
  deleteStore,
  fetchStores,
  renameStore,
  setStoreCategoryOrder,
} from '../api/stores';
import type { Category, StoreWithOrder } from '../api/types';
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

interface StoreCardProps {
  store: StoreWithOrder;
  categories: Category[];
  onChanged: (store: StoreWithOrder) => void;
  onDeleted: (store: StoreWithOrder) => void;
  onError: () => void;
}

function StoreCard({ store, categories, onChanged, onDeleted, onError }: StoreCardProps) {
  const t = useT();
  const [renaming, setRenaming] = useState<string>();
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
  // A drag may outlive the component (navigation mid-drag): drop listeners.
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

  function handleRename(event: FormEvent): void {
    event.preventDefault();
    const name = renaming?.trim() ?? '';
    setRenaming(undefined);
    if (name === '' || name === store.name) {
      return;
    }
    run(async () => {
      onChanged(await renameStore(store.id, name));
    });
  }

  function handleDelete(): void {
    if (!window.confirm(t.stores.deleteConfirm)) {
      return;
    }
    run(async () => {
      await deleteStore(store.id);
      onDeleted(store);
    });
  }

  return (
    <div className="store-card">
      <div className="store-head">
        {renaming === undefined ? (
          <h2>{store.name}</h2>
        ) : (
          <form className="rename-form" onSubmit={handleRename}>
            <input
              type="text"
              value={renaming}
              maxLength={100}
              aria-label={t.stores.rename}
              onChange={(event) => setRenaming(event.target.value)}
            />
            <button type="submit">{t.common.save}</button>
          </form>
        )}
        <div className="list-actions">
          <button type="button" onClick={() => setRenaming(store.name)}>
            {t.stores.rename}
          </button>
          <button type="button" className="danger" onClick={handleDelete}>
            {t.stores.delete}
          </button>
        </div>
      </div>
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
    </div>
  );
}

export function StoresPage() {
  const t = useT();
  const [stores, setStores] = useState<StoreWithOrder[]>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState(false);
  const [name, setName] = useState('');

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

  return (
    <section>
      <h1>{t.stores.title}</h1>
      <p className="placeholder">{t.stores.intro}</p>
      {stores.length === 0 && <p className="placeholder">{t.stores.empty}</p>}
      {stores.map((store) => (
        <StoreCard
          key={store.id}
          store={store}
          categories={categories}
          onChanged={(changed) =>
            setStores((previous) =>
              (previous ?? []).map((item) => (item.id === changed.id ? changed : item)),
            )
          }
          onDeleted={(deleted) =>
            setStores((previous) => (previous ?? []).filter((item) => item.id !== deleted.id))
          }
          onError={() => setError(true)}
        />
      ))}
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
    </section>
  );
}

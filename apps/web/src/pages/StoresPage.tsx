import { type FormEvent, useEffect, useState } from 'react';
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
  const ordered = orderedCategories(store, categories);

  function run(action: () => Promise<void>): void {
    action().catch(onError);
  }

  function move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= ordered.length) {
      return;
    }
    const ids = ordered.map((category) => category.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) {
      return;
    }
    ids.splice(target, 0, moved);
    run(async () => {
      onChanged(await setStoreCategoryOrder(store.id, ids));
    });
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
      <ol className="category-order">
        {ordered.map((category, index) => (
          <li key={category.id}>
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
        ))}
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

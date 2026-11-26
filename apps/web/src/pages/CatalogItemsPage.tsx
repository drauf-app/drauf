import { useEffect, useState } from 'react';
import {
  type AdminCatalogItem,
  type AdminCatalogItemPatch,
  deleteCatalogItem,
  fetchCatalogItems,
  patchCatalogItem,
} from '../api/catalog-admin';
import { fetchCategories } from '../api/lists';
import type { Category } from '../api/types';
import { IconPicker } from '../components/IconPicker';
import { ItemIcon } from '../components/ItemIcon';
import { useT } from '../i18n';

const PAGE_SIZE = 50;
const UPDATED_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });

/**
 * Admin editor for the household's learned/custom items (#111): the rows
 * behind quick-add suggestions and guessed categories. Renames merge into an
 * existing row server-side, so fixing a typo folds its history into the
 * correct spelling.
 */
export function CatalogItemsPage() {
  const t = useT();
  const [items, setItems] = useState<AdminCatalogItem[]>();
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState('');
  const [customOnly, setCustomOnly] = useState(false);
  const [editing, setEditing] = useState<{ nameNormalized: string; name: string; icon: string }>();
  const [actionFailed, setActionFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCategories()
      .then((result) => {
        if (!cancelled) setCategories(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        fetchCatalogItems({ q, custom: customOnly, limit: PAGE_SIZE })
          .then((page) => {
            if (!cancelled) {
              setItems(page.items);
              setTotal(page.total);
            }
          })
          .catch(() => {
            if (!cancelled) setActionFailed(true);
          });
      },
      q === '' ? 0 : 250,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, customOnly]);

  function loadMore(): void {
    fetchCatalogItems({ q, custom: customOnly, offset: items?.length ?? 0, limit: PAGE_SIZE })
      .then((page) => {
        setItems((previous) => [...(previous ?? []), ...page.items]);
        setTotal(page.total);
      })
      .catch(() => setActionFailed(true));
  }

  function reload(): void {
    fetchCatalogItems({ q, custom: customOnly, limit: PAGE_SIZE })
      .then((page) => {
        setItems(page.items);
        setTotal(page.total);
      })
      .catch(() => setActionFailed(true));
  }

  function apply(nameNormalized: string, patch: AdminCatalogItemPatch, refetch = false): void {
    setActionFailed(false);
    patchCatalogItem(nameNormalized, patch)
      .then((updated) => {
        if (refetch) {
          // A rename may have merged two rows; rebuild the list.
          reload();
        } else {
          setItems((previous) =>
            (previous ?? []).map((item) =>
              item.nameNormalized === nameNormalized ? updated : item,
            ),
          );
        }
      })
      .catch(() => setActionFailed(true));
  }

  function handleDelete(item: AdminCatalogItem): void {
    if (!window.confirm(t.catalogItems.deleteConfirm)) {
      return;
    }
    setActionFailed(false);
    deleteCatalogItem(item.nameNormalized)
      .then(() => {
        setItems((previous) =>
          (previous ?? []).filter((row) => row.nameNormalized !== item.nameNormalized),
        );
        setTotal((previous) => previous - 1);
      })
      .catch(() => setActionFailed(true));
  }

  function handleEditSave(item: AdminCatalogItem): void {
    if (editing === undefined) {
      return;
    }
    const patch: AdminCatalogItemPatch = {};
    const name = editing.name.trim();
    if (name !== '' && name !== item.name) {
      patch.name = name;
    }
    if (editing.icon !== (item.icon ?? '')) {
      patch.icon = editing.icon;
    }
    setEditing(undefined);
    if (Object.keys(patch).length === 0) {
      return;
    }
    apply(item.nameNormalized, patch, patch.name !== undefined);
  }

  if (items === undefined) {
    return <p className="placeholder">{t.common.loading}</p>;
  }

  function row(item: AdminCatalogItem) {
    if (editing?.nameNormalized === item.nameNormalized) {
      return (
        <li key={item.nameNormalized} className="catalog-item">
          <form
            className="catalog-item-edit"
            onSubmit={(event) => {
              event.preventDefault();
              handleEditSave(item);
            }}
          >
            <IconPicker
              value={editing.icon}
              clearLabel={t.catalogItems.iconAuto}
              pickLabel={t.catalogItems.pickIcon}
              onChange={(icon) => setEditing({ ...editing, icon })}
            />
            <input
              type="text"
              value={editing.name}
              maxLength={100}
              aria-label={t.catalogItems.name}
              // biome-ignore lint/a11y/noAutofocus: the form only appears on an explicit edit action.
              autoFocus
              onChange={(event) => setEditing({ ...editing, name: event.target.value })}
            />
            <button type="submit">{t.common.save}</button>
            <button type="button" onClick={() => setEditing(undefined)}>
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(undefined);
                apply(item.nameNormalized, { clearVariants: true, clearLastUsed: true });
              }}
            >
              {t.catalogItems.resetLearned}
            </button>
          </form>
        </li>
      );
    }
    return (
      <li key={item.nameNormalized} className="catalog-item">
        <span className="catalog-item-icon" aria-hidden="true">
          {item.icon !== null && <ItemIcon icon={item.icon} />}
        </span>
        <span className="catalog-item-text">
          <span className="catalog-item-name">
            {item.name}
            {item.custom && (
              <span className="catalog-item-badge">{t.catalogItems.customBadge}</span>
            )}
          </span>
          <span className="catalog-item-meta">
            {item.count}
            {t.catalogItems.usedSuffix} · {UPDATED_FORMAT.format(new Date(item.updatedAt))}
            {item.variants.length > 0 && <> · {item.variants.join(' · ')}</>}
          </span>
        </span>
        <select
          aria-label={`${t.catalogItems.category}: ${item.name}`}
          value={item.categoryId ?? ''}
          onChange={(event) =>
            apply(item.nameNormalized, {
              categoryId: event.target.value === '' ? null : event.target.value,
            })
          }
        >
          <option value="">{t.catalogItems.noCategory}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="icon-button"
          aria-label={`${t.catalogItems.edit}: ${item.name}`}
          onClick={() =>
            setEditing({
              nameNormalized: item.nameNormalized,
              name: item.name,
              icon: item.icon ?? '',
            })
          }
        >
          ✎
        </button>
        <button
          type="button"
          className="icon-button danger"
          aria-label={`${t.catalogItems.delete}: ${item.name}`}
          onClick={() => handleDelete(item)}
        >
          ✕
        </button>
      </li>
    );
  }

  return (
    <section className="catalog-admin">
      <h1>{t.catalogItems.title}</h1>
      <p className="placeholder">{t.catalogItems.intro}</p>

      <div className="catalog-admin-controls">
        <input
          type="search"
          value={q}
          placeholder={t.catalogItems.searchPlaceholder}
          aria-label={t.catalogItems.searchPlaceholder}
          onChange={(event) => setQ(event.target.value)}
        />
        <label className="catalog-admin-custom">
          <input
            type="checkbox"
            checked={customOnly}
            onChange={(event) => setCustomOnly(event.target.checked)}
          />
          {t.catalogItems.customOnly}
        </label>
      </div>

      {actionFailed && <p className="error">{t.common.error}</p>}
      {items.length === 0 && <p className="placeholder">{t.catalogItems.empty}</p>}
      <ul className="catalog-items">{items.map(row)}</ul>

      {items.length < total && (
        <button type="button" onClick={loadMore}>
          {t.catalogItems.loadMore}
        </button>
      )}
    </section>
  );
}

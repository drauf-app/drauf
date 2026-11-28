import { parseIconId, splitVariants } from '@drauf/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { fetchCategories, fetchEntries, fetchList } from '../api/lists';
import { fetchStores } from '../api/stores';
import type { Category, EntryView, ListDetail, StoreWithOrder } from '../api/types';
import { useT } from '../i18n';
import { type CategoryGroup, formatQuantities, groupEntries, recentEntries } from '../lib/entries';
import { fluentUrlForHex } from '../lib/fluent';
import { useIconRegistry } from '../lib/icon-registry';
import { openMojiUrl, openMojiUrlForHex } from '../lib/openmoji';

type ColumnChoice = 'auto' | 1 | 2;

interface ListPrintSettings {
  /** Include the checked items as a muted "Zuletzt gekauft" block. */
  showRecent: boolean;
  columns: ColumnChoice;
}

const SETTINGS_KEY = 'drauf.list-print-settings';
/** From here on a single column would push a weekly shop past one A4 page. */
const TWO_COLUMN_THRESHOLD = 18;

function loadSettings(): ListPrintSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<ListPrintSettings>;
      return {
        showRecent: parsed.showRecent === true,
        columns: parsed.columns === 1 || parsed.columns === 2 ? parsed.columns : 'auto',
      };
    }
  } catch {
    // Fall through to the defaults.
  }
  return { showRecent: false, columns: 'auto' };
}

const DATE_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });

/** A group costs its items plus one line for the header. */
function groupWeight(group: CategoryGroup): number {
  return group.entries.length + 1;
}

/**
 * Splits the groups into two stacks of roughly equal line count. Rendering
 * two explicit stacks instead of CSS `columns` keeps the print output
 * deterministic: multicol balancing in paged media differs between engines
 * and collapsed to a single column in real print previews.
 */
export function splitGroups(groups: CategoryGroup[]): [CategoryGroup[], CategoryGroup[]] {
  const total = groups.reduce((sum, group) => sum + groupWeight(group), 0);
  const left: CategoryGroup[] = [];
  const right: CategoryGroup[] = [];
  let leftWeight = 0;
  for (const group of groups) {
    if (leftWeight < total / 2) {
      left.push(group);
      leftWeight += groupWeight(group);
    } else {
      right.push(group);
    }
  }
  return [left, right];
}

/**
 * Category icon as a real <img>, not the usual CSS mask: masks paint via
 * background-color, which print dialogs skip by default ("background
 * graphics"), leaving a solid square. The line-art SVGs print fine as images.
 */
function PrintCategoryIcon({ icon }: { icon: string }) {
  const registry = useIconRegistry();
  const ref = parseIconId(icon);
  const url =
    ref.type === 'emoji'
      ? openMojiUrl(ref.emoji)
      : ref.pack === 'openmoji'
        ? openMojiUrlForHex(ref.key)
        : ref.pack === 'fluent'
          ? fluentUrlForHex(ref.key)
          : registry.byId.get(icon)?.url;
  if (url !== undefined) {
    return <img className="print-cat-icon" src={url} alt="" aria-hidden="true" />;
  }
  return ref.type === 'emoji' ? ref.emoji : null;
}

function itemRow(entry: EntryView, checked: boolean) {
  const quantities = formatQuantities(entry.quantities);
  const extras = [entry.variant ?? '', ...splitVariants(entry.flags)]
    .filter((part) => part !== '')
    .join(' · ');
  return (
    <div key={entry.id} className="print-item">
      <span className="print-box" aria-hidden="true">
        {checked ? '✓' : ''}
      </span>
      <span className="print-item-name">
        {entry.name}
        {extras !== '' && <span className="print-item-extra"> {extras}</span>}
        {entry.note !== null && <span className="print-item-note">{entry.note}</span>}
      </span>
      {quantities !== '' && <span className="print-item-qty">{quantities}</span>}
    </div>
  );
}

export function ListPrintPage() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const listId = params.id ?? '';
  const [settings, setSettings] = useState<ListPrintSettings>(loadSettings);
  /** undefined = not touched yet, the list's default store applies. */
  const [storeChoice, setStoreChoice] = useState<string | null>();
  const [list, setList] = useState<ListDetail>();
  const [entries, setEntries] = useState<EntryView[]>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [stores, setStores] = useState<StoreWithOrder[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  function updateSettings(patch: Partial<ListPrintSettings>): void {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // Settings then last only for this visit.
      }
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchList(listId), fetchEntries(listId), fetchCategories(), fetchStores()])
      .then(([listResult, entriesResult, categoriesResult, storesResult]) => {
        if (!cancelled) {
          setList(listResult);
          setEntries(entriesResult);
          setCategories(categoriesResult);
          setStores(storesResult);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [listId]);

  if (loadFailed) {
    return <p className="error">{t.common.error}</p>;
  }
  if (list === undefined || entries === undefined) {
    return <p className="placeholder">{t.common.loading}</p>;
  }

  const storeId = storeChoice === undefined ? list.defaultStoreId : storeChoice;
  const selectedStore = stores.find((store) => store.id === storeId);
  const groups = groupEntries(
    entries,
    categories,
    selectedStore?.categoryOrder,
    selectedStore?.excludedCategoryIds,
  );
  const carriedGroups = groups.filter((group) => group.excluded !== true);
  const excludedGroups = groups.filter((group) => group.excluded === true);
  const recent = recentEntries(entries);
  const openCount = groups.reduce((sum, group) => sum + group.entries.length, 0);
  const columnCount =
    settings.columns === 'auto' ? (openCount >= TWO_COLUMN_THRESHOLD ? 2 : 1) : settings.columns;

  function renderGroup(group: CategoryGroup) {
    return (
      <section key={group.category?.id ?? 'uncategorized'} className="print-group">
        <h2>
          {group.category?.icon != null && <PrintCategoryIcon icon={group.category.icon} />}
          {group.category?.name ?? t.list.uncategorized}
        </h2>
        {group.entries.map((entry) => itemRow(entry, false))}
      </section>
    );
  }

  return (
    <div className="print-page">
      <style>{'@page { size: A4 portrait; margin: 12mm; }'}</style>

      <div className="print-controls">
        <Link to={`/lists/${listId}`}>{t.list.print.back}</Link>
        {stores.length > 0 && (
          <label>
            {t.list.storePicker}
            <select
              value={storeId ?? ''}
              onChange={(event) =>
                setStoreChoice(event.target.value === '' ? null : event.target.value)
              }
            >
              <option value="">{t.list.householdOrder}</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {t.list.print.columns}
          <select
            value={String(settings.columns)}
            onChange={(event) =>
              updateSettings({
                columns:
                  event.target.value === 'auto' ? 'auto' : (Number(event.target.value) as 1 | 2),
              })
            }
          >
            <option value="auto">{t.list.print.columnsAuto}</option>
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </label>
        <label className="print-check">
          <input
            type="checkbox"
            checked={settings.showRecent}
            onChange={(event) => updateSettings({ showRecent: event.target.checked })}
          />
          {t.list.print.showRecent}
        </label>
        <button type="button" className="primary" onClick={() => window.print()}>
          {t.list.print.action}
        </button>
      </div>

      <header className="print-header">
        <h1>{list.name}</h1>
        <span className="print-range">
          {[selectedStore?.name, DATE_FORMAT.format(new Date())]
            .filter((part) => part !== undefined)
            .join(' · ')}
        </span>
      </header>

      {openCount === 0 && <p className="placeholder">{t.list.empty}</p>}
      {columnCount === 2 ? (
        <div className="print-list two-columns">
          {splitGroups(carriedGroups).map((column, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: exactly two stable columns.
            <div key={index} className="print-column">
              {column.map(renderGroup)}
            </div>
          ))}
        </div>
      ) : (
        <div className="print-list">{carriedGroups.map(renderGroup)}</div>
      )}

      {excludedGroups.length > 0 && (
        <section className="print-excluded">
          <h2 className="print-excluded-heading">{t.list.notInStore}</h2>
          {excludedGroups.map(renderGroup)}
        </section>
      )}

      {settings.showRecent && recent.length > 0 && (
        <section className="print-recent">
          <h2>{t.list.recent}</h2>
          {recent.map((entry) => itemRow(entry, true))}
        </section>
      )}
    </div>
  );
}

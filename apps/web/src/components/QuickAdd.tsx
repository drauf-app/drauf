import { parseItemLine } from '@drauf/shared';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';
import type { AddEntryInput, PatchEntryInput } from '../api/lists';
import { fetchSuggestions } from '../api/lists';
import type { EntryView, Suggestion } from '../api/types';
import { useT } from '../i18n';
import { buildChipGroups, type Chip, clearingPatch, isChipActive } from '../lib/chips';
import { formatQuantities } from '../lib/entries';

const SUGGEST_DEBOUNCE_MS = 150;

interface QuickAddProps {
  /** Current entries; the details view reflects the live entry state. */
  entries: EntryView[];
  /** Adds and returns the (possibly merged or local) entry, or undefined on failure. */
  onAdd: (input: AddEntryInput) => Promise<EntryView | undefined>;
  onPatch: (entryId: string, fields: PatchEntryInput) => void;
}

interface DetailsTarget {
  entryId: string;
  suggestion: Suggestion | undefined;
}

function ChipRow({
  chips,
  entry,
  onPatch,
  children,
}: {
  chips: Chip[];
  entry: EntryView;
  onPatch: QuickAddProps['onPatch'];
  children?: ReactNode;
}) {
  return (
    <div className="chip-group">
      {chips.map((chip) => {
        const active = isChipActive(entry, chip);
        const classes = ['chip'];
        if (active) classes.push('active');
        if (chip.highlighted && !active) classes.push('highlighted');
        return (
          <button
            key={chip.label}
            type="button"
            className={classes.join(' ')}
            onClick={() => onPatch(entry.id, active ? clearingPatch(chip) : chip.patch)}
          >
            {chip.label}
          </button>
        );
      })}
      {children}
    </div>
  );
}

/** The "+" chip: an inline input that applies a custom variant (K2). */
function CustomVariantChip({
  entry,
  onPatch,
}: {
  entry: EntryView;
  onPatch: QuickAddProps['onPatch'];
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  if (!editing) {
    return (
      <button
        type="button"
        className="chip chip-add"
        aria-label={t.quickAdd.customVariant}
        onClick={() => setEditing(true)}
      >
        +
      </button>
    );
  }
  return (
    <form
      className="chip-input"
      onSubmit={(event) => {
        event.preventDefault();
        const variant = value.trim();
        if (variant !== '') {
          onPatch(entry.id, { variant });
        }
        setEditing(false);
        setValue('');
      }}
    >
      <input
        type="text"
        value={value}
        maxLength={64}
        placeholder={t.quickAdd.customVariant}
        aria-label={t.quickAdd.customVariant}
        // biome-ignore lint/a11y/noAutofocus: the input only appears on an explicit tap.
        autoFocus
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" aria-label={t.quickAdd.applyVariant}>
        ✓
      </button>
    </form>
  );
}

/**
 * The quick-add drawer: typing opens it over the list with suggestion tiles;
 * picking one (or submitting free text) adds the entry immediately and shows
 * its details, whose chips adjust the entry in place. The input stays ready
 * for the next article the whole time.
 */
export function QuickAdd({ entries, onAdd, onPatch }: QuickAddProps) {
  const t = useT();
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [details, setDetails] = useState<DetailsTarget>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const requestSeq = useRef(0);

  // The entry may change under the drawer (chip patches, live sync, deletes).
  const detailsEntry =
    details === undefined ? undefined : entries.find((entry) => entry.id === details.entryId);

  function stopPendingFetch(): void {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
    }
    requestSeq.current += 1;
  }

  function close(): void {
    stopPendingFetch();
    setOpen(false);
    setDetails(undefined);
    setValue('');
    setSuggestions([]);
  }

  function updateValue(next: string): void {
    setValue(next);
    setOpen(true);
    if (next.trim() !== '') {
      setDetails(undefined);
    }
    stopPendingFetch();
    const query = next.trim();
    if (query === '') {
      setSuggestions([]);
      return;
    }
    const seq = requestSeq.current;
    timer.current = setTimeout(() => {
      fetchSuggestions(query)
        .then((result) => {
          if (requestSeq.current === seq) {
            setSuggestions(result);
          }
        })
        .catch(() => {
          if (requestSeq.current === seq) {
            setSuggestions([]);
          }
        });
    }, SUGGEST_DEBOUNCE_MS);
  }

  async function added(input: AddEntryInput, suggestion: Suggestion | undefined): Promise<void> {
    stopPendingFetch();
    setValue('');
    setSuggestions([]);
    const entry = await onAdd(input);
    if (entry !== undefined) {
      setDetails({ entryId: entry.id, suggestion });
      setOpen(true);
    }
  }

  async function pick(suggestion: Suggestion): Promise<void> {
    await added(
      {
        name: suggestion.name,
        ...(suggestion.categoryId !== null ? { categoryId: suggestion.categoryId } : {}),
      },
      suggestion,
    );
  }

  async function submitFreeText(event: FormEvent): Promise<void> {
    event.preventDefault();
    const parsed = parseItemLine(value);
    if (parsed.name.trim() === '') {
      return;
    }
    await added(
      {
        name: parsed.name,
        ...(parsed.quantity !== undefined ? { quantity: parsed.quantity } : {}),
        ...(parsed.unit !== undefined ? { unit: parsed.unit } : {}),
      },
      undefined,
    );
  }

  const showDetails = open && detailsEntry !== undefined;
  const groups = showDetails ? buildChipGroups(details?.suggestion) : undefined;

  return (
    <>
      {open && (
        <button
          type="button"
          className="drawer-backdrop"
          aria-label={t.quickAdd.close}
          onClick={close}
        />
      )}
      <div className="quick-add-area">
        {showDetails && detailsEntry !== undefined && groups !== undefined && (
          <div className="drawer-details">
            <div className="drawer-item">
              {detailsEntry.icon !== null && (
                <span className="drawer-item-icon">{detailsEntry.icon}</span>
              )}
              <span className="drawer-item-name">
                {detailsEntry.name}
                {detailsEntry.variant !== null && (
                  <span className="entry-variant"> {detailsEntry.variant}</span>
                )}
              </span>
              <span className="drawer-item-quantity">
                {formatQuantities(detailsEntry.quantities)}
              </span>
            </div>
            <ChipRow chips={groups.counts} entry={detailsEntry} onPatch={onPatch} />
            {groups.sizes.length > 0 && (
              <ChipRow chips={groups.sizes} entry={detailsEntry} onPatch={onPatch} />
            )}
            <ChipRow chips={groups.varieties} entry={detailsEntry} onPatch={onPatch}>
              <CustomVariantChip entry={detailsEntry} onPatch={onPatch} />
            </ChipRow>
          </div>
        )}
        {open && !showDetails && suggestions.length > 0 && (
          <ul className="suggestion-tiles">
            {suggestions.map((suggestion) => (
              <li key={suggestion.name}>
                <button type="button" onClick={() => void pick(suggestion)}>
                  <span className="tile-icon">{suggestion.icon}</span>
                  <span className="tile-name">{suggestion.name}</span>
                  {suggestion.lastVariant != null && (
                    <span className="tile-meta">{suggestion.lastVariant}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="quick-add-form" onSubmit={(event) => void submitFreeText(event)}>
          <input
            type="text"
            value={value}
            maxLength={100}
            placeholder={showDetails ? t.quickAdd.nextArticle : t.quickAdd.placeholder}
            aria-label={showDetails ? t.quickAdd.nextArticle : t.quickAdd.placeholder}
            autoComplete="off"
            onFocus={() => setOpen(true)}
            onChange={(event) => updateValue(event.target.value)}
          />
          <button type="submit" className="primary">
            {t.quickAdd.add}
          </button>
          {open && (
            <button
              type="button"
              className="drawer-close"
              aria-label={t.quickAdd.close}
              onClick={close}
            >
              ×
            </button>
          )}
        </form>
      </div>
    </>
  );
}

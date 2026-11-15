import { ENTRY_FLAGS, parseItemLine, splitVariants } from '@drauf/shared';
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { AddEntryInput, PatchEntryInput } from '../api/lists';
import { fetchSuggestions } from '../api/lists';
import type { EntryView, Suggestion } from '../api/types';
import { useT } from '../i18n';
import {
  amountReplacePatch,
  buildChipGroups,
  type Chip,
  flagsTogglePatch,
  isChipActive,
  variantTogglePatch,
} from '../lib/chips';
import {
  draftFromEntry,
  draftPatch,
  isDraftActive,
  parseDetails,
  serializeDraft,
  toggleDraft,
} from '../lib/details';
import { formatQuantities } from '../lib/entries';
import { ItemIcon } from './ItemIcon';

const SUGGEST_DEBOUNCE_MS = 150;
const DETAILS_PATCH_DEBOUNCE_MS = 500;

interface QuickAddProps {
  /** Current entries; the details view reflects the live entry state. */
  entries: EntryView[];
  /** Adds and returns the (possibly merged or local) entry, or undefined on failure. */
  onAdd: (input: AddEntryInput) => Promise<EntryView | undefined>;
  onPatch: (entryId: string, fields: PatchEntryInput) => void;
}

function ChipRow({
  chips,
  isActive,
  onTap,
  children,
}: {
  chips: Chip[];
  isActive: (chip: Chip) => boolean;
  onTap: (chip: Chip) => void;
  children?: ReactNode;
}) {
  return (
    <div className="chip-group">
      {chips.map((chip) => {
        const active = isActive(chip);
        const classes = ['chip'];
        if (active) classes.push('active');
        if (chip.highlighted && !active) classes.push('highlighted');
        return (
          <button
            key={chip.label}
            type="button"
            className={classes.join(' ')}
            onClick={() => onTap(chip)}
          >
            {chip.label}
          </button>
        );
      })}
      {children}
    </div>
  );
}

/** The "+" chip: an inline input that applies custom modifiers (K2). */
function CustomVariantChip({ onApply }: { onApply: (text: string) => void }) {
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
          onApply(variant);
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
 * Details for the just-added entry: amount/variety chips, the fixed flags,
 * and the "Eigene Details bearbeiten" text field — one comma list (count,
 * size, modifiers) parsed live in both directions while it is open.
 */
function DetailsView({
  entry,
  suggestion,
  onPatch,
}: {
  entry: EntryView;
  suggestion: Suggestion | undefined;
  onPatch: QuickAddProps['onPatch'];
}) {
  const t = useT();
  const groups = buildChipGroups(suggestion);
  // undefined = the text field is closed; otherwise it is the source of truth.
  const [raw, setRaw] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flush = useRef<() => void>(() => {});
  const draft = raw === undefined ? undefined : parseDetails(raw);

  flush.current = () => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
      if (raw !== undefined) {
        const patch = draftPatch(entry, parseDetails(raw));
        if (Object.keys(patch).length > 0) {
          onPatch(entry.id, patch);
        }
      }
    }
  };
  // Pending edits must not get lost when the drawer moves on or closes.
  useEffect(() => () => flush.current(), []);

  function schedulePatch(nextRaw: string): void {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => {
      timer.current = undefined;
      const patch = draftPatch(entry, parseDetails(nextRaw));
      if (Object.keys(patch).length > 0) {
        onPatch(entry.id, patch);
      }
    }, DETAILS_PATCH_DEBOUNCE_MS);
  }

  function updateRaw(next: string): void {
    setRaw(next);
    schedulePatch(next);
  }

  function chipTap(chip: Chip): void {
    if (draft !== undefined) {
      updateRaw(serializeDraft(toggleDraft(draft, chip)));
      return;
    }
    onPatch(
      entry.id,
      chip.patch.variant !== undefined
        ? variantTogglePatch(entry, chip.patch.variant)
        : amountReplacePatch(entry, chip, isChipActive(entry, chip)),
    );
  }

  function applyCustom(text: string): void {
    // Merging through the draft splits typed comma lists into modifiers.
    const merged = parseDetails(`${serializeDraft(draftFromEntry(entry))}, ${text}`);
    const patch = draftPatch(entry, merged);
    if (Object.keys(patch).length > 0) {
      onPatch(entry.id, patch);
    }
  }

  const isActive = (chip: Chip) =>
    draft !== undefined ? isDraftActive(draft, chip) : isChipActive(entry, chip);
  const entryFlags = splitVariants(entry.flags);

  return (
    <div className="drawer-details">
      <div className="drawer-item">
        {entry.icon !== null && (
          <span className="drawer-item-icon">
            <ItemIcon icon={entry.icon} />
          </span>
        )}
        <span className="drawer-item-name">
          {entry.name}
          {entry.variant !== null && <span className="entry-variant"> {entry.variant}</span>}
        </span>
        <span className="drawer-item-quantity">{formatQuantities(entry.quantities)}</span>
      </div>
      {entry.note !== null && (
        <div className="drawer-note">
          <ItemIcon icon="📝" /> {entry.note}
        </div>
      )}
      {entry.note === null && suggestion?.lastNote != null && (
        <button
          type="button"
          className="note-suggestion"
          onClick={() => onPatch(entry.id, { note: suggestion.lastNote as string })}
        >
          <ItemIcon icon="📝" /> {t.quickAdd.lastNote}: „{suggestion.lastNote}“
        </button>
      )}

      {raw !== undefined ? (
        <div className="details-editor">
          <input
            type="text"
            value={raw}
            maxLength={200}
            aria-label={t.quickAdd.detailsField}
            // biome-ignore lint/a11y/noAutofocus: the field only appears on an explicit tap.
            autoFocus
            onChange={(event) => updateRaw(event.target.value)}
          />
          <button
            type="button"
            aria-label={t.quickAdd.closeDetails}
            onClick={() => {
              flush.current();
              setRaw(undefined);
            }}
          >
            ✓
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="details-toggle"
          onClick={() => setRaw(serializeDraft(draftFromEntry(entry)))}
        >
          {t.quickAdd.editDetails}
        </button>
      )}

      <ChipRow chips={groups.counts} isActive={isActive} onTap={chipTap} />
      {groups.sizes.length > 0 && (
        <ChipRow chips={groups.sizes} isActive={isActive} onTap={chipTap} />
      )}
      <ChipRow chips={groups.varieties} isActive={isActive} onTap={chipTap}>
        {raw === undefined && <CustomVariantChip onApply={applyCustom} />}
      </ChipRow>
      <div className="chip-group chip-flags">
        {ENTRY_FLAGS.map((flag) => (
          <button
            key={flag}
            type="button"
            className={entryFlags.includes(flag) ? 'chip chip-flag active' : 'chip chip-flag'}
            onClick={() => onPatch(entry.id, flagsTogglePatch(entry, flag))}
          >
            {flag}
          </button>
        ))}
      </div>
    </div>
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
  // Keyboard highlight in the suggestions (combobox-style); -1 = none.
  const [highlight, setHighlight] = useState(-1);
  const [details, setDetails] = useState<{ entryId: string; suggestion: Suggestion | undefined }>();
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
    setHighlight(-1);
  }

  function updateValue(next: string): void {
    setValue(next);
    setOpen(true);
    if (next.trim() !== '') {
      setDetails(undefined);
    }
    stopPendingFetch();
    setHighlight(-1);
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
            setHighlight(-1);
          }
        })
        .catch(() => {
          if (requestSeq.current === seq) {
            setSuggestions([]);
            setHighlight(-1);
          }
        });
    }, SUGGEST_DEBOUNCE_MS);
  }

  async function added(input: AddEntryInput, suggestion: Suggestion | undefined): Promise<void> {
    stopPendingFetch();
    setValue('');
    setSuggestions([]);
    setHighlight(-1);
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
  const suggesting = open && !showDetails && suggestions.length > 0;

  // Keep the highlighted tile in view when the suggestion grid scrolls.
  useEffect(() => {
    if (highlight < 0) {
      return;
    }
    const option = document.getElementById(`quick-add-option-${highlight}`);
    if (option !== null && typeof option.scrollIntoView === 'function') {
      option.scrollIntoView({ block: 'nearest' });
    }
  }, [highlight]);

  /**
   * Combobox-style keyboard access (focus stays in the input): Up/Down move
   * the highlight through the tiles, Enter adds the highlighted suggestion.
   * Left/Right stay untouched so the caret keeps working. Without a
   * highlight, Enter falls through to the free-text submit.
   */
  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (!open) {
      return;
    }
    if (event.key === 'ArrowDown' && suggesting) {
      event.preventDefault();
      setHighlight((current) => (current + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp' && suggesting) {
      event.preventDefault();
      setHighlight((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === 'Enter' && suggesting && highlight >= 0) {
      event.preventDefault();
      const suggestion = suggestions[highlight];
      if (suggestion !== undefined) {
        void pick(suggestion);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (suggesting && highlight >= 0) {
        setHighlight(-1);
      } else {
        close();
      }
    }
  }

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
        {showDetails && detailsEntry !== undefined && (
          <DetailsView
            key={detailsEntry.id}
            entry={detailsEntry}
            suggestion={details?.suggestion}
            onPatch={onPatch}
          />
        )}
        {suggesting && (
          <div
            className="suggestion-tiles"
            id="quick-add-suggestions"
            role="listbox"
            aria-label={t.quickAdd.suggestions}
          >
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.name}
                type="button"
                role="option"
                id={`quick-add-option-${index}`}
                aria-selected={index === highlight}
                onClick={() => void pick(suggestion)}
              >
                <span className="tile-icon">
                  {suggestion.icon !== null ? <ItemIcon icon={suggestion.icon} /> : ''}
                </span>
                <span className="tile-name">{suggestion.name}</span>
              </button>
            ))}
          </div>
        )}
        <form className="quick-add-form" onSubmit={(event) => void submitFreeText(event)}>
          <input
            type="text"
            value={value}
            maxLength={100}
            placeholder={showDetails ? t.quickAdd.nextArticle : t.quickAdd.placeholder}
            aria-label={showDetails ? t.quickAdd.nextArticle : t.quickAdd.placeholder}
            autoComplete="off"
            role="combobox"
            aria-expanded={suggesting}
            aria-controls="quick-add-suggestions"
            aria-autocomplete="list"
            aria-activedescendant={
              suggesting && highlight >= 0 ? `quick-add-option-${highlight}` : undefined
            }
            onFocus={() => setOpen(true)}
            onChange={(event) => updateValue(event.target.value)}
            onKeyDown={onKeyDown}
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

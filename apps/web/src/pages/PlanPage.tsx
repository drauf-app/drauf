import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  createPlanEntry,
  deletePlanEntry,
  fetchHousehold,
  fetchPlanEntries,
  fetchRecipeSuggestions,
  fetchSlots,
  type PlanEntryPatch,
  patchPlanEntry,
  type RecipeSuggestion,
} from '../api/plan';
import type { HouseholdMember, MealSlot, PlanEntry } from '../api/types';
import { useT } from '../i18n';
import { applyPlanEvent } from '../lib/plan-events';
import { sourceLabel } from '../lib/source';
import { type SyncEvent, useSync } from '../lib/sync';
import { formatDay, formatLastCooked, formatWeek, weekDays } from '../lib/week';

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Entries sort by their label's configured order (Frühstück before
 * Abendessen), unlabeled last, ties by creation time.
 */
function sortDayEntries(entries: PlanEntry[], slots: MealSlot[]): PlanEntry[] {
  const order = new Map(slots.map((slot) => [slot.id, slot.sortOrder]));
  return [...entries].sort((a, b) => {
    const byLabel =
      (a.slotId === null ? Number.MAX_SAFE_INTEGER : (order.get(a.slotId) ?? 0)) -
      (b.slotId === null ? Number.MAX_SAFE_INTEGER : (order.get(b.slotId) ?? 0));
    return byLabel !== 0 ? byLabel : a.createdAt.localeCompare(b.createdAt);
  });
}

interface EditorProps {
  date: string;
  entry: PlanEntry | undefined;
  days: string[];
  slots: MealSlot[];
  members: HouseholdMember[];
  onClose: () => void;
  onSaved: (entry: PlanEntry, previousId?: string) => void;
  onDeleted: (entry: PlanEntry) => void;
}

function EntryEditor({
  date,
  entry,
  days,
  slots,
  members,
  onClose,
  onSaved,
  onDeleted,
}: EditorProps) {
  const t = useT();
  const [value, setValue] = useState(entry?.link ?? entry?.text ?? '');
  const [cookId, setCookId] = useState(entry?.cookId ?? '');
  const [targetDate, setTargetDate] = useState(date);
  const [targetSlot, setTargetSlot] = useState(entry?.slotId ?? '');
  const [error, setError] = useState<string>();
  // Cooked-recipes memory (#88): previously planned meals as type-ahead.
  const [suggestions, setSuggestions] = useState<RecipeSuggestion[]>([]);
  const [picked, setPicked] = useState<RecipeSuggestion>();
  const [highlighted, setHighlighted] = useState(-1);

  const query = value.trim();
  useEffect(() => {
    if (query.length < 2 || isUrl(query) || query === picked?.text) {
      setSuggestions([]);
      setHighlighted(-1);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchRecipeSuggestions(query)
        .then((result) => {
          if (!cancelled) {
            setSuggestions(result);
            setHighlighted(-1);
          }
        })
        .catch(() => {
          // Suggestions are a convenience; typing stays the source of truth.
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, picked]);

  function pick(suggestion: RecipeSuggestion): void {
    setPicked(suggestion);
    setValue(suggestion.text);
    setSuggestions([]);
    setHighlighted(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (suggestions.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((previous) => (previous + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((previous) => (previous <= 0 ? suggestions.length - 1 : previous - 1));
    } else if (event.key === 'Escape') {
      // Close only the suggestion list; the dialog's own Escape stays out.
      event.stopPropagation();
      setSuggestions([]);
      setHighlighted(-1);
    } else if (event.key === 'Enter' && highlighted >= 0) {
      event.preventDefault();
      const target = suggestions[highlighted];
      if (target !== undefined) {
        pick(target);
      }
    }
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed === '') {
      return;
    }
    setError(undefined);
    // A picked suggestion carries its recipe link and image along (#88).
    const fromMemory = picked !== undefined && trimmed === picked.text ? picked : undefined;
    const content = isUrl(trimmed)
      ? { link: trimmed, text: '' }
      : {
          text: trimmed,
          link: fromMemory?.link ?? '',
          ...(fromMemory?.imageUrl == null ? {} : { imageUrl: fromMemory.imageUrl }),
        };
    try {
      if (entry === undefined) {
        const created = await createPlanEntry({
          date: targetDate,
          ...(targetSlot === '' ? {} : { slotId: targetSlot }),
          ...(isUrl(trimmed)
            ? { link: trimmed }
            : {
                text: trimmed,
                ...(fromMemory?.link == null ? {} : { link: fromMemory.link }),
                ...(fromMemory?.imageUrl == null ? {} : { imageUrl: fromMemory.imageUrl }),
              }),
          ...(cookId === '' ? {} : { cookId }),
        });
        onSaved(created);
      } else {
        const patch: PlanEntryPatch = {
          ...content,
          date: targetDate,
          // '' clears the label back to "none".
          slotId: targetSlot,
          cookId,
        };
        onSaved(await patchPlanEntry(entry.id, patch), entry.id);
      }
      onClose();
    } catch {
      setError(t.common.error);
    }
  }

  function handleDelete(): void {
    if (entry === undefined) {
      return;
    }
    deletePlanEntry(entry.id)
      .then(() => {
        onDeleted(entry);
        onClose();
      })
      .catch(() => setError(t.common.error));
  }

  // Escape closes the dialog (the suggestion list swallows its own Escape).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
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
        aria-label={t.common.cancel}
        onClick={onClose}
      />
      <div className="modal" role="dialog" aria-modal="true" aria-label={formatDay(date)}>
        <h3>{formatDay(date)}</h3>
        <form className="plan-editor" onSubmit={(event) => void onSubmit(event)}>
          <input
            type="text"
            value={value}
            maxLength={500}
            placeholder={t.plan.entryPlaceholder}
            aria-label={t.plan.entryPlaceholder}
            // biome-ignore lint/a11y/noAutofocus: the editor only opens on an explicit tap.
            autoFocus
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {suggestions.length > 0 && (
            <ul className="plan-suggestions" aria-label={t.plan.recipeSuggestions}>
              {suggestions.map((suggestion, index) => (
                <li key={suggestion.text}>
                  <button
                    type="button"
                    className={
                      index === highlighted ? 'plan-suggestion highlighted' : 'plan-suggestion'
                    }
                    onClick={() => pick(suggestion)}
                  >
                    <span className="plan-suggestion-text">{suggestion.text}</span>
                    <span className="plan-suggestion-when">
                      {formatLastCooked(suggestion.lastCookedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <select
            aria-label={t.plan.cook}
            value={cookId}
            onChange={(event) => setCookId(event.target.value)}
          >
            <option value="">{t.plan.noCook}</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.displayName}
              </option>
            ))}
          </select>
          <select
            aria-label={t.plan.moveSlot}
            value={targetSlot}
            onChange={(event) => setTargetSlot(event.target.value)}
          >
            <option value="">{t.plan.noSlot}</option>
            {slots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.name}
              </option>
            ))}
          </select>
          {entry !== undefined && (
            <div className="plan-move">
              <select
                aria-label={t.plan.moveDay}
                value={targetDate}
                onChange={(event) => setTargetDate(event.target.value)}
              >
                {(days.includes(entry.date) ? days : [entry.date, ...days]).map((day) => (
                  <option key={day} value={day}>
                    {formatDay(day)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {error !== undefined && <p className="error">{error}</p>}
          <div className="plan-editor-actions">
            <button type="submit" className="primary">
              {t.common.save}
            </button>
            <button type="button" onClick={onClose}>
              {t.common.cancel}
            </button>
            {entry !== undefined && (
              <button type="button" className="danger" onClick={handleDelete}>
                {t.plan.delete}
              </button>
            )}
          </div>
        </form>
      </div>
    </>
  );
}

interface EditorTarget {
  date: string;
  /** undefined = adding a new entry on that day. */
  entryId?: string;
}

export function PlanPage() {
  const t = useT();
  const [offset, setOffset] = useState(0);
  const [slots, setSlots] = useState<MealSlot[]>();
  const [entries, setEntries] = useState<PlanEntry[]>();
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [editor, setEditor] = useState<EditorTarget>();
  const [loadFailed, setLoadFailed] = useState(false);

  const days = weekDays(offset);
  const from = days[0] ?? '';
  const to = days[6] ?? '';

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSlots(), fetchHousehold()])
      .then(([slotsResult, household]) => {
        if (!cancelled) {
          setSlots([...slotsResult].sort((a, b) => a.sortOrder - b.sortOrder));
          setMembers(household.members);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useSync({ plan: true }, (_topic, event: SyncEvent) => {
    setEntries((previous) =>
      previous === undefined
        ? previous
        : applyPlanEvent({ entries: previous, slots: [] }, event).entries,
    );
    setSlots((previous) =>
      previous === undefined
        ? previous
        : applyPlanEvent({ entries: [], slots: previous }, event).slots,
    );
  });

  useEffect(() => {
    let cancelled = false;
    setEntries(undefined);
    fetchPlanEntries(from, to)
      .then((result) => {
        if (!cancelled) setEntries(result);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  if (loadFailed) {
    return <p className="error">{t.common.error}</p>;
  }
  if (slots === undefined || entries === undefined) {
    return <p className="placeholder">{t.common.loading}</p>;
  }

  const byDay = new Map<string, PlanEntry[]>();
  for (const entry of entries) {
    const group = byDay.get(entry.date);
    if (group === undefined) {
      byDay.set(entry.date, [entry]);
    } else {
      group.push(entry);
    }
  }
  const cookNames = new Map(members.map((member) => [member.userId, member.displayName]));
  const slotNames = new Map(slots.map((slot) => [slot.id, slot.name]));

  function handleSaved(saved: PlanEntry, previousId?: string): void {
    setEntries((previous) => [
      ...(previous ?? []).filter((item) => item.id !== (previousId ?? saved.id)),
      saved,
    ]);
  }

  function handleDeleted(deleted: PlanEntry): void {
    setEntries((previous) => (previous ?? []).filter((item) => item.id !== deleted.id));
  }

  return (
    <section className="plan-page">
      <header className="plan-header">
        <h1>{t.plan.title}</h1>
        <div className="plan-nav">
          <button
            type="button"
            aria-label={t.plan.previousWeek}
            onClick={() => setOffset(offset - 1)}
          >
            ‹
          </button>
          <button type="button" onClick={() => setOffset(0)} disabled={offset === 0}>
            {t.plan.thisWeek}
          </button>
          <button type="button" aria-label={t.plan.nextWeek} onClick={() => setOffset(offset + 1)}>
            ›
          </button>
          <span className="plan-week">{formatWeek(days)}</span>
          <Link className="plan-print-link" to="/plan/print">
            🖨 {t.plan.print.action}
          </Link>
        </div>
      </header>

      <div className="plan-days">
        {days.map((day) => {
          const dayEntries = sortDayEntries(byDay.get(day) ?? [], slots);
          return (
            <div key={day} className="plan-day">
              <h2>{formatDay(day)}</h2>
              <div className="plan-slots">
                {dayEntries.map((entry) => {
                  const label = entry.slotId === null ? undefined : slotNames.get(entry.slotId);
                  return (
                    <div key={entry.id} className="plan-cell">
                      <button
                        type="button"
                        className="plan-entry"
                        onClick={() => setEditor({ date: day, entryId: entry.id })}
                      >
                        {label !== undefined && <span className="plan-slot-name">{label}</span>}
                        <span className="plan-entry-text">
                          {entry.text ?? (entry.link === null ? '' : sourceLabel(entry.link))}
                        </span>
                        {entry.cookId !== null && (
                          <span className="plan-cook">{cookNames.get(entry.cookId) ?? ''}</span>
                        )}
                      </button>
                      {entry.link !== null && (
                        <a
                          className="plan-source"
                          href={entry.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={t.plan.openLink}
                        >
                          ({sourceLabel(entry.link)})
                        </a>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="plan-add"
                  aria-label={`${t.plan.addEntry}: ${formatDay(day)}`}
                  onClick={() => setEditor({ date: day })}
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {editor !== undefined && (
        <EntryEditor
          // Remount per target so the fields reset cleanly between entries.
          key={editor.entryId ?? `new-${editor.date}`}
          date={editor.date}
          entry={entries.find((item) => item.id === editor.entryId)}
          days={days}
          slots={slots}
          members={members}
          onClose={() => setEditor(undefined)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}
    </section>
  );
}

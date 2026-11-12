import { type FormEvent, useEffect, useState } from 'react';
import {
  createPlanEntry,
  deletePlanEntry,
  fetchHousehold,
  fetchPlanEntries,
  fetchSlots,
  type PlanEntryPatch,
  patchPlanEntry,
} from '../api/plan';
import type { HouseholdMember, MealSlot, PlanEntry } from '../api/types';
import { ApiError } from '../auth/store';
import { type Messages, useT } from '../i18n';
import { formatDay, formatWeek, weekDays } from '../lib/week';

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function cellKey(date: string, slotId: string): string {
  return `${date}|${slotId}`;
}

function saveErrorMessage(err: unknown, t: Messages): string {
  if (err instanceof ApiError && err.code === 'slot_occupied') {
    return t.plan.slotOccupied;
  }
  return t.common.error;
}

interface EditorProps {
  date: string;
  slotId: string;
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
  slotId,
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
  const [targetSlot, setTargetSlot] = useState(slotId);
  const [error, setError] = useState<string>();

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed === '') {
      return;
    }
    setError(undefined);
    const content = isUrl(trimmed) ? { link: trimmed, text: '' } : { text: trimmed, link: '' };
    try {
      if (entry === undefined) {
        const created = await createPlanEntry({
          date: targetDate,
          slotId: targetSlot,
          ...(isUrl(trimmed) ? { link: trimmed } : { text: trimmed }),
          ...(cookId === '' ? {} : { cookId }),
        });
        onSaved(created);
      } else {
        const patch: PlanEntryPatch = {
          ...content,
          date: targetDate,
          slotId: targetSlot,
          cookId,
        };
        onSaved(await patchPlanEntry(entry.id, patch), entry.id);
      }
      onClose();
    } catch (err) {
      setError(saveErrorMessage(err, t));
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

  return (
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
      />
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
          <select
            aria-label={t.plan.moveSlot}
            value={targetSlot}
            onChange={(event) => setTargetSlot(event.target.value)}
          >
            {slots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.name}
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
  );
}

interface EditorTarget {
  date: string;
  slotId: string;
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

  const byCell = new Map(entries.map((entry) => [cellKey(entry.date, entry.slotId), entry]));
  const cookNames = new Map(members.map((member) => [member.userId, member.displayName]));

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
        </div>
      </header>

      {days.map((day) => (
        <div key={day} className="plan-day">
          <h2>{formatDay(day)}</h2>
          <div className="plan-slots">
            {slots.map((slot) => {
              const entry = byCell.get(cellKey(day, slot.id));
              const editing = editor?.date === day && editor.slotId === slot.id;
              return (
                <div key={slot.id} className="plan-cell">
                  <span className="plan-slot-name">{slot.name}</span>
                  {editing ? (
                    <EntryEditor
                      date={day}
                      slotId={slot.id}
                      entry={entry}
                      days={days}
                      slots={slots}
                      members={members}
                      onClose={() => setEditor(undefined)}
                      onSaved={handleSaved}
                      onDeleted={handleDeleted}
                    />
                  ) : entry !== undefined ? (
                    <button
                      type="button"
                      className="plan-entry"
                      onClick={() => setEditor({ date: day, slotId: slot.id })}
                    >
                      <span className="plan-entry-text">
                        {entry.text ?? entry.link ?? ''}
                        {entry.link !== null && entry.text !== null && (
                          <span className="plan-entry-link"> 🔗</span>
                        )}
                      </span>
                      {entry.cookId !== null && (
                        <span className="plan-cook">{cookNames.get(entry.cookId) ?? ''}</span>
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="plan-add"
                      aria-label={`${t.plan.addEntry}: ${formatDay(day)}, ${slot.name}`}
                      onClick={() => setEditor({ date: day, slotId: slot.id })}
                    >
                      +
                    </button>
                  )}
                  {entry?.link != null && !editing && (
                    <a
                      className="plan-open-link"
                      href={entry.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t.plan.openLink}
                    >
                      ↗
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

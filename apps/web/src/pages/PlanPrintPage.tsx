import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { fetchHousehold, fetchPlanEntries, fetchSlots } from '../api/plan';
import type { HouseholdMember, MealSlot, PlanEntry } from '../api/types';
import { useT } from '../i18n';
import { sourceLabel } from '../lib/source';
import { daysFrom, formatDay, formatWeek } from '../lib/week';

type PrintTemplate = 'week' | 'calendar';

interface PrintSettings {
  template: PrintTemplate;
  /** getDay() value the household week starts with (e.g. 5 = Friday). */
  startDay: number;
  /** 8 covers a "Friday to Friday" week including both Fridays. */
  days: number;
}

const SETTINGS_KEY = 'drauf.print-settings';
const DAY_CHOICES = [7, 8, 14];

function loadSettings(): PrintSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<PrintSettings>;
      return {
        template: parsed.template === 'calendar' ? 'calendar' : 'week',
        startDay:
          typeof parsed.startDay === 'number' && parsed.startDay >= 0 && parsed.startDay <= 6
            ? parsed.startDay
            : 1,
        days: DAY_CHOICES.includes(parsed.days as number) ? (parsed.days as number) : 7,
      };
    }
  } catch {
    // Fall through to the defaults.
  }
  return { template: 'week', startDay: 1, days: 7 };
}

const WEEKDAY_FORMAT = new Intl.DateTimeFormat('de-DE', { weekday: 'long' });

function weekdayName(day: number): string {
  // 2026-11-01 was a Sunday (getDay() 0); offsetting from it names any weekday.
  return WEEKDAY_FORMAT.format(new Date(2026, 10, 1 + day));
}

/** "Tomatensuppe (Cookidoo)" — the source prints even though paper can't click. */
function entryLabel(entry: PlanEntry | undefined): string {
  if (entry === undefined) {
    return '';
  }
  if (entry.link === null) {
    return entry.text ?? '';
  }
  const source = sourceLabel(entry.link);
  return entry.text === null ? source : `${entry.text} (${source})`;
}

function chunkWeeks(days: string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < days.length; index += 7) {
    chunks.push(days.slice(index, index + 7));
  }
  return chunks;
}

export function PlanPrintPage() {
  const t = useT();
  const [settings, setSettings] = useState<PrintSettings>(loadSettings);
  const [offset, setOffset] = useState(0);
  const [slots, setSlots] = useState<MealSlot[]>();
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [entries, setEntries] = useState<PlanEntry[]>();
  const [loadFailed, setLoadFailed] = useState(false);

  const days = daysFrom(settings.startDay, offset, settings.days);
  const from = days[0] ?? '';
  const to = days[days.length - 1] ?? '';

  function updateSettings(patch: Partial<PrintSettings>): void {
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

  const byCell = new Map(entries.map((entry) => [`${entry.date}|${entry.slotId}`, entry]));
  const cookNames = new Map(members.map((member) => [member.userId, member.displayName]));

  function cell(day: string, slot: MealSlot) {
    const entry = byCell.get(`${day}|${slot.id}`);
    const cook = entry?.cookId == null ? undefined : cookNames.get(entry.cookId);
    return (
      <>
        <span className="print-entry">{entryLabel(entry)}</span>
        {cook !== undefined && <span className="print-cook">{cook}</span>}
      </>
    );
  }

  return (
    <div className="print-page">
      <style>{`@page { size: A4 ${settings.template === 'calendar' ? 'landscape' : 'portrait'}; margin: 12mm; }`}</style>

      <div className="print-controls">
        <Link to="/plan">{t.plan.print.back}</Link>
        <label>
          {t.plan.print.template}
          <select
            value={settings.template}
            onChange={(event) => updateSettings({ template: event.target.value as PrintTemplate })}
          >
            <option value="week">{t.plan.print.templateWeek}</option>
            <option value="calendar">{t.plan.print.templateCalendar}</option>
          </select>
        </label>
        <label>
          {t.plan.print.startOfWeek}
          <select
            value={settings.startDay}
            onChange={(event) => updateSettings({ startDay: Number(event.target.value) })}
          >
            {[1, 2, 3, 4, 5, 6, 0].map((day) => (
              <option key={day} value={day}>
                {weekdayName(day)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.plan.print.daysCount}
          <select
            value={settings.days}
            onChange={(event) => updateSettings({ days: Number(event.target.value) })}
          >
            {DAY_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        </label>
        <div className="plan-nav">
          <button
            type="button"
            aria-label={t.plan.print.previous}
            onClick={() => setOffset(offset - 1)}
          >
            ‹
          </button>
          <button type="button" onClick={() => setOffset(0)} disabled={offset === 0}>
            {t.plan.print.today}
          </button>
          <button
            type="button"
            aria-label={t.plan.print.next}
            onClick={() => setOffset(offset + 1)}
          >
            ›
          </button>
        </div>
        <button type="button" className="primary" onClick={() => window.print()}>
          {t.plan.print.action}
        </button>
      </div>

      <header className="print-header">
        <h1>{t.plan.print.title}</h1>
        <span className="print-range">{formatWeek(days)}</span>
      </header>

      {settings.template === 'week' ? (
        <div className="print-week">
          {days.map((day) => (
            <section key={day} className="print-day">
              <h2>{formatDay(day)}</h2>
              {slots.map((slot) => (
                <div key={slot.id} className="print-slot">
                  <span className="print-slot-name">{slot.name}</span>
                  {cell(day, slot)}
                </div>
              ))}
            </section>
          ))}
        </div>
      ) : (
        chunkWeeks(days).map((week) => (
          <table key={week[0]} className="print-calendar">
            <thead>
              <tr>
                <th />
                {week.map((day) => (
                  <th key={day}>{formatDay(day)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => (
                <tr key={slot.id}>
                  <th>{slot.name}</th>
                  {week.map((day) => (
                    <td key={day}>{cell(day, slot)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ))
      )}
    </div>
  );
}

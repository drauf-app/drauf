/** Local-date helpers for the weekly plan (weeks start on Monday). */

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** YYYY-MM-DD in local time (toISOString would shift across midnight). */
export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function mondayOf(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay(): Sunday = 0, Monday = 1 … Monday-start weeks shift Sunday back.
  const offset = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - offset);
  return result;
}

/** The 7 ISO dates of the week `offsetWeeks` away from today's week. */
export function weekDays(offsetWeeks: number, today: Date = new Date()): string[] {
  const monday = mondayOf(today);
  monday.setDate(monday.getDate() + offsetWeeks * 7);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    return isoDate(day);
  });
}

const DAY_FORMAT = new Intl.DateTimeFormat('de-DE', { weekday: 'long' });
const DATE_FORMAT = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'numeric' });
const RANGE_FORMAT = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
});

function atNoon(iso: string): Date {
  // Noon avoids DST edge cases when only the calendar date matters.
  return new Date(`${iso}T12:00:00`);
}

/** "Montag, 10.11." */
export function formatDay(iso: string): string {
  const date = atNoon(iso);
  return `${DAY_FORMAT.format(date)}, ${DATE_FORMAT.format(date)}`;
}

/** "10.11. – 16.11.2026" */
export function formatWeek(days: string[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  if (first === undefined || last === undefined) {
    return '';
  }
  return `${DATE_FORMAT.format(atNoon(first))} – ${RANGE_FORMAT.format(atNoon(last))}`;
}

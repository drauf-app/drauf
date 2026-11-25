import { describe, expect, it } from 'vitest';
import { daysFrom, formatLastCooked, isoDate, mondayOf, weekDays } from '../src/lib/week';

describe('week helpers', () => {
  it('finds the Monday of a mid-week date', () => {
    // 2026-11-12 is a Thursday.
    expect(isoDate(mondayOf(new Date(2026, 10, 12)))).toBe('2026-11-09');
  });

  it('keeps a Monday and pulls a Sunday back to its week', () => {
    expect(isoDate(mondayOf(new Date(2026, 10, 9)))).toBe('2026-11-09');
    // 2026-11-15 is a Sunday: Monday-start weeks reach back, not forward.
    expect(isoDate(mondayOf(new Date(2026, 10, 15)))).toBe('2026-11-09');
  });

  it('builds seven consecutive days with a week offset', () => {
    const days = weekDays(1, new Date(2026, 10, 12));
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-11-16');
    expect(days[6]).toBe('2026-11-22');
  });

  it('crosses month boundaries', () => {
    const days = weekDays(3, new Date(2026, 10, 12));
    expect(days[0]).toBe('2026-11-30');
    expect(days[1]).toBe('2026-12-01');
  });
});

describe('daysFrom', () => {
  it('starts at the most recent occurrence of the start day', () => {
    // 2026-11-12 is a Thursday; the household week starts Friday (5).
    const days = daysFrom(5, 0, 8, new Date(2026, 10, 12));
    expect(days[0]).toBe('2026-11-06');
    expect(days).toHaveLength(8);
    // "Friday to Friday": the 8th day is the next Friday.
    expect(days[7]).toBe('2026-11-13');
  });

  it('keeps the start day when today is that day', () => {
    // 2026-11-13 is a Friday.
    expect(daysFrom(5, 0, 7, new Date(2026, 10, 13))[0]).toBe('2026-11-13');
  });

  it('shifts by whole weeks', () => {
    expect(daysFrom(5, 1, 7, new Date(2026, 10, 12))[0]).toBe('2026-11-13');
    expect(daysFrom(5, -1, 7, new Date(2026, 10, 12))[0]).toBe('2026-10-30');
  });

  it('formats short last-cooked labels (#88)', () => {
    const today = new Date(2026, 10, 25); // 2026-11-25
    expect(formatLastCooked('2026-11-25', today)).toBe('heute');
    expect(formatLastCooked('2026-11-24', today)).toBe('gestern');
    expect(formatLastCooked('2026-11-20', today)).toBe('vor 5 Tagen');
    expect(formatLastCooked('2026-11-04', today)).toBe('vor 3 Wochen');
    expect(formatLastCooked('2026-02-01', today)).toBe('am 1.2.2026');
  });
});

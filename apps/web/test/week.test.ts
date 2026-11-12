import { describe, expect, it } from 'vitest';
import { isoDate, mondayOf, weekDays } from '../src/lib/week';

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

import { describe, expect, it } from 'vitest';
import { dropTargetIndex, moveItem } from '../src/lib/reorder';

describe('moveItem', () => {
  it('moves items in both directions', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});

describe('dropTargetIndex', () => {
  // Four rows with midpoints at 10, 30, 50, 70.
  const midpoints = [10, 30, 50, 70];

  it('drops above everything at index 0 and below everything at the end', () => {
    expect(dropTargetIndex(midpoints, 3, 5)).toBe(0);
    expect(dropTargetIndex(midpoints, 0, 95)).toBe(3);
  });

  it('counts only the other rows above the pointer', () => {
    // Dragging the first row just past the second row's midpoint.
    expect(dropTargetIndex(midpoints, 0, 35)).toBe(1);
    // Dragging the last row between the first and second midpoints.
    expect(dropTargetIndex(midpoints, 3, 20)).toBe(1);
  });
});

/** Returns a copy with the item moved from one index to another. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) {
    return items;
  }
  next.splice(to, 0, moved);
  return next;
}

/**
 * Where a dragged row would land: the number of other rows whose midpoint
 * (captured at drag start) lies above the pointer.
 */
export function dropTargetIndex(midpoints: number[], from: number, pointerY: number): number {
  let target = 0;
  for (const [index, midpoint] of midpoints.entries()) {
    if (index !== from && midpoint < pointerY) {
      target += 1;
    }
  }
  return Math.min(target, Math.max(0, midpoints.length - 1));
}

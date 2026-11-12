import { parseSize } from '@drauf/shared';
import type { PatchEntryInput } from '../api/lists';
import type { Suggestion } from '../api/types';

export interface Chip {
  label: string;
  patch: PatchEntryInput;
  /** Preselected from the household's last choice (K4). */
  highlighted: boolean;
}

export interface ChipGroups {
  counts: Chip[];
  sizes: Chip[];
  varieties: Chip[];
}

const COUNTS = [1, 2, 3, 4];

/**
 * Chip bar contents for a just-added entry: count 1-4, the suggestion's
 * sizes ("500 g" → quantity+unit) and varieties. The last chosen values
 * are highlighted.
 */
export function buildChipGroups(suggestion: Suggestion | undefined): ChipGroups {
  const lastQuantity = suggestion?.lastQuantity ?? null;
  const lastUnit = suggestion?.lastUnit ?? null;
  const lastVariant = suggestion?.lastVariant ?? null;

  const counts: Chip[] = COUNTS.map((count) => ({
    label: String(count),
    patch: { quantity: count },
    highlighted: lastUnit === null && lastQuantity === count,
  }));

  const sizes: Chip[] = [];
  for (const size of suggestion?.sizes ?? []) {
    const parsed = parseSize(size);
    if (parsed === undefined) {
      continue;
    }
    sizes.push({
      label: size,
      patch: { quantity: parsed.quantity, unit: parsed.unit },
      highlighted: parsed.quantity === lastQuantity && parsed.unit === lastUnit,
    });
  }

  // The household's own recent variants come first, catalogue varieties after.
  const varietyLabels: string[] = [];
  for (const label of [...(suggestion?.recentVariants ?? []), ...(suggestion?.varieties ?? [])]) {
    if (!varietyLabels.includes(label)) {
      varietyLabels.push(label);
    }
  }
  const varieties: Chip[] = varietyLabels.map((variety) => ({
    label: variety,
    patch: { variant: variety },
    highlighted: variety === lastVariant,
  }));

  return { counts, sizes, varieties };
}

/** Whether a chip's value is what the entry currently has. */
export function isChipActive(
  entry: { variant: string | null; quantities: Array<{ unit: string | null; quantity: number }> },
  chip: Chip,
): boolean {
  if (chip.patch.variant !== undefined) {
    return entry.variant === chip.patch.variant;
  }
  if (chip.patch.quantity !== undefined) {
    const only = entry.quantities.length === 1 ? entry.quantities[0] : undefined;
    return (
      only !== undefined &&
      only.quantity === chip.patch.quantity &&
      (only.unit ?? '') === (chip.patch.unit ?? '')
    );
  }
  return false;
}

/** The patch that takes an active chip's value off the entry again. */
export function clearingPatch(chip: Chip): PatchEntryInput {
  // unit '' clears all portions; variant '' clears the variant.
  return chip.patch.variant !== undefined ? { variant: '' } : { unit: '' };
}

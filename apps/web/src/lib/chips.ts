import { joinVariants, parseSize, splitVariants } from '@drauf/shared';
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
 * Chip bar contents for a just-added entry: pack count 1-4, the suggestion's
 * sizes ("500 g" → quantity+unit) and varieties. Count and size compose
 * ("2 × 500 g"). The last chosen values are highlighted.
 */
export function buildChipGroups(suggestion: Suggestion | undefined): ChipGroups {
  const lastQuantity = suggestion?.lastQuantity ?? null;
  const lastUnit = suggestion?.lastUnit ?? null;
  const lastCount = suggestion?.lastCount ?? null;
  const lastVariant = suggestion?.lastVariant ?? null;

  const counts: Chip[] = COUNTS.map((count) => ({
    label: String(count),
    patch: { count },
    // Entries from before pack counts stored plain unitless quantities.
    highlighted:
      lastCount === count || (lastCount === null && lastUnit === null && lastQuantity === count),
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

  // The household's own recent variants come first, catalogue varieties
  // after — deduplicated case-insensitively so "Festkochend" (learned) and
  // "festkochend" (catalogue) do not both show.
  const varietyLabels: string[] = [];
  const seenLabels = new Set<string>();
  for (const label of [...(suggestion?.recentVariants ?? []), ...(suggestion?.varieties ?? [])]) {
    const key = label.toLowerCase();
    if (!seenLabels.has(key)) {
      seenLabels.add(key);
      varietyLabels.push(label);
    }
  }
  const lastModifiers = splitVariants(lastVariant);
  const varieties: Chip[] = varietyLabels.map((variety) => ({
    label: variety,
    patch: { variant: variety },
    highlighted: lastModifiers.includes(variety),
  }));

  return { counts, sizes, varieties };
}

interface AmountEntry {
  variant: string | null;
  quantities: Array<{ unit: string | null; quantity: number; count?: number }>;
}

function onlyGroup(entry: AmountEntry) {
  return entry.quantities.length === 1 ? entry.quantities[0] : undefined;
}

/** Whether a chip's value is what the entry currently has. */
export function isChipActive(entry: AmountEntry, chip: Chip): boolean {
  if (chip.patch.variant !== undefined) {
    // Variants are multi-select: active when the modifier is in the list.
    return splitVariants(entry.variant).includes(chip.patch.variant);
  }
  const only = onlyGroup(entry);
  if (only === undefined) {
    return false;
  }
  if (chip.patch.count !== undefined) {
    // Legacy plain amounts ("4" as an unitless quantity) count as counts.
    return (
      only.count === chip.patch.count ||
      (only.count === undefined && only.unit === null && only.quantity === chip.patch.count)
    );
  }
  if (chip.patch.quantity !== undefined) {
    return only.quantity === chip.patch.quantity && (only.unit ?? '') === (chip.patch.unit ?? '');
  }
  return false;
}

/**
 * Amount chips (count, size) replace the entry's portions and compose with
 * each other: toggling a count keeps the size and vice versa ("2 × 500 g").
 */
export function amountReplacePatch(
  entry: AmountEntry,
  chip: Chip,
  active: boolean,
): PatchEntryInput {
  const only = onlyGroup(entry);
  const size =
    only !== undefined && only.unit !== null
      ? { quantity: only.quantity, unit: only.unit }
      : undefined;
  // A bare pack count is stored as a plain unitless quantity ("3"), so a
  // plain integer group reads as the current count when composing.
  const count =
    only?.count ??
    (only !== undefined &&
    only.unit === null &&
    Number.isInteger(only.quantity) &&
    only.quantity >= 1 &&
    only.quantity <= 99
      ? only.quantity
      : undefined);
  if (chip.patch.count !== undefined) {
    if (active) {
      return size ?? { unit: '' }; // drop the count, keep the size (or clear all)
    }
    return { count: chip.patch.count, ...(size ?? {}) };
  }
  if (active) {
    return count === undefined ? { unit: '' } : { count }; // drop the size, keep the count
  }
  return {
    quantity: chip.patch.quantity as number,
    unit: chip.patch.unit as string,
    ...(count === undefined ? {} : { count }),
  };
}

/** Toggles one modifier in the entry's comma-separated variant list. */
export function variantTogglePatch(
  entry: { variant: string | null },
  modifier: string,
): PatchEntryInput {
  const current = splitVariants(entry.variant);
  const next = current.includes(modifier)
    ? current.filter((value) => value !== modifier)
    : [...current, modifier];
  return { variant: joinVariants(next) };
}

/** Toggles one fixed shopping flag on the entry. */
export function flagsTogglePatch(entry: { flags: string | null }, flag: string): PatchEntryInput {
  const current = splitVariants(entry.flags);
  const next = current.includes(flag)
    ? current.filter((value) => value !== flag)
    : [...current, flag];
  return { flags: joinVariants(next) };
}

/** Merges typed modifiers (possibly a comma list) into the entry's variants. */
export function addVariantsPatch(entry: { variant: string | null }, text: string): PatchEntryInput {
  const next = splitVariants(entry.variant);
  for (const modifier of splitVariants(text)) {
    if (!next.includes(modifier)) {
      next.push(modifier);
    }
  }
  return { variant: joinVariants(next) };
}

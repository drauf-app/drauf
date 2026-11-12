import { joinVariants, parseSize, splitVariants } from '@drauf/shared';
import type { PatchEntryInput } from '../api/lists';
import type { Chip } from './chips';

/**
 * The "Eigene Details bearbeiten" text field holds the entry's details as one
 * comma list — pack count, size and modifiers ("3, 3-lagig, sehr weich") —
 * parsed live in both directions. Flags are not part of it.
 */
export interface DetailsDraft {
  count?: number | undefined;
  quantity?: number | undefined;
  unit?: string | undefined;
  modifiers: string[];
}

const AMOUNT_FORMAT = new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 2,
  useGrouping: false,
});

/**
 * Splits the field on commas — except a comma directly followed by a digit,
 * which is a German decimal ("1,5 kg"). The serializer always writes ", ".
 */
function splitDetails(text: string): string[] {
  return text
    .split(/,(?=\s|$)|,(?!\d)/)
    .map((token) => token.trim())
    .filter((token) => token !== '');
}

export function parseDetails(text: string): DetailsDraft {
  const draft: DetailsDraft = { modifiers: [] };
  for (const token of splitDetails(text)) {
    if (draft.count === undefined && /^\d{1,2}$/.test(token)) {
      const value = Number(token);
      if (value >= 1 && value <= 99) {
        draft.count = value;
        continue;
      }
    }
    if (draft.quantity === undefined) {
      const size = parseSize(token);
      if (size !== undefined) {
        draft.quantity = size.quantity;
        draft.unit = size.unit;
        continue;
      }
      // A lone decimal ("1,5") is an unitless amount, not a modifier.
      if (/^\d+[.,]\d+$/.test(token)) {
        draft.quantity = Number(token.replace(',', '.'));
        continue;
      }
    }
    draft.modifiers.push(token);
  }
  return draft;
}

export function serializeDraft(draft: DetailsDraft): string {
  const tokens: string[] = [];
  if (draft.count !== undefined) {
    tokens.push(String(draft.count));
  }
  if (draft.quantity !== undefined) {
    const amount = AMOUNT_FORMAT.format(draft.quantity);
    tokens.push(draft.unit === undefined ? amount : `${amount} ${draft.unit}`);
  }
  tokens.push(...draft.modifiers);
  return joinVariants(tokens);
}

interface DraftEntry {
  variant: string | null;
  quantities: Array<{ unit: string | null; quantity: number; count?: number }>;
}

export function draftFromEntry(entry: DraftEntry): DetailsDraft {
  const draft: DetailsDraft = { modifiers: splitVariants(entry.variant) };
  const only = entry.quantities.length === 1 ? entry.quantities[0] : undefined;
  if (only === undefined) {
    return draft;
  }
  if (only.count !== undefined) {
    draft.count = only.count;
    draft.quantity = only.quantity;
    draft.unit = only.unit ?? undefined;
    return draft;
  }
  if (only.unit !== null) {
    draft.quantity = only.quantity;
    draft.unit = only.unit;
  } else if (Number.isInteger(only.quantity) && only.quantity >= 1 && only.quantity <= 99) {
    draft.count = only.quantity; // a plain "4" reads as a pack count
  } else {
    draft.quantity = only.quantity;
  }
  return draft;
}

function sameAmount(a: DetailsDraft, b: DetailsDraft): boolean {
  return a.count === b.count && a.quantity === b.quantity && a.unit === b.unit;
}

/** The PATCH that brings the entry to the draft's state; {} when nothing changed. */
export function draftPatch(entry: DraftEntry, draft: DetailsDraft): PatchEntryInput {
  const current = draftFromEntry(entry);
  const patch: PatchEntryInput = {};
  if (!sameAmount(current, draft)) {
    if (draft.quantity !== undefined) {
      patch.quantity = draft.quantity;
      patch.unit = draft.unit ?? '';
      if (draft.count !== undefined) {
        patch.count = draft.count;
      }
    } else if (draft.count !== undefined) {
      patch.count = draft.count;
    } else if (entry.quantities.length > 0) {
      patch.unit = ''; // clears all portions
    }
  }
  const modifiers = joinVariants(draft.modifiers);
  if (modifiers !== joinVariants(splitVariants(entry.variant))) {
    patch.variant = modifiers;
  }
  return patch;
}

/** Whether a chip's value is selected in the draft (while the field is open). */
export function isDraftActive(draft: DetailsDraft, chip: Chip): boolean {
  if (chip.patch.variant !== undefined) {
    return draft.modifiers.includes(chip.patch.variant);
  }
  if (chip.patch.count !== undefined) {
    return draft.count === chip.patch.count;
  }
  if (chip.patch.quantity !== undefined) {
    return draft.quantity === chip.patch.quantity && draft.unit === chip.patch.unit;
  }
  return false;
}

/** Applies a chip tap to the draft (toggle semantics, count and size compose). */
export function toggleDraft(draft: DetailsDraft, chip: Chip): DetailsDraft {
  if (chip.patch.variant !== undefined) {
    const modifier = chip.patch.variant;
    return {
      ...draft,
      modifiers: draft.modifiers.includes(modifier)
        ? draft.modifiers.filter((value) => value !== modifier)
        : [...draft.modifiers, modifier],
    };
  }
  if (chip.patch.count !== undefined) {
    return {
      ...draft,
      count: draft.count === chip.patch.count ? undefined : chip.patch.count,
    };
  }
  if (chip.patch.quantity !== undefined) {
    const active = draft.quantity === chip.patch.quantity && draft.unit === chip.patch.unit;
    return {
      ...draft,
      quantity: active ? undefined : chip.patch.quantity,
      unit: active ? undefined : chip.patch.unit,
    };
  }
  return draft;
}

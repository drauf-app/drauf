import { describe, expect, it } from 'vitest';
import type { Category, EntryView, Suggestion } from '../src/api/types';
import {
  addVariantsPatch,
  amountReplacePatch,
  buildChipGroups,
  isChipActive,
  variantTogglePatch,
} from '../src/lib/chips';
import { formatQuantities, groupEntries, recentEntries } from '../src/lib/entries';

function category(id: string, name: string, sortOrder: number): Category {
  return {
    id,
    householdId: 'h1',
    key: null,
    name,
    sortOrder,
    createdAt: '2026-11-12T00:00:00.000Z',
  };
}

function entry(id: string, overrides: Partial<EntryView> = {}): EntryView {
  return {
    id,
    listId: 'l1',
    name: id,
    nameNormalized: id,
    variant: null,
    flags: null,
    note: null,
    categoryId: null,
    fieldTimes: null,
    checkedAt: null,
    checkedById: null,
    createdAt: '2026-11-12T00:00:00.000Z',
    quantities: [],
    portions: [],
    icon: null,
    ...overrides,
  };
}

describe('groupEntries', () => {
  it('orders groups by category sort order with uncategorized last', () => {
    const categories = [category('c2', 'Getränke', 9), category('c1', 'Obst & Gemüse', 0)];
    const groups = groupEntries(
      [
        entry('wasser', { categoryId: 'c2' }),
        entry('ohne'),
        entry('apfel', { categoryId: 'c1' }),
        entry('erledigt', { categoryId: 'c1', checkedAt: '2026-11-12T10:00:00.000Z' }),
      ],
      categories,
    );

    expect(groups.map((group) => group.category?.name ?? null)).toEqual([
      'Obst & Gemüse',
      'Getränke',
      null,
    ]);
    // Checked entries never show up in the open groups.
    expect(groups.flatMap((group) => group.entries.map((item) => item.id))).toEqual([
      'apfel',
      'wasser',
      'ohne',
    ]);
  });

  it('re-sorts groups by the selected store order, rest after', () => {
    const categories = [
      category('c1', 'Obst & Gemüse', 0),
      category('c2', 'Getränke', 9),
      category('c3', 'Haushalt', 11),
    ];
    const entries = [
      entry('apfel', { categoryId: 'c1' }),
      entry('wasser', { categoryId: 'c2' }),
      entry('lappen', { categoryId: 'c3' }),
    ];
    // The store sorts drinks first; household categories not in the store
    // order (c3) follow in household order.
    const groups = groupEntries(entries, categories, ['c2', 'c1']);
    expect(groups.map((group) => group.category?.id)).toEqual(['c2', 'c1', 'c3']);
  });
});

describe('recentEntries', () => {
  it('returns checked entries, most recently checked first', () => {
    const result = recentEntries([
      entry('a', { checkedAt: '2026-11-12T08:00:00.000Z' }),
      entry('open'),
      entry('b', { checkedAt: '2026-11-12T09:00:00.000Z' }),
    ]);
    expect(result.map((item) => item.id)).toEqual(['b', 'a']);
  });
});

describe('formatQuantities', () => {
  it('shows units side by side and counts without a unit', () => {
    expect(
      formatQuantities([
        { unit: null, quantity: 1 },
        { unit: 'g', quantity: 50 },
      ]),
    ).toBe('1 + 50 g');
  });

  it('formats decimals in German notation', () => {
    expect(formatQuantities([{ unit: 'kg', quantity: 1.5 }])).toBe('1,5 kg');
  });

  it('keeps both numbers for pack counts', () => {
    expect(formatQuantities([{ unit: 'g', quantity: 500, count: 2 }])).toBe('2 × 500 g');
  });
});

describe('buildChipGroups', () => {
  const suggestion: Suggestion = {
    name: 'Nudeln',
    source: 'history',
    icon: '🍝',
    categoryId: 'c1',
    sizes: ['500 g', '1 kg', 'kaputt'],
    varieties: ['Spaghetti', 'Penne'],
    lastQuantity: 500,
    lastUnit: 'g',
    lastVariant: 'Penne',
  };

  it('parses sizes into quantity patches and skips unparseable ones', () => {
    const groups = buildChipGroups(suggestion);
    expect(groups.sizes.map((chip) => chip.label)).toEqual(['500 g', '1 kg']);
    expect(groups.sizes[0]?.patch).toEqual({ quantity: 500, unit: 'g' });
    expect(groups.counts.map((chip) => chip.label)).toEqual(['1', '2', '3', '4']);
    expect(groups.counts[0]?.patch).toEqual({ count: 1 });
  });

  it('highlights the last chosen size and variety', () => {
    const groups = buildChipGroups(suggestion);
    expect(groups.sizes.find((chip) => chip.highlighted)?.label).toBe('500 g');
    expect(groups.varieties.find((chip) => chip.highlighted)?.label).toBe('Penne');
    expect(groups.counts.some((chip) => chip.highlighted)).toBe(false);
  });

  it('highlights a unitless last quantity as a count', () => {
    const groups = buildChipGroups({ ...suggestion, lastQuantity: 2, lastUnit: null });
    expect(groups.counts.find((chip) => chip.highlighted)?.label).toBe('2');
  });

  it('puts the household\u2019s recent variants before catalogue varieties, deduped', () => {
    const groups = buildChipGroups({
      ...suggestion,
      recentVariants: ['Paprika', 'Penne'],
    });
    expect(groups.varieties.map((chip) => chip.label)).toEqual(['Paprika', 'Penne', 'Spaghetti']);
  });

  it('dedupes varieties case-insensitively, learned casing first', () => {
    const groups = buildChipGroups({
      ...suggestion,
      varieties: ['festkochend', 'mehlig'],
      recentVariants: ['Festkochend'],
    });
    expect(groups.varieties.map((chip) => chip.label)).toEqual(['Festkochend', 'mehlig']);
  });

  it('offers only counts for free-text adds', () => {
    const groups = buildChipGroups(undefined);
    expect(groups.counts).toHaveLength(4);
    expect(groups.sizes).toEqual([]);
    expect(groups.varieties).toEqual([]);
  });
});

describe('isChipActive and clearingPatch', () => {
  const sizeChip = { label: '500 g', patch: { quantity: 500, unit: 'g' }, highlighted: false };
  const countChip = { label: '2', patch: { quantity: 2 }, highlighted: false };
  const varietyChip = { label: 'Penne', patch: { variant: 'Penne' }, highlighted: false };

  it('matches the entry state per chip kind', () => {
    const withSize = entry('nudeln', { quantities: [{ unit: 'g', quantity: 500 }] });
    expect(isChipActive(withSize, sizeChip)).toBe(true);
    expect(isChipActive(withSize, countChip)).toBe(false);
    const withCount = entry('eier', { quantities: [{ unit: null, quantity: 2 }] });
    expect(isChipActive(withCount, countChip)).toBe(true);
    const withVariant = entry('nudeln', { variant: 'Penne' });
    expect(isChipActive(withVariant, varietyChip)).toBe(true);
    expect(isChipActive(entry('leer'), sizeChip)).toBe(false);
  });

  it('recognises counts, including legacy unitless amounts', () => {
    const packed = entry('hack', { quantities: [{ unit: 'g', quantity: 500, count: 2 }] });
    expect(isChipActive(packed, { label: '2', patch: { count: 2 }, highlighted: false })).toBe(
      true,
    );
    const legacy = entry('eier', { quantities: [{ unit: null, quantity: 4 }] });
    expect(isChipActive(legacy, { label: '4', patch: { count: 4 }, highlighted: false })).toBe(
      true,
    );
  });

  it('treats comma-separated variants as multi-select', () => {
    const potato = entry('kartoffeln', { variant: 'Bio, Festkochend, Annabelle' });
    expect(
      isChipActive(potato, { label: 'Bio', patch: { variant: 'Bio' }, highlighted: false }),
    ).toBe(true);
    expect(
      isChipActive(potato, { label: 'Mehlig', patch: { variant: 'Mehlig' }, highlighted: false }),
    ).toBe(false);
  });
});

describe('amountReplacePatch', () => {
  const count2 = { label: '2', patch: { count: 2 }, highlighted: false };
  const size500 = { label: '500 g', patch: { quantity: 500, unit: 'g' }, highlighted: false };

  it('composes count and size in both directions', () => {
    const sized = entry('hack', { quantities: [{ unit: 'g', quantity: 500 }] });
    expect(amountReplacePatch(sized, count2, false)).toEqual({
      count: 2,
      quantity: 500,
      unit: 'g',
    });

    const counted = entry('hack', { quantities: [{ unit: null, quantity: 2, count: 2 }] });
    expect(amountReplacePatch(counted, size500, false)).toEqual({
      quantity: 500,
      unit: 'g',
      count: 2,
    });
  });

  it('reads a bare unitless amount as the current count when composing', () => {
    const counted = entry('hack', { quantities: [{ unit: null, quantity: 3 }] });
    expect(amountReplacePatch(counted, size500, false)).toEqual({
      quantity: 500,
      unit: 'g',
      count: 3,
    });
  });

  it('toggling off keeps the other dimension', () => {
    const packed = entry('hack', { quantities: [{ unit: 'g', quantity: 500, count: 2 }] });
    expect(amountReplacePatch(packed, count2, true)).toEqual({ quantity: 500, unit: 'g' });
    expect(amountReplacePatch(packed, size500, true)).toEqual({ count: 2 });
  });

  it('falls back to clearing everything when nothing else is set', () => {
    const bare = entry('hack', { quantities: [{ unit: null, quantity: 2 }] });
    expect(amountReplacePatch(bare, count2, true)).toEqual({ unit: '' });
    expect(amountReplacePatch(entry('leer'), count2, false)).toEqual({ count: 2 });
  });
});

describe('variant toggling', () => {
  it('adds and removes single modifiers, keeping the rest', () => {
    const potato = entry('kartoffeln', { variant: 'Bio, Festkochend' });
    expect(variantTogglePatch(potato, 'Annabelle')).toEqual({
      variant: 'Bio, Festkochend, Annabelle',
    });
    expect(variantTogglePatch(potato, 'Bio')).toEqual({ variant: 'Festkochend' });
    expect(variantTogglePatch(entry('leer'), 'Bio')).toEqual({ variant: 'Bio' });
  });

  it('merges typed comma lists without duplicates', () => {
    const potato = entry('kartoffeln', { variant: 'Bio' });
    expect(addVariantsPatch(potato, 'Festkochend, Annabelle, Bio')).toEqual({
      variant: 'Bio, Festkochend, Annabelle',
    });
  });

  it('highlights every modifier of the last-used variant', () => {
    const groups = buildChipGroups({
      name: 'Kartoffeln',
      source: 'history',
      icon: null,
      categoryId: null,
      sizes: [],
      varieties: ['Mehlig'],
      recentVariants: ['Bio', 'Festkochend'],
      lastVariant: 'Bio, Festkochend',
    });
    expect(groups.varieties.filter((chip) => chip.highlighted).map((chip) => chip.label)).toEqual([
      'Bio',
      'Festkochend',
    ]);
  });
});

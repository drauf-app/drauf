import { describe, expect, it } from 'vitest';
import {
  draftFromEntry,
  draftPatch,
  isDraftActive,
  parseDetails,
  serializeDraft,
  toggleDraft,
} from '../src/lib/details';

function entry(overrides: {
  variant?: string | null;
  quantities?: Array<{ unit: string | null; quantity: number; count?: number }>;
}) {
  return { variant: overrides.variant ?? null, quantities: overrides.quantities ?? [] };
}

describe('parseDetails', () => {
  it('classifies count, size and modifiers from a comma list', () => {
    expect(parseDetails('3, 3-lagig, sehr weich')).toEqual({
      count: 3,
      modifiers: ['3-lagig', 'sehr weich'],
    });
    expect(parseDetails('2, 500 g, Bio')).toEqual({
      count: 2,
      quantity: 500,
      unit: 'g',
      modifiers: ['Bio'],
    });
  });

  it('reads German decimal sizes and lone decimals', () => {
    expect(parseDetails('1,5 kg')).toEqual({ quantity: 1.5, unit: 'kg', modifiers: [] });
    expect(parseDetails('1,5, Bio').modifiers).toEqual(['Bio']);
  });

  it('keeps number-like words as modifiers once count and size are taken', () => {
    expect(parseDetails('3, 4, 3-lagig')).toEqual({ count: 3, modifiers: ['4', '3-lagig'] });
  });
});

describe('serializeDraft and draftFromEntry', () => {
  it('round-trips the field text', () => {
    const text = '3, 500 g, 3-lagig, sehr weich';
    expect(serializeDraft(parseDetails(text))).toBe(text);
  });

  it('serializes an entry with a pack count', () => {
    const draft = draftFromEntry(
      entry({ variant: '3-lagig', quantities: [{ unit: 'g', quantity: 500, count: 2 }] }),
    );
    expect(serializeDraft(draft)).toBe('2, 500 g, 3-lagig');
  });

  it('reads a plain unitless amount as a count', () => {
    expect(draftFromEntry(entry({ quantities: [{ unit: null, quantity: 4 }] })).count).toBe(4);
  });
});

describe('draftPatch', () => {
  const packed = entry({ variant: 'Bio', quantities: [{ unit: 'g', quantity: 500, count: 2 }] });

  it('is empty when nothing changed', () => {
    expect(draftPatch(packed, draftFromEntry(packed))).toEqual({});
  });

  it('patches amount and modifiers from the edited text', () => {
    expect(draftPatch(packed, parseDetails('3, 500 g, Bio, Hakle'))).toEqual({
      quantity: 500,
      unit: 'g',
      count: 3,
      variant: 'Bio, Hakle',
    });
  });

  it('clears the amount when the text loses it', () => {
    expect(draftPatch(packed, parseDetails('Bio'))).toEqual({ unit: '' });
  });
});

describe('toggleDraft and isDraftActive', () => {
  const countChip = { label: '3', patch: { count: 3 }, highlighted: false };
  const sizeChip = { label: '500 g', patch: { quantity: 500, unit: 'g' }, highlighted: false };
  const modChip = { label: 'Bio', patch: { variant: 'Bio' }, highlighted: false };

  it('toggles chips against the draft, composing count and size', () => {
    let draft = parseDetails('');
    draft = toggleDraft(draft, countChip);
    draft = toggleDraft(draft, sizeChip);
    draft = toggleDraft(draft, modChip);
    expect(serializeDraft(draft)).toBe('3, 500 g, Bio');
    expect(isDraftActive(draft, countChip)).toBe(true);

    draft = toggleDraft(draft, countChip);
    expect(serializeDraft(draft)).toBe('500 g, Bio');
    expect(isDraftActive(draft, countChip)).toBe(false);
  });
});

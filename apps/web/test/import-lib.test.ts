import { describe, expect, it } from 'vitest';
import type { PreviewIngredient } from '../src/api/import';
import { ingredientLabel, scaleQuantity, servingsFactor, toApplyItem } from '../src/lib/import';

function ingredient(overrides: Partial<PreviewIngredient>): PreviewIngredient {
  return {
    raw: '500 g Mehl',
    name: 'Mehl',
    quantity: 500,
    unit: 'g',
    isStaple: false,
    ...overrides,
  };
}

describe('servingsFactor', () => {
  it('scales relative to the recipe servings', () => {
    expect(servingsFactor(4, 6)).toBe(1.5);
  });

  it('falls back to 1 when the recipe gives no servings', () => {
    expect(servingsFactor(null, 6)).toBe(1);
    expect(servingsFactor(0, 6)).toBe(1);
  });
});

describe('toApplyItem', () => {
  it('scales the quantity and keeps the unit', () => {
    expect(toApplyItem(ingredient({}), 1.5)).toEqual({ name: 'Mehl', quantity: 750, unit: 'g' });
  });

  it('rounds scaled quantities to two decimals', () => {
    expect(scaleQuantity(1, 1 / 3)).toBe(0.33);
  });

  it('uses the raw line when parsing found no name', () => {
    const item = toApplyItem(ingredient({ name: '', quantity: undefined, unit: undefined }), 2);
    expect(item).toEqual({ name: '500 g Mehl' });
  });
});

describe('ingredientLabel', () => {
  it('formats the scaled amount in German notation', () => {
    expect(ingredientLabel(ingredient({ quantity: 0.5, unit: 'l', name: 'Milch' }), 1.5)).toBe(
      '0,75 l Milch',
    );
  });

  it('omits the unit when there is none', () => {
    expect(ingredientLabel(ingredient({ quantity: 2, unit: undefined, name: 'Eier' }), 2)).toBe(
      '4 Eier',
    );
  });

  it('falls back to the raw line', () => {
    expect(ingredientLabel(ingredient({ name: '' }), 1)).toBe('500 g Mehl');
  });
});

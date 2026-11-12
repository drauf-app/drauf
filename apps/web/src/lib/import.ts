import type { ApplyItem, PreviewIngredient } from '../api/import';

export function scaleQuantity(quantity: number, factor: number): number {
  return Math.round(quantity * factor * 100) / 100;
}

/** The factor the chosen servings apply to every parsed quantity. */
export function servingsFactor(original: number | null, chosen: number): number {
  if (original === null || original <= 0 || chosen <= 0) {
    return 1;
  }
  return chosen / original;
}

/** Turns one selected preview ingredient into an apply-request item. */
export function toApplyItem(ingredient: PreviewIngredient, factor: number): ApplyItem {
  const name = ingredient.name.trim() === '' ? ingredient.raw : ingredient.name;
  return {
    name,
    ...(ingredient.quantity === undefined
      ? {}
      : { quantity: scaleQuantity(ingredient.quantity, factor) }),
    ...(ingredient.unit === undefined ? {} : { unit: ingredient.unit }),
  };
}

const AMOUNT_FORMAT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

/** Display label with the scaled quantity ("250 g Mehl"); raw line as fallback. */
export function ingredientLabel(ingredient: PreviewIngredient, factor: number): string {
  if (ingredient.name.trim() === '') {
    return ingredient.raw;
  }
  if (ingredient.quantity === undefined) {
    return ingredient.name;
  }
  const amount = AMOUNT_FORMAT.format(scaleQuantity(ingredient.quantity, factor));
  return ingredient.unit === undefined
    ? `${amount} ${ingredient.name}`
    : `${amount} ${ingredient.unit} ${ingredient.name}`;
}

import { decodeHtmlEntities, findJsonLd, readMetaContent, readStringish } from './jsonld.js';
import type { RecipePreview } from './types.js';

export function parseServings(value: unknown): number | null {
  const text = readStringish(value) ?? (typeof value === 'number' ? String(value) : null);
  if (text === null) {
    return null;
  }
  const match = /\d+/.exec(text);
  if (match === null) {
    return null;
  }
  const servings = Number.parseInt(match[0], 10);
  return servings > 0 && servings <= 1000 ? servings : null;
}

export function readIngredients(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((line): line is string => typeof line === 'string')
    .map((line) => decodeHtmlEntities(line.trim()))
    .filter((line) => line !== '');
}

/**
 * The shared core of every provider: a schema.org Recipe from JSON-LD with
 * per-field og: fallbacks. Each field fails open on its own — one missing
 * field must not abort an import.
 */
export function parseRecipeHtml(html: string): RecipePreview {
  const recipe = findJsonLd(html, 'Recipe') ?? {};
  return {
    title: readStringish(recipe.name) ?? readMetaContent(html, 'og:title'),
    imageUrl: readStringish(recipe.image) ?? readMetaContent(html, 'og:image'),
    servings: parseServings(recipe.recipeYield),
    ingredients: readIngredients(recipe.recipeIngredient),
  };
}

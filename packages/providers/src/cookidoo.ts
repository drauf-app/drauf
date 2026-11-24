import { decodeHtmlEntities, findJsonLd, readMetaContent, readStringish } from './jsonld.js';
import type { RecipePreview, RecipeProvider } from './types.js';
import { extractFirstUrl } from './url.js';

const HOSTNAME_PATTERN = /(^|\.)cookidoo\.[a-z.]{2,10}$/i;

function parseServings(value: unknown): number | null {
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

function readIngredients(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((line): line is string => typeof line === 'string')
    .map((line) => decodeHtmlEntities(line.trim()))
    .filter((line) => line !== '');
}

/**
 * Parses the public Cookidoo recipe page (no login; preparation steps are
 * login-gated and deliberately never read). Primary source is the schema.org
 * Recipe JSON-LD; every field falls back independently — a missing field must
 * not abort the import.
 */
export function parseCookidooHtml(html: string): RecipePreview {
  const recipe = findJsonLd(html, 'Recipe') ?? {};
  return {
    title: readStringish(recipe.name) ?? readMetaContent(html, 'og:title'),
    imageUrl: readStringish(recipe.image) ?? readMetaContent(html, 'og:image'),
    servings: parseServings(recipe.recipeYield),
    ingredients: readIngredients(recipe.recipeIngredient),
  };
}

export const cookidooProvider: RecipeProvider = {
  id: 'cookidoo',
  matches(input) {
    const url = extractFirstUrl(input);
    if (url === null) {
      return null;
    }
    try {
      return HOSTNAME_PATTERN.test(new URL(url).hostname) ? url : null;
    } catch {
      return null;
    }
  },
  async fetch(url, ctx) {
    return parseCookidooHtml(await ctx.fetchText(url));
  },
};

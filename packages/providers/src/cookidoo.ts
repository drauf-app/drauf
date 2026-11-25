import { parseRecipeHtml } from './recipe.js';
import type { RecipePreview, RecipeProvider } from './types.js';
import { extractFirstUrl } from './url.js';

const HOSTNAME_PATTERN = /(^|\.)cookidoo\.[a-z.]{2,10}$/i;

/**
 * Parses the public Cookidoo recipe page (no login; preparation steps are
 * login-gated and deliberately never read). The shared schema.org parse
 * covers it fully today; the dedicated provider keeps the hostname match
 * and the hook for site-specific fixes.
 */
export function parseCookidooHtml(html: string): RecipePreview {
  return parseRecipeHtml(html);
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

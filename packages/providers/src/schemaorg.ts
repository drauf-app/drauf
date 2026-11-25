import { parseRecipeHtml } from './recipe.js';
import type { RecipeProvider } from './types.js';
import { extractFirstUrl } from './url.js';

/**
 * Generic schema.org Recipe provider (#72): matches any http(s) URL, so it
 * must stay the LAST entry in allProviders — site-specific providers match
 * first by hostname, this one is the net underneath. Covers most recipe
 * sites and food blogs, which embed a schema.org Recipe as JSON-LD.
 */
export const schemaOrgProvider: RecipeProvider = {
  id: 'schema-org',
  matches(input) {
    return extractFirstUrl(input);
  },
  async fetch(url, ctx) {
    const preview = parseRecipeHtml(await ctx.fetchText(url));
    if (preview.title === null && preview.ingredients.length === 0) {
      // A page without any recipe signal is not an import; failing here
      // surfaces as parse_failed instead of an empty preview.
      throw new Error('no schema.org recipe found on the page');
    }
    return preview;
  },
};

import { cookidooProvider } from './cookidoo.js';
import { schemaOrgProvider } from './schemaorg.js';
import type { RecipeProvider } from './types.js';

export { cookidooProvider, parseCookidooHtml } from './cookidoo.js';
export { decodeHtmlEntities, findJsonLd, readMetaContent, readStringish } from './jsonld.js';
export { parseRecipeHtml } from './recipe.js';
export { schemaOrgProvider } from './schemaorg.js';
export type { ProviderContext, RecipePreview, RecipeProvider } from './types.js';
export { extractFirstUrl } from './url.js';

/**
 * All built-in providers; the server gates them via settings. Order is
 * priority: the generic schema.org catch-all must stay last.
 */
export const allProviders: RecipeProvider[] = [cookidooProvider, schemaOrgProvider];

/** Returns the first enabled provider that can handle the input, with its URL. */
export function matchProvider(
  providers: RecipeProvider[],
  input: string,
): { provider: RecipeProvider; url: string } | undefined {
  for (const provider of providers) {
    const url = provider.matches(input);
    if (url !== null) {
      return { provider, url };
    }
  }
  return undefined;
}

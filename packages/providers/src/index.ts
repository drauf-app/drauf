import { cookidooProvider } from './cookidoo.js';
import type { RecipeProvider } from './types.js';

export { cookidooProvider, parseCookidooHtml } from './cookidoo.js';
export { findJsonLd, readMetaContent, readStringish } from './jsonld.js';
export type { ProviderContext, RecipePreview, RecipeProvider } from './types.js';
export { extractFirstUrl } from './url.js';

/** All built-in providers; the server filters by configuration. */
export const allProviders: RecipeProvider[] = [cookidooProvider];

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

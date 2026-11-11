/** What a provider extracts from a public recipe page. Every field may be missing. */
export interface RecipePreview {
  title: string | null;
  imageUrl: string | null;
  servings: number | null;
  /** Raw ingredient lines; mapping to catalogue items is done by the core. */
  ingredients: string[];
}

/**
 * Network access is injected by the server so that providers stay pure:
 * the core enforces the SSRF guard, timeouts and size limits.
 */
export interface ProviderContext {
  fetchText(url: string): Promise<string>;
}

export interface RecipeProvider {
  /** Stable identifier, also used to disable a provider via configuration. */
  id: string;
  /**
   * Accepts a plain URL or shared text containing one (share sheets often
   * wrap the URL in prose). Returns the recipe URL when this provider can
   * handle the input, null otherwise.
   */
  matches(input: string): string | null;
  fetch(url: string, ctx: ProviderContext): Promise<RecipePreview>;
}

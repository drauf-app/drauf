import { describe, expect, it } from 'vitest';
import {
  cookidooProvider,
  extractFirstUrl,
  matchProvider,
  parseCookidooHtml,
} from '../src/index.js';

/** Synthetic fixture mirroring the structure of the public recipe page. */
const RECIPE_HTML = `<!doctype html>
<html><head>
<title>Fallback title</title>
<meta property="og:title" content="OG Tomatensuppe" />
<meta property="og:image" content="https://img.example/og.jpg" />
<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[]}</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Recipe","name":"Tomatencremesuppe",
 "image":"https://img.example/recipe.jpg","recipeYield":"4 Portionen",
 "recipeIngredient":["1 Knoblauchzehe","50 g Zwiebeln","700 g Tomaten","Salz","1,5 l Wasser"]}
</script>
</head><body></body></html>`;

describe('extractFirstUrl', () => {
  it('finds the URL inside shared text instead of treating the text as a URL', () => {
    const shared =
      'Schau dir dieses köstliche Rezept an: https://cookidoo.de/recipes/recipe/de-DE/r47921! Gefunden auf Cookidoo.';
    expect(extractFirstUrl(shared)).toBe('https://cookidoo.de/recipes/recipe/de-DE/r47921');
  });

  it('returns null when there is no URL', () => {
    expect(extractFirstUrl('kein Link hier')).toBeNull();
  });
});

describe('cookidoo provider', () => {
  it('matches cookidoo URLs in any supported market', () => {
    expect(cookidooProvider.matches('https://cookidoo.de/recipes/recipe/de-DE/r47921')).toBe(
      'https://cookidoo.de/recipes/recipe/de-DE/r47921',
    );
    expect(
      cookidooProvider.matches('Rezept! https://cookidoo.co.uk/recipes/recipe/en-GB/r1 toll'),
    ).toBe('https://cookidoo.co.uk/recipes/recipe/en-GB/r1');
    expect(cookidooProvider.matches('https://example.com/recipes/1')).toBeNull();
    expect(cookidooProvider.matches('https://evil.example/cookidoo.de/x')).toBeNull();
  });

  it('parses title, image, servings and ingredients from JSON-LD', () => {
    const preview = parseCookidooHtml(RECIPE_HTML);
    expect(preview).toEqual({
      title: 'Tomatencremesuppe',
      imageUrl: 'https://img.example/recipe.jpg',
      servings: 4,
      ingredients: ['1 Knoblauchzehe', '50 g Zwiebeln', '700 g Tomaten', 'Salz', '1,5 l Wasser'],
    });
  });

  it('falls back per field and never throws on missing data', () => {
    const noJsonLd = parseCookidooHtml(
      '<html><head><meta property="og:title" content="Nur OG" /></head></html>',
    );
    expect(noJsonLd).toEqual({ title: 'Nur OG', imageUrl: null, servings: null, ingredients: [] });

    const brokenJson = parseCookidooHtml(
      '<script type="application/ld+json">{broken</script><html></html>',
    );
    expect(brokenJson.ingredients).toEqual([]);

    // Partial recipe object: present fields are used, missing ones fall back.
    const partial = parseCookidooHtml(
      '<script type="application/ld+json">{"@type":"Recipe","recipeIngredient":["Salz"]}</script>',
    );
    expect(partial).toEqual({ title: null, imageUrl: null, servings: null, ingredients: ['Salz'] });
  });

  it('reads image arrays and object forms', () => {
    const preview = parseCookidooHtml(
      `<script type="application/ld+json">{"@type":"Recipe","name":"X",
        "image":[{"url":"https://img.example/a.jpg"}],"recipeYield":2}</script>`,
    );
    expect(preview.imageUrl).toBe('https://img.example/a.jpg');
    expect(preview.servings).toBe(2);
  });
});

describe('matchProvider', () => {
  it('returns the first provider that can handle the input', () => {
    const match = matchProvider(
      [cookidooProvider],
      'Rezept: https://cookidoo.de/recipes/recipe/de-DE/r47921',
    );
    expect(match?.provider.id).toBe('cookidoo');
  });

  it('returns undefined for unknown sources', () => {
    expect(matchProvider([cookidooProvider], 'https://example.com/x')).toBeUndefined();
  });
});

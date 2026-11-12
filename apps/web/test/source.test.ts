import { describe, expect, it } from 'vitest';
import { sourceLabel } from '../src/lib/source';

describe('sourceLabel', () => {
  it('labels a link by its second-level domain', () => {
    expect(sourceLabel('https://cookidoo.de/recipes/recipe/de-DE/r47921')).toBe('Cookidoo');
    expect(sourceLabel('https://www.chefkoch.de/rezepte/123')).toBe('Chefkoch');
  });

  it('falls back gracefully for odd inputs', () => {
    expect(sourceLabel('https://localhost/r/1')).toBe('Localhost');
    expect(sourceLabel('not a url')).toBe('not a url');
  });
});

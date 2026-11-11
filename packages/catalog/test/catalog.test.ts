import { BASE_CATEGORY_KEYS, normalizeItemName, parseSize } from '@drauf/shared';
import { describe, expect, it } from 'vitest';
import { buildCatalogIndex, loadCatalog } from '../src/index.js';

const items = loadCatalog();

describe('catalogue data', () => {
  it('covers several hundred items across all base categories', () => {
    expect(items.length).toBeGreaterThanOrEqual(250);
    const coveredKeys = new Set(items.map((item) => item.categoryKey));
    expect([...BASE_CATEGORY_KEYS].filter((key) => !coveredKeys.has(key))).toEqual([]);
  });

  it('uses only known category keys', () => {
    for (const item of items) {
      expect(BASE_CATEGORY_KEYS.has(item.categoryKey), item.categoryKey).toBe(true);
    }
  });

  it('has an icon on every item', () => {
    for (const item of items) {
      expect(item.icon.length, item.name).toBeGreaterThan(0);
    }
  });

  it('keeps names and synonyms unique across the whole catalogue', () => {
    const seen = new Map<string, string>();
    for (const item of items) {
      for (const alias of [item.name, ...item.synonyms]) {
        const key = normalizeItemName(alias);
        const existing = seen.get(key);
        expect(existing, `"${alias}" of ${item.name} already used by ${existing}`).toBeUndefined();
        seen.set(key, item.name);
      }
    }
  });

  it('has sizes that parse into quantity and unit (they become chips)', () => {
    for (const item of items) {
      for (const size of item.sizes) {
        expect(parseSize(size), `${item.name}: "${size}"`).toBeDefined();
      }
    }
  });

  it('has no duplicate varieties or empty strings', () => {
    for (const item of items) {
      const varieties = item.varieties.map((v) => v.trim().toLowerCase());
      expect(new Set(varieties).size, item.name).toBe(varieties.length);
      for (const value of [...item.varieties, ...item.synonyms, ...item.sizes]) {
        expect(value.trim(), item.name).not.toBe('');
      }
    }
  });
});

describe('catalogue index', () => {
  const index = buildCatalogIndex(items);

  it('finds items by name prefix, case-insensitively', () => {
    const results = index.search('nud', 5);
    expect(results.map((item) => item.name)).toContain('Nudeln');
  });

  it('finds items by synonym', () => {
    const results = index.search('pasta', 5);
    expect(results.map((item) => item.name)).toContain('Nudeln');
    expect(index.byName.get('paradeiser')?.name).toBe('Tomaten');
  });

  it('respects the limit and returns unique items', () => {
    const results = index.search('k', 5);
    expect(results.length).toBeLessThanOrEqual(5);
    expect(new Set(results).size).toBe(results.length);
  });

  it('returns nothing for empty queries', () => {
    expect(index.search('  ', 5)).toEqual([]);
  });
});

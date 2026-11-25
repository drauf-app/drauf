import { BASE_CATEGORIES } from '@drauf/shared';
import { describe, expect, it } from 'vitest';
import { emojiToHex, openMojiUrl } from '../src/lib/openmoji';

describe('openmoji mapping', () => {
  it('bundles every base-category default icon (#71)', () => {
    // Guards the sync between BASE_CATEGORIES and the fetch script's UI_ICONS.
    for (const category of BASE_CATEGORIES) {
      expect(openMojiUrl(category.icon), `${category.key} (${category.icon})`).toBeDefined();
    }
  });

  it('maps emoji to OpenMoji hex names, stripping variation selectors', () => {
    expect(emojiToHex('🍝')).toBe('1F35D');
    expect(emojiToHex('🌶️')).toBe('1F336');
    expect(emojiToHex('♻️')).toBe('267B');
  });

  it('returns bundled asset urls and falls back for unknown emoji', () => {
    expect(openMojiUrl('🍝')).toBe('/openmoji/1F35D.svg');
    expect(openMojiUrl('🤷')).toBeUndefined();
  });
});

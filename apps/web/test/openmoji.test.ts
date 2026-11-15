import { describe, expect, it } from 'vitest';
import { emojiToHex, openMojiUrl } from '../src/lib/openmoji';

describe('openmoji mapping', () => {
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

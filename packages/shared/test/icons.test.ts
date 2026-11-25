import { describe, expect, it } from 'vitest';
import {
  emojiToHex,
  formatIconId,
  hexToEmoji,
  ICON_ID_MAX_LENGTH,
  isValidIconId,
  parseIconId,
} from '../src/icons.js';

describe('parseIconId', () => {
  it('reads a bare emoji as the emoji form', () => {
    expect(parseIconId('🍅')).toEqual({ type: 'emoji', emoji: '🍅' });
  });

  it('keeps multi-codepoint emoji intact (ZWJ, variation selectors)', () => {
    const family = '👨‍👩‍👧';
    expect(parseIconId(family)).toEqual({ type: 'emoji', emoji: family });
    expect(parseIconId('❤️')).toEqual({ type: 'emoji', emoji: '❤️' });
  });

  it('reads well-formed pack ids', () => {
    expect(parseIconId('openmoji:1F345')).toEqual({ type: 'pack', pack: 'openmoji', key: '1F345' });
    expect(parseIconId('custom:tomato-2.0')).toEqual({
      type: 'pack',
      pack: 'custom',
      key: 'tomato-2.0',
    });
  });

  it('treats malformed namespaced strings as emoji (rendered as text)', () => {
    expect(parseIconId(':tomato').type).toBe('emoji');
    expect(parseIconId('Custom:tomato').type).toBe('emoji');
    expect(parseIconId('custom:').type).toBe('emoji');
    expect(parseIconId('custom:to mato').type).toBe('emoji');
    expect(parseIconId('custom:../../etc/passwd').type).toBe('emoji');
  });

  it('round-trips through formatIconId', () => {
    for (const id of ['🍅', 'openmoji:1F345', 'custom:spices']) {
      expect(formatIconId(parseIconId(id))).toBe(id);
    }
  });
});

describe('isValidIconId', () => {
  it('accepts emoji and well-formed pack ids', () => {
    expect(isValidIconId('🍅')).toBe(true);
    expect(isValidIconId('openmoji:1F345')).toBe(true);
    expect(isValidIconId('custom:tomato')).toBe(true);
  });

  it('rejects empty, overlong and malformed namespaced ids', () => {
    expect(isValidIconId('')).toBe(false);
    expect(isValidIconId('x'.repeat(ICON_ID_MAX_LENGTH + 1))).toBe(false);
    expect(isValidIconId('Custom:tomato')).toBe(false);
    expect(isValidIconId('custom:')).toBe(false);
    expect(isValidIconId('custom:to mato')).toBe(false);
    expect(isValidIconId('custom:<script>')).toBe(false);
  });

  it('a 64-char namespaced id fits the limit exactly', () => {
    const id = `abcdefghijklmno:${'k'.repeat(48)}`;
    expect(id).toHaveLength(ICON_ID_MAX_LENGTH);
    expect(isValidIconId(id)).toBe(true);
  });
});

describe('emojiToHex / hexToEmoji', () => {
  it('maps emoji to OpenMoji-style hex and back', () => {
    expect(emojiToHex('🍅')).toBe('1F345');
    expect(hexToEmoji('1F345')).toBe('🍅');
  });

  it('strips variation selectors on the way to hex', () => {
    expect(emojiToHex('❤️')).toBe('2764');
  });

  it('joins multi-codepoint sequences with dashes, round-trip safe', () => {
    const family = '👨‍👩‍👧';
    const hex = emojiToHex(family);
    expect(hex).toContain('-');
    expect(hexToEmoji(hex)).toBe(family);
  });

  it('returns undefined for non-hex keys', () => {
    expect(hexToEmoji('tomato')).toBeUndefined();
    expect(hexToEmoji('')).toBeUndefined();
    expect(hexToEmoji('1F345-')).toBeUndefined();
    expect(hexToEmoji('FFFFFF-1F345')).toBeUndefined();
  });
});

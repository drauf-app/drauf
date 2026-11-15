import { OPENMOJI_HEXES } from './openmoji-manifest';

/** OpenMoji file names: codepoints joined by '-', without variation selectors. */
export function emojiToHex(emoji: string): string {
  return [...emoji]
    .map((char) => char.codePointAt(0) as number)
    .filter((code) => code !== 0xfe0f)
    .map((code) => code.toString(16).toUpperCase())
    .join('-');
}

/** The bundled OpenMoji asset for an emoji, or undefined to fall back to text. */
export function openMojiUrl(emoji: string): string | undefined {
  const hex = emojiToHex(emoji);
  return OPENMOJI_HEXES.has(hex) ? `/openmoji/${hex}.svg` : undefined;
}

/** Every bundled icon as its emoji character, for the icon picker. */
export const BUNDLED_EMOJIS: readonly string[] = [...OPENMOJI_HEXES].map((hex) =>
  String.fromCodePoint(...hex.split('-').map((part) => Number.parseInt(part, 16))),
);

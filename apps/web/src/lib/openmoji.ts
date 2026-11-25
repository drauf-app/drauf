import { emojiToHex } from '@drauf/shared';
import { OPENMOJI_HEXES } from './openmoji-manifest';

export { emojiToHex };

/** The bundled OpenMoji asset for an emoji, or undefined to fall back to text. */
export function openMojiUrl(emoji: string): string | undefined {
  return openMojiUrlForHex(emojiToHex(emoji));
}

/** The bundled OpenMoji asset for a hex key ('openmoji:<HEX>' icon ids). */
export function openMojiUrlForHex(hex: string): string | undefined {
  const upper = hex.toUpperCase();
  return OPENMOJI_HEXES.has(upper) ? `/openmoji/${upper}.svg` : undefined;
}

/** Every bundled icon as its emoji character, for the icon picker. */
export const BUNDLED_EMOJIS: readonly string[] = [...OPENMOJI_HEXES].map((hex) =>
  String.fromCodePoint(...hex.split('-').map((part) => Number.parseInt(part, 16))),
);

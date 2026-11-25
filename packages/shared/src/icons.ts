/**
 * Icon identifiers (#71).
 *
 * An icon id is either a bare emoji character (the backwards-compatible form,
 * rendered from the default emoji pack) or a namespaced `pack:key` id such as
 * 'openmoji:1F345' or 'custom:tomato'. No emoji sequence contains an ASCII
 * colon, so stored emoji can never be misread as a namespaced id.
 */

/** Max length for any stored icon id (list, item override, category). */
export const ICON_ID_MAX_LENGTH = 64;

const PACK_RE = /^[a-z][a-z0-9-]{0,31}$/;
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;

export type IconRef =
  | { type: 'emoji'; emoji: string }
  | { type: 'pack'; pack: string; key: string };

/** A string is namespaced iff it contains ':' and both parts are well-formed. */
export function parseIconId(id: string): IconRef {
  const colon = id.indexOf(':');
  if (colon > 0) {
    const pack = id.slice(0, colon);
    const key = id.slice(colon + 1);
    if (PACK_RE.test(pack) && KEY_RE.test(key)) {
      return { type: 'pack', pack, key };
    }
  }
  return { type: 'emoji', emoji: id };
}

export function formatIconId(ref: IconRef): string {
  return ref.type === 'emoji' ? ref.emoji : `${ref.pack}:${ref.key}`;
}

/**
 * Syntactic check only. Whether a pack or key actually resolves is a client
 * concern: instance icons come and go with the data volume, and stored ids
 * must survive that (they degrade to a text or empty rendering).
 */
export function isValidIconId(id: string): boolean {
  if (id.length === 0 || id.length > ICON_ID_MAX_LENGTH) {
    return false;
  }
  if (!id.includes(':')) {
    return true;
  }
  return parseIconId(id).type === 'pack';
}

/** Emoji pack file names: codepoints joined by '-', without variation selectors. */
export function emojiToHex(emoji: string): string {
  return [...emoji]
    .map((char) => char.codePointAt(0) as number)
    .filter((code) => code !== 0xfe0f)
    .map((code) => code.toString(16).toUpperCase())
    .join('-');
}

/** Inverse of emojiToHex for hex-shaped pack keys; undefined for other keys. */
export function hexToEmoji(hex: string): string | undefined {
  if (!/^[0-9A-Fa-f]{1,6}(-[0-9A-Fa-f]{1,6})*$/.test(hex)) {
    return undefined;
  }
  const codes = hex.split('-').map((part) => Number.parseInt(part, 16));
  if (codes.some((code) => code > 0x10ffff)) {
    return undefined;
  }
  return String.fromCodePoint(...codes);
}

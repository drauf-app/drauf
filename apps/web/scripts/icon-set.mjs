/**
 * The icon set both asset scripts (fetch-openmoji.mjs, fetch-fluent.mjs)
 * bundle: everything the catalogue uses plus the UI's own icons.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Asset file names: codepoints joined by '-', without variation selectors.
 * Copy of emojiToHex in packages/shared/src/icons.ts — the scripts must run
 * without a prior workspace build; keep the two in sync.
 */
export function emojiToHex(emoji) {
  return [...emoji]
    .map((char) => char.codePointAt(0))
    .filter((code) => code !== 0xfe0f)
    .map((code) => code.toString(16).toUpperCase())
    .join('-');
}

/** Icons the UI itself uses, beyond the catalogue. */
// 📝 is the note marker; the rest are the base-category defaults — keep in
// sync with BASE_CATEGORIES in packages/shared/src/categories.ts (a web test
// checks that every category default is bundled).
export const UI_ICONS = [
  '📝',
  '🥕',
  '🥖',
  '🥩',
  '🥛',
  '🧊',
  '🍝',
  '🧂',
  '🥐',
  '🥨',
  '🥤',
  '🧼',
  '🧹',
  '📦',
];

/** UI_ICONS plus every catalogue item icon, from the catalogue data files. */
export function collectIcons(dataDir) {
  const icons = new Set(UI_ICONS);
  for (const file of readdirSync(dataDir)) {
    if (!file.endsWith('.json')) continue;
    for (const item of JSON.parse(readFileSync(join(dataDir, file), 'utf8'))) {
      if (typeof item.icon === 'string' && item.icon !== '') {
        icons.add(item.icon);
      }
    }
  }
  return icons;
}

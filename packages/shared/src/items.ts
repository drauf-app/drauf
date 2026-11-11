/** Result of parsing a free-text item line such as "500 g Hack" (K7). */
export interface ParsedItemLine {
  name: string;
  quantity?: number;
  unit?: string;
}

const FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '⅓': 1 / 3,
  '¼': 0.25,
  '¾': 0.75,
  '⅔': 2 / 3,
  '⅛': 0.125,
};

/** Common German shopping units; matching is case-insensitive. */
const UNITS = new Set([
  'g',
  'kg',
  'mg',
  'l',
  'ml',
  'el',
  'tl',
  'prise',
  'prisen',
  'stück',
  'stk',
  'bund',
  'dose',
  'dosen',
  'glas',
  'gläser',
  'packung',
  'packungen',
  'päckchen',
  'becher',
  'zehe',
  'zehen',
  'scheibe',
  'scheiben',
  'würfel',
  'tasse',
  'tassen',
  'blatt',
  'blätter',
]);

function parseQuantityToken(token: string): number | null {
  const fraction = FRACTIONS[token];
  if (fraction !== undefined) {
    return fraction;
  }
  // "1,5" and "1.5" are both common in German input.
  if (/^\d+(?:[.,]\d+)?$/.test(token)) {
    return Number.parseFloat(token.replace(',', '.'));
  }
  // "1½" without a space.
  const combined = /^(\d+)([½⅓¼¾⅔⅛])$/.exec(token);
  if (combined !== null) {
    return Number.parseInt(combined[1] as string, 10) + (FRACTIONS[combined[2] as string] ?? 0);
  }
  return null;
}

/**
 * Parses "2 Milch", "Milch 1,5 l" style prefixes: an optional leading
 * quantity (with optional fraction part) and an optional unit, the rest is
 * the item name. Lines that do not match the pattern become just a name.
 */
export function parseItemLine(line: string): ParsedItemLine {
  const tokens = line.trim().replace(/\s+/g, ' ').split(' ');
  let index = 0;

  let quantity = tokens[0] === undefined ? null : parseQuantityToken(tokens[0]);
  if (quantity !== null) {
    index = 1;
    // "1 ½" — integer followed by a fraction.
    const fractionPart = tokens[1] === undefined ? undefined : FRACTIONS[tokens[1]];
    if (Number.isInteger(quantity) && fractionPart !== undefined) {
      quantity += fractionPart;
      index = 2;
    }
  }

  let unit: string | undefined;
  const unitToken = tokens[index]?.replace(/\.$/, '');
  if (quantity !== null && unitToken !== undefined && UNITS.has(unitToken.toLowerCase())) {
    unit = unitToken;
    index += 1;
  }

  const name = tokens.slice(index).join(' ').trim();
  if (name === '') {
    // "500 g" alone: better an odd name than a lost line.
    return { name: line.trim() };
  }
  return {
    name,
    ...(quantity === null ? {} : { quantity }),
    ...(unit === undefined ? {} : { unit }),
  };
}

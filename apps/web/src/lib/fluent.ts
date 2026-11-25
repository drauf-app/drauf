import { FLUENT_HEXES } from './fluent-manifest';

/** The bundled Fluent Emoji color asset for a hex key, or undefined. */
export function fluentUrlForHex(hex: string): string | undefined {
  const upper = hex.toUpperCase();
  return FLUENT_HEXES.has(upper) ? `/fluent/${upper}.svg` : undefined;
}

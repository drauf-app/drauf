import { openMojiUrl } from '../lib/openmoji';

/**
 * An item icon rendered from the bundled OpenMoji set, so it looks the same
 * on every device; emoji without a bundled asset fall back to the platform
 * glyph. Decorative only — the item name carries the meaning.
 */
export function ItemIcon({ icon }: { icon: string }) {
  const url = openMojiUrl(icon);
  if (url === undefined) {
    return <>{icon}</>;
  }
  return <img className="openmoji" src={url} alt="" aria-hidden="true" />;
}

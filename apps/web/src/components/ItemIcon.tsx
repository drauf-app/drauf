import type { CSSProperties } from 'react';
import { openMojiUrl } from '../lib/openmoji';

/**
 * An item icon rendered from the bundled OpenMoji line-art set, so it looks
 * the same on every device; emoji without a bundled asset fall back to the
 * platform glyph. The SVG is applied as a CSS mask painted with the current
 * text colour (an <img> could not inherit it), so the icons follow light and
 * dark mode. Decorative only — the item name carries the meaning.
 */
export function ItemIcon({ icon }: { icon: string }) {
  const url = openMojiUrl(icon);
  if (url === undefined) {
    return <>{icon}</>;
  }
  const style = { '--openmoji-url': `url(${url})` } as CSSProperties;
  return <span className="openmoji" style={style} aria-hidden="true" />;
}

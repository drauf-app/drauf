import { hexToEmoji, parseIconId } from '@drauf/shared';
import type { CSSProperties } from 'react';
import { openMojiUrl, openMojiUrlForHex } from '../lib/openmoji';

/**
 * An item icon rendered from the bundled OpenMoji line-art set, so it looks
 * the same on every device; emoji without a bundled asset fall back to the
 * platform glyph. The SVG is applied as a CSS mask painted with the current
 * text colour (an <img> could not inherit it), so the icons follow light and
 * dark mode. Decorative only — the item name carries the meaning.
 *
 * Accepts bare emoji and namespaced icon ids ('openmoji:1F345'); unknown
 * namespaced ids degrade to the emoji glyph when the key is a codepoint hex,
 * otherwise to nothing (#71).
 */
export function ItemIcon({ icon }: { icon: string }) {
  const ref = parseIconId(icon);
  if (ref.type === 'emoji') {
    return <MaskedIcon url={openMojiUrl(ref.emoji)} fallback={ref.emoji} />;
  }
  const fallback = hexToEmoji(ref.key) ?? '';
  if (ref.pack === 'openmoji') {
    return <MaskedIcon url={openMojiUrlForHex(ref.key)} fallback={fallback} />;
  }
  // Other packs (instance icons) resolve via the runtime registry in a later step.
  return <MaskedIcon url={undefined} fallback={fallback} />;
}

function MaskedIcon({ url, fallback }: { url: string | undefined; fallback: string }) {
  if (url === undefined) {
    return fallback === '' ? null : <>{fallback}</>;
  }
  const style = { '--openmoji-url': `url(${url})` } as CSSProperties;
  return <span className="openmoji" style={style} aria-hidden="true" />;
}

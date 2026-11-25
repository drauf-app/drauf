import { emojiToHex, hexToEmoji, parseIconId } from '@drauf/shared';
import type { CSSProperties } from 'react';
import { fluentUrlForHex } from '../lib/fluent';
import { useIconRegistry } from '../lib/icon-registry';
import { openMojiUrl, openMojiUrlForHex } from '../lib/openmoji';

/**
 * An item icon. Bundled OpenMoji line art and mono instance icons are applied
 * as a CSS mask painted with the current text colour (an <img> could not
 * inherit it), so they follow light and dark mode; Fluent Emoji and colored
 * instance icons render as plain images. Emoji without a bundled asset fall
 * back to the platform glyph. Decorative only — the item name carries the
 * meaning.
 *
 * Accepts bare emoji (rendered from the instance's default pack, #83) and
 * namespaced icon ids ('openmoji:1F345', 'fluent:1F345', 'custom:tomato');
 * unknown ids degrade to the emoji glyph when the key is a codepoint hex,
 * otherwise to nothing (#71).
 */
export function ItemIcon({ icon }: { icon: string }) {
  const registry = useIconRegistry();
  const ref = parseIconId(icon);
  if (ref.type === 'emoji') {
    if (registry.defaultPack === 'fluent') {
      const url = fluentUrlForHex(emojiToHex(ref.emoji));
      if (url !== undefined) {
        return <ImgIcon url={url} />;
      }
      // Not in Fluent: the mono asset still beats a platform glyph.
    }
    return <MaskedIcon url={openMojiUrl(ref.emoji)} fallback={ref.emoji} />;
  }
  if (ref.pack === 'openmoji') {
    return <MaskedIcon url={openMojiUrlForHex(ref.key)} fallback={hexToEmoji(ref.key) ?? ''} />;
  }
  if (ref.pack === 'fluent') {
    const url = fluentUrlForHex(ref.key);
    if (url !== undefined) {
      return <ImgIcon url={url} />;
    }
    return <MaskedIcon url={undefined} fallback={hexToEmoji(ref.key) ?? ''} />;
  }
  const entry = registry.byId.get(icon);
  if (entry !== undefined) {
    if (entry.kind === 'mono') {
      return <MaskedIcon url={entry.url} fallback="" />;
    }
    return <ImgIcon url={entry.url} />;
  }
  return <MaskedIcon url={undefined} fallback={hexToEmoji(ref.key) ?? ''} />;
}

function ImgIcon({ url }: { url: string }) {
  return <img className="icon-img" src={url} alt="" aria-hidden="true" loading="lazy" />;
}

function MaskedIcon({ url, fallback }: { url: string | undefined; fallback: string }) {
  if (url === undefined) {
    return fallback === '' ? null : <>{fallback}</>;
  }
  const style = { '--openmoji-url': `url(${url})` } as CSSProperties;
  return <span className="openmoji" style={style} aria-hidden="true" />;
}

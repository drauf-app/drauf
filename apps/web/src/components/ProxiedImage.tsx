import { useEffect, useState } from 'react';
import { proxiedImageUrl } from '../api/import';
import { apiFetch } from '../auth/store';

interface ProxiedImageProps {
  /** The remote image; it is fetched through the server's image proxy. */
  imageUrl: string;
  className?: string;
}

/**
 * The image proxy sits behind bearer auth, which a plain <img> cannot send —
 * so the image is fetched with the API client and shown as an object URL.
 * A failing image renders nothing.
 */
export function ProxiedImage({ imageUrl, className }: ProxiedImageProps) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    let objectUrl: string | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const response = await apiFetch(proxiedImageUrl(imageUrl));
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setSrc(objectUrl);
        }
      } catch {
        // Missing or blocked image: the preview works without it.
      }
    })();
    return () => {
      cancelled = true;
      setSrc(undefined);
      if (objectUrl !== undefined) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [imageUrl]);

  if (src === undefined) {
    return null;
  }
  return <img className={className} src={src} alt="" />;
}

/**
 * A user's avatar (#98): the cached IdP picture when there is one, otherwise
 * an initial on a background colored deterministically from the user id, so
 * every account keeps a stable, recognizable color.
 */
export function Avatar({
  name,
  userId,
  url,
  size = 'small',
}: {
  name: string;
  userId: string;
  url: string | null;
  size?: 'small' | 'large';
}) {
  const className = `avatar avatar-${size}`;
  if (url !== null) {
    // Decorative: the display name is always rendered as text next to it.
    return <img className={className} src={url} alt="" aria-hidden="true" />;
  }
  let hash = 0;
  for (const char of userId) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
  }
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{ backgroundColor: `hsl(${hash} 45% 42%)` }}
    >
      {[...name.trim()][0]?.toUpperCase() ?? '?'}
    </span>
  );
}

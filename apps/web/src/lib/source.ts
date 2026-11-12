/** "https://cookidoo.de/…" → "Cookidoo": a short label for a link's source. */
export function sourceLabel(link: string): string {
  try {
    const host = new URL(link).hostname.replace(/^www\./, '');
    const parts = host.split('.');
    const name = parts.length > 1 ? (parts[parts.length - 2] as string) : host;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return link;
  }
}

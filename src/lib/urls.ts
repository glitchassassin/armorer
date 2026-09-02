export function normalizeBase(base: string) {
  const withLeading = base.startsWith('/') ? base : `/${base}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

export function removeBase(pathname: string, base: string) {
  const normalized = normalizeBase(base);
  if (normalized === '/') return pathname;
  return pathname.startsWith(normalized) ? `/${pathname.slice(normalized.length)}` : pathname;
}

export function withBase(path: string, base = import.meta.env.BASE_URL) {
  const normalizedBase = normalizeBase(base);
  const relative = path.replace(/^\//, '');
  return normalizedBase === '/' ? `/${relative}` : `${normalizedBase}${relative}`;
}

export function canonicalChapterPath(bookSlug: string, chapter: number) {
  return `/${bookSlug}/${chapter}/`;
}

export function absoluteCanonicalUrl(path: string) {
  return new URL(withBase(path), window.location.origin).toString();
}

export function parseChapterPath(pathname: string, base = import.meta.env.BASE_URL) {
  const path = removeBase(pathname, base);
  const match = path.match(/^\/([^/]+)\/(\d+)\/$/);
  if (!match) return undefined;
  return { bookSlug: decodeURIComponent(match[1]), chapter: Number(match[2]), path };
}

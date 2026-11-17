import type { GlobalSearchResultItem } from './types.ts';

export function normalizeSearchQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

export function matchesSearchTerms(
  query: string,
  ...candidates: Array<string | number | null | undefined>
): boolean {
  const q = normalizeSearchQuery(query);
  if (!q) return false;
  return candidates.some(
    (c) => c !== null && c !== undefined && String(c).toLowerCase().includes(q)
  );
}

export function rankSearchResults(
  query: string,
  items: GlobalSearchResultItem[],
  limit = 15
): GlobalSearchResultItem[] {
  const q = normalizeSearchQuery(query);
  if (!q) return [];

  return [...items]
    .sort((a, b) => {
      const aExact = a.title.toLowerCase().startsWith(q) ? 0 : 1;
      const bExact = b.title.toLowerCase().startsWith(q) ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return a.title.localeCompare(b.title);
    })
    .slice(0, limit);
}

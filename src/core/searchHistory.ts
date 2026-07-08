import { storageRead, storageWrite } from './engine';

const RECENT_SEARCHES_KEY = 'recent_searches';
const MAX_RECENT_SEARCHES = 8;

export function normalizeRecentSearches(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((item) => String(item ?? '').trim())
    .filter((item) => {
      const key = item.toLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_RECENT_SEARCHES);
}

export async function loadRecentSearches(): Promise<string[]> {
  try {
    const items = await storageRead<string[]>(RECENT_SEARCHES_KEY);
    return normalizeRecentSearches(items);
  } catch {
    return [];
  }
}

export function addRecentSearch(query: string, current: string[]): string[] {
  const normalized = query.trim();
  if (normalized.length < 2) return current;
  const next = normalizeRecentSearches([normalized, ...current.filter((item) => item.toLowerCase() !== normalized.toLowerCase())]);
  void storageWrite(RECENT_SEARCHES_KEY, next);
  return next;
}

export function removeRecentSearch(query: string, current: string[]): string[] {
  const next = current.filter((item) => item !== query);
  void storageWrite(RECENT_SEARCHES_KEY, next);
  return next;
}

export function clearRecentSearches(): string[] {
  void storageWrite(RECENT_SEARCHES_KEY, []);
  return [];
}

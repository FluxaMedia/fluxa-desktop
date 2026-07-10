import { storageRead, storageWrite } from './engine';
import type { Meta } from './types';

const RECENT_SEARCHES_KEY = 'recent_searches';
const MAX_RECENT_SEARCHES = 8;

export interface RecentSearch {
  query: string;
  meta?: Meta;
}

export function normalizeRecentSearches(value: unknown): RecentSearch[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((item): RecentSearch | null => {
      if (typeof item === 'string') {
        const query = item.trim();
        return query ? { query } : null;
      }
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const query = typeof record.query === 'string' ? record.query.trim() : '';
      const meta = record.meta && typeof record.meta === 'object' ? record.meta as Meta : undefined;
      return query ? { query, meta } : null;
    })
    .filter((item): item is RecentSearch => {
      if (!item) return false;
      const key = item.query.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_RECENT_SEARCHES);
}

export async function loadRecentSearches(): Promise<RecentSearch[]> {
  try {
    const items = await storageRead<unknown[]>(RECENT_SEARCHES_KEY);
    return normalizeRecentSearches(items);
  } catch {
    return [];
  }
}

export function addRecentSearch(query: string, current: RecentSearch[], meta?: Meta): RecentSearch[] {
  const normalized = query.trim();
  if (normalized.length < 2) return current;
  const next = normalizeRecentSearches([
    { query: normalized, ...(meta ? { meta } : {}) },
    ...current.filter((item) => item.query.toLowerCase() !== normalized.toLowerCase()),
  ]);
  void storageWrite(RECENT_SEARCHES_KEY, next);
  return next;
}

export function removeRecentSearch(query: string, current: RecentSearch[]): RecentSearch[] {
  const next = current.filter((item) => item.query !== query);
  void storageWrite(RECENT_SEARCHES_KEY, next);
  return next;
}

export function clearRecentSearches(): RecentSearch[] {
  void storageWrite(RECENT_SEARCHES_KEY, []);
  return [];
}

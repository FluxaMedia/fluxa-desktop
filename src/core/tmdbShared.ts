import { tryFetchJson } from './httpClient';

export function tmdbContentType(contentType: string): string {
  return contentType === 'series' ? 'tv' : 'movie';
}

export function tmdbLanguage(language: string): string {
  if (!language || language === 'en') return 'en-US';
  if (language === 'tr') return 'tr-TR';
  return language.includes('-') ? language : `${language}-${language.toUpperCase()}`;
}

export function tmdbUrl(path: string, apiKey: string, language: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    api_key: apiKey,
    language: tmdbLanguage(language),
    ...extra,
  });
  return `https://api.themoviedb.org/${path}?${params.toString()}`;
}

interface TmdbFindResult {
  id?: number;
}

export interface TmdbIdRequest {
  contentType: string;
  id: string;
  language: string;
  apiKey: string;
}

export async function resolveTmdbId({ contentType, id, language, apiKey }: TmdbIdRequest): Promise<string | null> {
  const baseId = id.replace(/^tmdb:/i, '').split(':')[0] ?? '';
  if (/^\d+$/.test(baseId)) return baseId;
  const imdbId = id.split(':')[0];
  if (!/^tt\d+$/i.test(imdbId)) return null;
  const response = await tryFetchJson(tmdbUrl(`3/find/${encodeURIComponent(imdbId)}`, apiKey, language, {
    external_source: 'imdb_id',
  }));
  const key = contentType === 'series' ? 'tv_results' : 'movie_results';
  const result = ((response as Record<string, TmdbFindResult[]> | null)?.[key] ?? [])[0];
  return result?.id != null ? String(result.id) : null;
}

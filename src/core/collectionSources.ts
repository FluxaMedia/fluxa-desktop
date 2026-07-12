import { invoke } from '@tauri-apps/api/core';
import { platformFetch } from './httpClient';
import type { Meta, NuvioRemoteCollectionSource } from './types';
import { loadPrefs } from './libraryOps';
import { prefString } from './appPrefs';
import { coreTmdbBulkMetas } from './engine';

interface TraktItem {
  movie?: { title?: string; year?: number; ids?: { imdb?: string; tmdb?: number } };
  show?: { title?: string; year?: number; ids?: { imdb?: string; tmdb?: number } };
}

function metaFromTraktItem(item: TraktItem, mediaType: string): Meta | null {
  const isSeries = mediaType.toUpperCase() === 'TV';
  const value = isSeries ? item.show : item.movie;
  if (!value?.title) return null;
  const id = value.ids?.imdb ?? (value.ids?.tmdb ? `tmdb:${value.ids.tmdb}` : null);
  if (!id) return null;
  return {
    id,
    type: isSeries ? 'series' : 'movie',
    name: value.title,
    releaseInfo: value.year ? String(value.year) : undefined,
  };
}

export function isNuvioCollectionSource(source: unknown): source is NuvioRemoteCollectionSource {
  return !!source && typeof source === 'object' &&
    (((source as NuvioRemoteCollectionSource).provider === 'trakt' && typeof (source as NuvioRemoteCollectionSource).traktListId === 'number') ||
      (source as NuvioRemoteCollectionSource).provider === 'tmdb');
}

export async function loadNuvioCollectionSource(source: NuvioRemoteCollectionSource, page = 1): Promise<Meta[]> {
  if (source.provider === 'tmdb') return loadTmdbCollectionSource(source, page);
  if (!source.traktListId) return [];
  const clientId = await invoke<string>('get_oauth_client_id', { service: 'trakt' }).catch(() => '');
  if (!clientId) return [];
  const type = source.mediaType?.toUpperCase() === 'TV' ? 'show' : 'movie';
  const params = new URLSearchParams({ extended: 'full,images', page: String(page), limit: '50' });
  if (source.sortBy) params.set('sort_by', source.sortBy);
  if (source.sortHow) params.set('sort_how', source.sortHow);
  try {
    const response = await platformFetch(
      `https://api.trakt.tv/lists/${encodeURIComponent(String(source.traktListId))}/items/${type}?${params}`,
      { headers: { 'trakt-api-version': '2', 'trakt-api-key': clientId } },
    );
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data)
      ? data.map((item) => metaFromTraktItem(item as TraktItem, source.mediaType ?? 'MOVIE')).filter((item): item is Meta => !!item)
      : [];
  } catch {
    return [];
  }
}

function tmdbType(source: NuvioRemoteCollectionSource): string {
  return source.mediaType?.toUpperCase() === 'TV' ? 'tv' : 'movie';
}

function setFilter(params: URLSearchParams, source: Record<string, unknown>, input: string, output: string) {
  const value = source[input];
  if (typeof value === 'string' || typeof value === 'number') params.set(output, String(value));
}

async function loadTmdbCollectionSource(source: NuvioRemoteCollectionSource, page: number): Promise<Meta[]> {
  const prefs = await loadPrefs();
  const apiKey = prefString(prefs, 'tmdbApiKey').trim();
  if (!apiKey) return [];
  const type = source.tmdbSourceType === 'NETWORK' ? 'tv' : tmdbType(source);
  const language = prefString(prefs, 'language', 'en').replace('_', '-');
  const params = new URLSearchParams({ api_key: apiKey, language, page: String(page) });
  let path: string;
  if (source.tmdbSourceType === 'LIST' && source.tmdbId) {
    path = `3/list/${source.tmdbId}`;
  } else if (source.tmdbSourceType === 'COLLECTION' && source.tmdbId) {
    path = `3/collection/${source.tmdbId}`;
    params.delete('page');
  } else if ((source.tmdbSourceType === 'PERSON' || source.tmdbSourceType === 'DIRECTOR') && source.tmdbId) {
    path = `3/person/${source.tmdbId}/combined_credits`;
    params.delete('page');
  } else {
    path = `3/discover/${type}`;
    params.set('sort_by', source.sortBy ?? 'popularity.desc');
    if (source.tmdbSourceType === 'COMPANY' && source.tmdbId) params.set('with_companies', String(source.tmdbId));
    if (source.tmdbSourceType === 'NETWORK' && source.tmdbId) params.set('with_networks', String(source.tmdbId));
    const filters = source.filters ?? {};
    setFilter(params, filters, 'year', type === 'tv' ? 'first_air_date_year' : 'year');
    setFilter(params, filters, 'withGenres', 'with_genres');
    setFilter(params, filters, 'watchRegion', 'watch_region');
    setFilter(params, filters, 'voteCountGte', 'vote_count.gte');
    setFilter(params, filters, 'withKeywords', 'with_keywords');
    setFilter(params, filters, 'withNetworks', 'with_networks');
    setFilter(params, filters, 'withCompanies', 'with_companies');
    setFilter(params, filters, 'releaseDateGte', type === 'tv' ? 'first_air_date.gte' : 'primary_release_date.gte');
    setFilter(params, filters, 'releaseDateLte', type === 'tv' ? 'first_air_date.lte' : 'primary_release_date.lte');
    setFilter(params, filters, 'voteAverageGte', 'vote_average.gte');
    setFilter(params, filters, 'voteAverageLte', 'vote_average.lte');
    setFilter(params, filters, 'withOriginCountry', 'with_origin_country');
    setFilter(params, filters, 'withWatchProviders', 'with_watch_providers');
    setFilter(params, filters, 'withOriginalLanguage', 'with_original_language');
  }
  try {
    const response = await platformFetch(`https://api.themoviedb.org/${path}?${params}`);
    if (!response.ok) return [];
    const data = await response.json() as { parts?: unknown[]; items?: unknown[]; results?: unknown[]; cast?: Array<Record<string, unknown>>; crew?: Array<Record<string, unknown>> };
    const mediaType = source.mediaType?.toUpperCase() === 'TV' ? 'tv' : 'movie';
    const credits = source.tmdbSourceType === 'DIRECTOR'
      ? data.crew?.filter((credit) => credit.job === 'Director')
      : data.cast;
    const items = source.tmdbSourceType === 'COLLECTION'
      ? data.parts
      : source.tmdbSourceType === 'LIST'
        ? data.items
        : (source.tmdbSourceType === 'PERSON' || source.tmdbSourceType === 'DIRECTOR')
          ? credits?.filter((credit) => credit.media_type === mediaType)
          : data.results;
    const resolvedItems = Array.isArray(items) ? items : [];
    if (source.tmdbSourceType === 'LIST') {
      const movies = resolvedItems.filter((item) => (item as Record<string, unknown>).media_type !== 'tv');
      const series = resolvedItems.filter((item) => (item as Record<string, unknown>).media_type === 'tv');
      const [movieMetas, seriesMetas] = await Promise.all([
        coreTmdbBulkMetas(JSON.stringify(movies), 'movie', language),
        coreTmdbBulkMetas(JSON.stringify(series), 'series', language),
      ]);
      return [...((movieMetas ?? []) as Meta[]), ...((seriesMetas ?? []) as Meta[])];
    }
    return ((await coreTmdbBulkMetas(JSON.stringify(resolvedItems), type === 'tv' ? 'series' : 'movie', language)) ?? []) as Meta[];
  } catch {
    return [];
  }
}

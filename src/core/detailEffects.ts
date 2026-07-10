import {
  coreDetailSeriesLookupId,
  coreTmdbImageUrl,
  coreTmdbBulkMetas,
  coreTmdbBulkVideosToTrailers,
  dispatchAction,
} from './engine';
import { loadAddons, loadActiveProfile, loadPrefs } from './libraryOps';
import { fetchPlannedResources } from './fetchPlanning';
import { tryFetchJson } from './httpClient';
import { fetchTraktSimilarItems, fetchSimklSimilarItems } from './similarTitles';
import { isTraktConnected, isSimklConnected } from './profiles';
import type { AppState, Video } from './types';
import { DEFAULT_APP_PREFS, prefBool, prefString } from './appPrefs';

interface TmdbRequest {
  contentType: string;
  id: string;
  language: string;
  apiKey: string;
}

interface TmdbMetaResult {
  id?: number;
  title?: string;
  name?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  media_type?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
}

interface TmdbVideoResult {
  id?: string;
  key?: string;
  name?: string;
  site?: string;
  type?: string;
}

async function fetchTmdbSimilarItems({
  contentType,
  id,
  language,
  apiKey,
  recommendationsEnabled,
  similarEnabled,
}: TmdbRequest & { recommendationsEnabled: boolean; similarEnabled: boolean }): Promise<unknown[]> {
  if (!apiKey || (!recommendationsEnabled && !similarEnabled)) return [];
  const tmdbId = await resolveTmdbId({ contentType, id, language, apiKey });
  if (!tmdbId) return [];
  const tmdbType = tmdbContentType(contentType);
  const calls = [
    recommendationsEnabled ? `recommendations` : null,
    similarEnabled ? `similar` : null,
  ].filter(Boolean) as string[];

  for (const path of calls) {
    const response = await tryFetchJson(tmdbUrl(`3/${tmdbType}/${tmdbId}/${path}`, apiKey, language));
    const rawItems = (response as { results?: TmdbMetaResult[] } | null)?.results ?? [];
    if (!rawItems.length) continue;
    const results = (await coreTmdbBulkMetas(JSON.stringify(rawItems), contentType, language)) ?? [];
    if (results.length) return results;
  }
  return [];
}

export async function fetchTmdbTrailers({ contentType, id, language, apiKey }: TmdbRequest): Promise<unknown[]> {
  if (!apiKey) return [];
  const tmdbId = await resolveTmdbId({ contentType, id, language, apiKey });
  if (!tmdbId) return [];
  const response = await tryFetchJson(tmdbUrl(`3/${tmdbContentType(contentType)}/${tmdbId}/videos`, apiKey, language));
  const rawVideos = (response as { results?: TmdbVideoResult[] } | null)?.results ?? [];
  if (!rawVideos.length) return [];
  return (await coreTmdbBulkVideosToTrailers(JSON.stringify(rawVideos))) ?? [];
}

async function resolveTmdbId({ contentType, id, language, apiKey }: TmdbRequest): Promise<string | null> {
  const baseId = id.replace(/^tmdb:/i, '').split(':')[0] ?? '';
  if (/^\d+$/.test(baseId)) return baseId;
  const imdbId = id.split(':')[0];
  if (!/^tt\d+$/i.test(imdbId)) return null;
  const response = await tryFetchJson(tmdbUrl(`3/find/${encodeURIComponent(imdbId)}`, apiKey, language, {
    external_source: 'imdb_id',
  }));
  const key = contentType === 'series' ? 'tv_results' : 'movie_results';
  const result = ((response as Record<string, TmdbMetaResult[]> | null)?.[key] ?? [])[0];
  return result?.id != null ? String(result.id) : null;
}

export async function fetchTmdbPosterFallback({
  contentType,
  id,
  language,
  apiKey,
}: TmdbRequest): Promise<{ poster?: string; background?: string } | null> {
  if (!apiKey) return null;
  const tmdbId = await resolveTmdbId({ contentType, id, language, apiKey });
  if (!tmdbId) return null;
  const response = await tryFetchJson(
    tmdbUrl(`3/${tmdbContentType(contentType)}/${tmdbId}`, apiKey, language),
  ) as TmdbMetaResult | null;
  if (!response) return null;
  const poster = await coreTmdbImageUrl(response.poster_path ?? null, 'w500');
  const background = await coreTmdbImageUrl(response.backdrop_path ?? null, 'w1280');
  if (!poster && !background) return null;
  return { poster: poster ?? undefined, background: background ?? undefined };
}

function tmdbUrl(path: string, apiKey: string, language: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    api_key: apiKey,
    language: tmdbLanguage(language),
    ...extra,
  });
  return `https://api.themoviedb.org/${path}?${params.toString()}`;
}

function tmdbContentType(contentType: string): string {
  return contentType === 'series' ? 'tv' : 'movie';
}

function tmdbLanguage(language: string): string {
  if (!language || language === 'en') return 'en-US';
  if (language === 'tr') return 'tr-TR';
  return language.includes('-') ? language : `${language}-${language.toUpperCase()}`;
}

export async function fetchMetaDetail(payload: Record<string, unknown>): Promise<unknown> {
  const id = payload.id as string;
  const contentType = payload.contentType as string;
  const addons = await loadAddons();
  const values = await fetchPlannedResources({ kind: 'metaDetail', addons, contentType, id });
  return (values.find((value) => (value as { meta?: unknown }).meta) as { meta?: unknown } | undefined)?.meta ?? null;
}

export async function fetchMetaVideos(id: string, contentType: string): Promise<Video[]> {
  try {
    const meta = await fetchMetaDetail({ id, contentType }) as { videos?: Video[] } | null;
    return meta?.videos ?? [];
  } catch {
    return [];
  }
}

export async function fetchDetailStreams(
  payload: Record<string, unknown>,
  onStateUpdate?: (state: Partial<AppState>) => void,
): Promise<unknown> {
  const idField = payload.id as string | undefined;
  const requestIds = (payload.requestIds as string[] | undefined) ?? (idField ? [idField] : []);
  const addons = await loadAddons();
  const contentType = payload.contentType as string;

  const partialDispatches: Promise<void>[] = [];

  const values = await fetchPlannedResources(
    { kind: 'streams', addons, contentType, requestIds },
    onStateUpdate
      ? (partialValue) => {
          const partialStreams = ((partialValue as { streams?: unknown[] })?.streams ?? []);
          if (partialStreams.length === 0) return;
          const partialAddons = [...new Set(
            (partialStreams as Array<{ addonName?: string }>)
              .map((s) => s.addonName)
              .filter(Boolean),
          )] as string[];
          partialDispatches.push(
            dispatchAction(JSON.stringify({
              type: 'detailStreamsAppended',
              streams: partialStreams,
              availableAddons: partialAddons,
            })).then((result) => {
              if (result?.state) onStateUpdate(result.state);
            }).catch(() => {}),
          );
        }
      : undefined,
  );

  // Ensure all partial dispatches complete before completeEffect runs
  await Promise.allSettled(partialDispatches);

  const streams = values.flatMap((value) => ((value as { streams?: unknown[] })?.streams ?? []));

  const availableAddons = [...new Set(
    (streams as Array<{ addonName?: string }>).map((s) => s.addonName).filter(Boolean),
  )] as string[];

  return {
    streams,
    availableAddons,
    hasStreamProviders: streams.length > 0,
  };
}

export async function fetchSeasonEpisodes(payload: Record<string, unknown>): Promise<unknown> {
  const addons = await loadAddons();
  const seriesId = await coreDetailSeriesLookupId(payload.seriesId as string);
  const season = payload.season as number;
  const values = await fetchPlannedResources({ kind: 'seasonEpisodes', addons, id: seriesId, season });
  return values.find((value) => (value as { episodes?: unknown[] })?.episodes?.length) ?? { episodes: [] };
}

interface OmdbRatings {
  rottenTomatoes?: string;
  metascore?: string;
}

async function fetchOmdbRatings(id: string, apiKey: string): Promise<OmdbRatings | null> {
  if (!apiKey) return null;
  const imdbId = id.split(':')[0];
  if (!/^tt\d+$/i.test(imdbId)) return null;
  const response = await tryFetchJson(`https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${apiKey}`) as {
    Ratings?: { Source?: string; Value?: string }[];
    Metascore?: string;
  } | null;
  if (!response) return null;
  const rottenTomatoes = response.Ratings?.find((r) => r.Source === 'Rotten Tomatoes')?.Value;
  const metascore = response.Metascore && response.Metascore !== 'N/A' ? response.Metascore : undefined;
  if (!rottenTomatoes && !metascore) return null;
  return { rottenTomatoes, metascore };
}

interface FanartArtwork {
  hdLogo?: string;
  hdBackdrop?: string;
}

async function resolveTvdbId(tmdbId: string, apiKey: string, language: string): Promise<string | null> {
  const response = await tryFetchJson(
    tmdbUrl(`3/tv/${tmdbId}/external_ids`, apiKey, language),
  ) as { tvdb_id?: number | null } | null;
  return response?.tvdb_id != null ? String(response.tvdb_id) : null;
}

async function fetchFanartArtwork(
  { contentType, id, language, apiKey }: TmdbRequest,
  fanartApiKey: string,
): Promise<FanartArtwork | null> {
  if (!fanartApiKey || !apiKey) return null;
  const tmdbId = await resolveTmdbId({ contentType, id, language, apiKey });
  if (!tmdbId) return null;

  if (contentType === 'series') {
    const tvdbId = await resolveTvdbId(tmdbId, apiKey, language);
    if (!tvdbId) return null;
    const response = await tryFetchJson(`https://webservice.fanart.tv/v3/tv/${tvdbId}?api_key=${fanartApiKey}`) as {
      hdtvlogo?: { url?: string }[];
      showbackground?: { url?: string }[];
    } | null;
    if (!response) return null;
    const hdLogo = response.hdtvlogo?.[0]?.url;
    const hdBackdrop = response.showbackground?.[0]?.url;
    if (!hdLogo && !hdBackdrop) return null;
    return { hdLogo, hdBackdrop };
  }

  const response = await tryFetchJson(`https://webservice.fanart.tv/v3/movies/${tmdbId}?api_key=${fanartApiKey}`) as {
    hdmovielogo?: { url?: string }[];
    moviebackground?: { url?: string }[];
  } | null;
  if (!response) return null;
  const hdLogo = response.hdmovielogo?.[0]?.url;
  const hdBackdrop = response.moviebackground?.[0]?.url;
  if (!hdLogo && !hdBackdrop) return null;
  return { hdLogo, hdBackdrop };
}

async function fetchSimilarItems({
  contentType,
  id,
  language,
  apiKey,
  source,
  recommendationsEnabled,
  similarEnabled,
}: TmdbRequest & { source: string; recommendationsEnabled: boolean; similarEnabled: boolean }): Promise<unknown[]> {
  const tmdbFallback = () => fetchTmdbSimilarItems({
    contentType,
    id,
    language,
    apiKey,
    recommendationsEnabled,
    similarEnabled,
  });

  if (source === 'tmdb') return tmdbFallback();

  const profile = await loadActiveProfile();
  const traktAvailable = source !== 'simkl' && isTraktConnected(profile);
  const simklAvailable = source !== 'trakt' && isSimklConnected(profile);

  if (source === 'trakt' && !traktAvailable) return tmdbFallback();
  if (source === 'simkl' && !simklAvailable) return tmdbFallback();

  if (traktAvailable) {
    const items = await fetchTraktSimilarItems({ id, contentType });
    if (items.length) return items;
    if (simklAvailable) {
      const simklItems = await fetchSimklSimilarItems({ id, contentType });
      if (simklItems.length) return simklItems;
    }
    return tmdbFallback();
  }

  if (simklAvailable) {
    const items = await fetchSimklSimilarItems({ id, contentType });
    if (items.length) return items;
    return tmdbFallback();
  }

  return tmdbFallback();
}

export async function fetchDetailSecondary(payload: Record<string, unknown>): Promise<unknown> {
  const prefs = { ...DEFAULT_APP_PREFS, ...(await loadPrefs()) };
  const contentType = String(payload.contentType ?? payload.type ?? 'movie');
  const id = String(payload.id ?? '');
  const language = prefString(prefs, 'language', String(payload.language ?? 'en'));
  const apiKey = prefString(prefs, 'tmdbApiKey');
  const omdbApiKey = prefString(prefs, 'omdbApiKey');
  const fanartApiKey = prefString(prefs, 'fanartApiKey');

  const [similarItems, trailers, omdbRatings, fanartArtwork] = await Promise.all([
    (prefBool(prefs, 'tmdbRecommendationsEnabled', true) || prefBool(prefs, 'tmdbSimilarResultsEnabled', true))
      ? fetchSimilarItems({
          contentType,
          id,
          language,
          apiKey,
          source: prefString(prefs, 'similarTitlesSource', 'auto'),
          recommendationsEnabled: prefBool(prefs, 'tmdbRecommendationsEnabled', true),
          similarEnabled: prefBool(prefs, 'tmdbSimilarResultsEnabled', true),
        })
      : Promise.resolve([]),
    prefBool(prefs, 'tmdbTrailersEnabled', true)
      ? fetchTmdbTrailers({ contentType, id, language, apiKey })
      : Promise.resolve([]),
    fetchOmdbRatings(id, omdbApiKey),
    fetchFanartArtwork({ contentType, id, language, apiKey }, fanartApiKey),
  ]);

  return {
    watchedVideoIds: [],
    similarItems,
    trailers,
    omdbRatings,
    fanartArtwork,
  };
}

export async function prefetchDetailStreams(payload: Record<string, unknown>): Promise<unknown> {
  return fetchDetailStreams(payload);
}

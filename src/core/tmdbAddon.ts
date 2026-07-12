import {
  coreTmdbBuiltinCatalogUrl,
  coreTmdbBuiltinManifest,
  coreTmdbBulkMetas,
  coreTmdbEpisodesToVideos,
  coreTmdbFullMetaToMeta,
} from './engine';
import { tryFetchJson } from './httpClient';
import { resolveTmdbId, tmdbContentType, tmdbUrl } from './tmdbShared';
import type { AddonDescriptor } from './types';

export const BUILTIN_TMDB_TRANSPORT_URL = 'tmdb://builtin';

export function isBuiltinTmdbAddon(addonOrTransportUrl: AddonDescriptor | string | undefined | null): boolean {
  const transportUrl = typeof addonOrTransportUrl === 'string' ? addonOrTransportUrl : addonOrTransportUrl?.transportUrl;
  return transportUrl === BUILTIN_TMDB_TRANSPORT_URL;
}

export async function builtinTmdbDescriptor(apiKey: string): Promise<AddonDescriptor | null> {
  if (!apiKey.trim()) return null;
  const manifestJson = await coreTmdbBuiltinManifest();
  const manifest = JSON.parse(manifestJson) as AddonDescriptor['manifest'];
  return { transportUrl: BUILTIN_TMDB_TRANSPORT_URL, manifest };
}

export async function withBuiltinTmdbAddon(
  addons: AddonDescriptor[],
  prefs: Record<string, unknown>,
): Promise<AddonDescriptor[]> {
  const apiKey = String(prefs.tmdbApiKey ?? '');
  const descriptor = await builtinTmdbDescriptor(apiKey);
  if (!descriptor) return addons;
  return prefs.tmdbPreferOverAddons ? [descriptor, ...addons] : [...addons, descriptor];
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function fetchBuiltinCatalog(
  type: string,
  extra: Record<string, unknown>,
  apiKey: string,
  language: string,
): Promise<{ metas: unknown[] }> {
  const url = await coreTmdbBuiltinCatalogUrl(type, extra, apiKey, language);
  if (!url) return { metas: [] };
  const data = (await tryFetchJson(url)) as { results?: unknown[] } | null;
  const items = data?.results ?? [];
  if (items.length === 0) return { metas: [] };
  const metas = (await coreTmdbBulkMetas(JSON.stringify(items), type, language)) ?? [];
  return { metas };
}

interface TmdbSeasonSummary {
  season_number?: number;
}

export async function fetchBuiltinMeta(
  type: string,
  id: string,
  apiKey: string,
  language: string,
): Promise<{ meta: unknown } | null> {
  const tmdbId = await resolveTmdbId({ contentType: type, id, language, apiKey });
  if (!tmdbId) return null;
  const tmdbType = tmdbContentType(type);

  const [details, credits, images, externalIds] = await Promise.all([
    tryFetchJson(tmdbUrl(`3/${tmdbType}/${tmdbId}`, apiKey, language)),
    tryFetchJson(tmdbUrl(`3/${tmdbType}/${tmdbId}/credits`, apiKey, language)),
    tryFetchJson(tmdbUrl(`3/${tmdbType}/${tmdbId}/images`, apiKey, language, { include_image_language: 'en,null' })),
    tryFetchJson(tmdbUrl(`3/${tmdbType}/${tmdbId}/external_ids`, apiKey, language)),
  ]);
  if (!details) return null;

  const meta = await coreTmdbFullMetaToMeta(
    JSON.stringify(details), JSON.stringify(credits ?? {}), JSON.stringify(images ?? {}),
    JSON.stringify(externalIds ?? {}), type, language,
  ) as Record<string, unknown> | null;
  if (!meta) return null;

  if (type === 'series') {
    const seasons = ((details as { seasons?: TmdbSeasonSummary[] }).seasons ?? [])
      .map((s) => s.season_number)
      .filter((n): n is number => typeof n === 'number' && n > 0);
    const seriesId = String(meta.id ?? id);
    const videoLists = await mapWithConcurrency(seasons, 4, (seasonNumber) =>
      fetchBuiltinSeasonVideos(tmdbId, seasonNumber, seriesId, apiKey, language));
    meta.videos = videoLists.flat();
  }

  return { meta };
}

async function fetchBuiltinSeasonVideos(
  tmdbId: string, season: number, seriesId: string, apiKey: string, language: string,
): Promise<unknown[]> {
  const seasonData = await tryFetchJson(tmdbUrl(`3/tv/${tmdbId}/season/${season}`, apiKey, language));
  if (!seasonData) return [];
  return (await coreTmdbEpisodesToVideos(JSON.stringify(seasonData), seriesId)) ?? [];
}

export async function fetchBuiltinSeasonEpisodes(
  seriesId: string, season: number, apiKey: string, language: string,
): Promise<{ episodes: unknown[] }> {
  const tmdbId = await resolveTmdbId({ contentType: 'series', id: seriesId, language, apiKey });
  if (!tmdbId) return { episodes: [] };
  const videos = await fetchBuiltinSeasonVideos(tmdbId, season, seriesId, apiKey, language);
  return { episodes: videos };
}

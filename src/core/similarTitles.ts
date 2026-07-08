import { invoke } from '@tauri-apps/api/core';
import { _appVersion, platformFetch, tryFetchJson } from './httpClient';
import { coreParseVideoId } from './engine';
import { enrichWithAddonMeta } from './externalSyncUtils';
import type { Meta } from './types';

async function tryFetchJsonWithHeaders(url: string, headers: HeadersInit): Promise<unknown | null> {
  try {
    const res = await platformFetch(url, { headers });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

interface TraktIds {
  imdb?: string;
  tmdb?: number;
  slug?: string;
}

interface TraktRelatedItem {
  title?: string;
  year?: number;
  ids?: TraktIds;
}

function traktItemToPartialMeta(item: TraktRelatedItem, contentType: string): Record<string, unknown> | null {
  const id = item.ids?.imdb ?? (item.ids?.tmdb ? `tmdb:${item.ids.tmdb}` : undefined);
  if (!id || !item.title) return null;
  return {
    id,
    type: contentType,
    name: item.title,
    releaseInfo: item.year ? String(item.year) : undefined,
  };
}

// Trakt's docs list the :id path param as the resource's slug, and imdb ids are
// known to 404 on some shows even though they work for most — so we resolve the
// slug via /search first rather than passing the imdb id straight through.
export async function fetchTraktSimilarItems({ id, contentType }: { id: string; contentType: string }): Promise<Meta[]> {
  const parsed = await coreParseVideoId(id);
  if (!parsed.imdb) return [];
  const clientId = await invoke<string>('get_oauth_client_id', { service: 'trakt' }).catch(() => '');
  if (!clientId) return [];
  const headers: HeadersInit = {
    'trakt-api-version': '2',
    'trakt-api-key': clientId,
  };

  const wantType = contentType === 'series' ? 'show' : 'movie';
  const lookup = await tryFetchJsonWithHeaders(
    `https://api.trakt.tv/search/imdb/${encodeURIComponent(parsed.imdb)}?type=${wantType}`,
    headers,
  ) as Array<Record<string, unknown>> | null;
  const slug = Array.isArray(lookup)
    ? ((lookup[0]?.[wantType] as { ids?: TraktIds } | undefined)?.ids?.slug)
    : undefined;
  if (!slug) return [];

  const resource = wantType === 'show' ? 'shows' : 'movies';
  const data = await tryFetchJsonWithHeaders(
    `https://api.trakt.tv/${resource}/${encodeURIComponent(slug)}/related?limit=20`,
    headers,
  );
  if (!Array.isArray(data)) return [];

  const partial = data
    .map((item) => traktItemToPartialMeta(item as TraktRelatedItem, contentType))
    .filter((v): v is Record<string, unknown> => !!v);
  if (!partial.length) return [];
  // Trakt's own images must not be hotlinked ("must be cached... direct linking
  // will be blocked" per their docs), so posters/backgrounds still come from the
  // addon/TMDB enrichment pipeline rather than Trakt's images field.
  return (await enrichWithAddonMeta(partial)) as unknown as Meta[];
}

interface SimklRecommendation {
  title?: string;
  year?: number;
  poster?: string;
  type?: string;
  ids?: { simkl?: number };
}

function simklPosterUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return `https://wsrv.nl/?url=https://simkl.in/posters/${path}_c.webp&q=90`;
}

// Simkl has no dedicated "similar" endpoint - related titles come embedded in the
// movie/show detail response as `users_recommendations`, each carrying only a
// simkl id (no imdb/tmdb), so each item needs one more detail lookup to resolve
// a navigable imdb id.
export async function fetchSimklSimilarItems({ id, contentType }: { id: string; contentType: string }): Promise<Meta[]> {
  const parsed = await coreParseVideoId(id);
  if (!parsed.imdb) return [];
  const clientId = await invoke<string>('get_oauth_client_id', { service: 'simkl' }).catch(() => '');
  if (!clientId) return [];

  const simklQuery = `client_id=${encodeURIComponent(clientId)}&app-name=fluxa&app-version=${encodeURIComponent(_appVersion)}`;
  const wantType = contentType === 'series' ? 'tv' : 'movie';

  const lookup = await tryFetchJson(
    `https://api.simkl.com/search/id?imdb=${encodeURIComponent(parsed.imdb)}&${simklQuery}`,
  ) as Array<{ type?: string; ids?: { simkl?: number } }> | null;
  const found = Array.isArray(lookup) ? lookup.find((item) => item.type === wantType) : undefined;
  const simklId = found?.ids?.simkl;
  if (simklId == null) return [];

  const resource = wantType === 'tv' ? 'tv' : 'movies';
  const detail = await tryFetchJson(`https://api.simkl.com/${resource}/${simklId}?${simklQuery}`) as {
    users_recommendations?: SimklRecommendation[];
  } | null;
  const recs = (detail?.users_recommendations ?? []).slice(0, 15);
  if (!recs.length) return [];

  const CONCURRENCY = 4;
  const results: (Meta | null)[] = new Array(recs.length).fill(null);
  let cursor = 0;

  async function worker() {
    while (cursor < recs.length) {
      const i = cursor++;
      const rec = recs[i];
      const recSimklId = rec.ids?.simkl;
      if (recSimklId == null || !rec.title) continue;
      const recResource = rec.type === 'tv' ? 'tv' : 'movies';
      const recDetail = await tryFetchJson(`https://api.simkl.com/${recResource}/${recSimklId}?${simklQuery}`) as {
        ids?: { imdb?: string };
      } | null;
      const imdb = recDetail?.ids?.imdb;
      if (!imdb) continue;
      results[i] = {
        id: imdb,
        type: rec.type === 'tv' ? 'series' : 'movie',
        name: rec.title,
        poster: simklPosterUrl(rec.poster),
        releaseInfo: rec.year ? String(rec.year) : undefined,
      };
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, recs.length) }, worker));
  return results.filter((m): m is Meta => !!m);
}

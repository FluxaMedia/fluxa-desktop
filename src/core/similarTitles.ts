import { invoke } from '@tauri-apps/api/core';
import { _appVersion, tryFetchJson } from './httpClient';
import { coreParseVideoId } from './engine';
import { enrichWithAddonMeta } from './externalSyncUtils';
import type { Meta } from './types';

interface RelatedIds {
  imdb?: string;
  tmdb?: number;
  simkl?: number;
}

interface RelatedItem {
  title?: string;
  name?: string;
  year?: number;
  ids?: RelatedIds;
}

function relatedItemToPartialMeta(item: RelatedItem, contentType: string): Record<string, unknown> | null {
  const id = item.ids?.imdb ?? (item.ids?.tmdb ? `tmdb:${item.ids.tmdb}` : undefined);
  const name = item.title ?? item.name;
  if (!id || !name) return null;
  return {
    id,
    type: contentType,
    name,
    releaseInfo: item.year ? String(item.year) : undefined,
  };
}

async function toMetas(rawItems: unknown, contentType: string): Promise<Meta[]> {
  if (!Array.isArray(rawItems)) return [];
  const partial = rawItems
    .map((item) => relatedItemToPartialMeta(item as RelatedItem, contentType))
    .filter((v): v is Record<string, unknown> => !!v);
  if (!partial.length) return [];
  return (await enrichWithAddonMeta(partial)) as unknown as Meta[];
}

export async function fetchTraktSimilarItems({ id, contentType }: { id: string; contentType: string }): Promise<Meta[]> {
  const parsed = await coreParseVideoId(id);
  if (!parsed.imdb) return [];
  const clientId = await invoke<string>('get_oauth_client_id', { service: 'trakt' }).catch(() => '');
  if (!clientId) return [];

  const resource = contentType === 'series' ? 'shows' : 'movies';
  const data = await tryFetchJson(
    `https://api.trakt.tv/${resource}/${encodeURIComponent(parsed.imdb)}/related?limit=20`,
  ).catch(() => null);
  return toMetas(data, contentType);
}

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
  const data = await tryFetchJson(`https://api.simkl.com/${resource}/${simklId}/similar?${simklQuery}`).catch(() => null);
  return toMetas(data, contentType);
}

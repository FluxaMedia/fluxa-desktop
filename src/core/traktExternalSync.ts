import {
  coreBuildTraktIds,
  coreMergeExternalWatched,
  coreMergeExternalWatchlist,
  coreTraktMarkWatchedBody,
  coreTraktPlaybackItemsDedup,
  coreTraktPlaybackItemsToLibrary,
  coreTraktWatchlistToItems,
  coreTraktWatchedToIds,
} from './engine';
import { loadLibrary, saveLibrary, persistStatusListMerge, persistWatchedMerge } from './libraryOps';
import { platformFetch } from './httpClient';
import { traktHeaders } from './traktSync';
import { enrichWithAddonMeta, replaceExternalContinueWatching } from './externalSyncUtils';

async function fetchAllPages(url: string, headers: HeadersInit, limit: number): Promise<Record<string, unknown>[]> {
  const sep = url.includes('?') ? '&' : '?';
  const items: Record<string, unknown>[] = [];
  for (let page = 1; page <= 100; page++) {
    const res = await platformFetch(`${url}${sep}page=${page}&limit=${limit}`, { headers });
    if (!res.ok) break;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    items.push(...(data as Record<string, unknown>[]));
    const pageCount = Number(res.headers.get('x-pagination-page-count'));
    if (Number.isFinite(pageCount) && page >= pageCount) break;
    if (data.length < limit) break;
  }
  return items;
}

async function mergeExternalWatchlist(externalItems: Record<string, unknown>[]): Promise<void> {
  const lib = await loadLibrary();
  const local = (lib.watchlist as Record<string, unknown>[] | undefined) ?? [];
  const mergedJson = await coreMergeExternalWatchlist(JSON.stringify(local), JSON.stringify(externalItems));
  const mergedList = mergedJson as Record<string, unknown>[];
  if (mergedList.length > local.length) {
    lib.watchlist = mergedList;
    await persistStatusListMerge(local, mergedList, 'watchlist');
    await saveLibrary(lib);
  }
}

async function mergeExternalWatched(externalWatched: Record<string, boolean>): Promise<void> {
  const lib = await loadLibrary();
  const local = (lib.watched as Record<string, boolean> | undefined) ?? {};
  const merged = await coreMergeExternalWatched(JSON.stringify(local), JSON.stringify(externalWatched));
  lib.watched = merged;
  await persistWatchedMerge(local, merged);
  await saveLibrary(lib);
}

export async function syncTraktNow(payload: Record<string, unknown>): Promise<unknown> {
  const token = typeof payload.token === 'string' ? payload.token : undefined;
  const clientId = typeof payload.clientId === 'string' ? payload.clientId : '';
  if (!token) return { synced: false, error: 'Trakt is not connected' };

  const headers = traktHeaders(token, clientId);
  const response = await platformFetch('https://api.trakt.tv/sync/playback', { headers });
  if (!response.ok) {
    return { synced: false, error: `Trakt sync failed: HTTP ${response.status}` };
  }
  const playbackItems = await response.json();
  const allItems = Array.isArray(playbackItems)
    ? ((await coreTraktPlaybackItemsToLibrary(JSON.stringify(playbackItems))) ?? []) as Record<string, unknown>[]
    : [];

  const rawItems = ((await coreTraktPlaybackItemsDedup(JSON.stringify(allItems))) ?? []) as Record<string, unknown>[];

  const items = await enrichWithAddonMeta(rawItems);
  await replaceExternalContinueWatching({ items, provider: 'trakt' });
  const { promoteExternalProgress } = await import('./externalSync');
  await promoteExternalProgress(items, 'trakt', payload.profile as import('./types').UserProfile | null);

  let watchlistCount = 0;
  try {
    const [watchlistMovies, watchlistShows, watchedMovies, watchedShows] = await Promise.all([
      fetchAllPages('https://api.trakt.tv/users/me/watchlist/movies', headers, 250),
      fetchAllPages('https://api.trakt.tv/users/me/watchlist/shows', headers, 250),
      fetchAllPages('https://api.trakt.tv/users/me/watched/movies', headers, 250),
      fetchAllPages('https://api.trakt.tv/users/me/watched/shows?extended=progress', headers, 100),
    ]);

    const watchlistItems = ((await coreTraktWatchlistToItems(JSON.stringify(watchlistMovies), JSON.stringify(watchlistShows))) ?? []) as Record<string, unknown>[];
    watchlistCount = watchlistItems.length;
    await mergeExternalWatchlist(watchlistItems);

    const watchedIds = ((await coreTraktWatchedToIds(JSON.stringify(watchedMovies), JSON.stringify(watchedShows))) ?? {}) as Record<string, boolean>;
    await mergeExternalWatched(watchedIds);
  } catch {}

  return { synced: true, provider: 'trakt', continueWatchingCount: items.length, watchlistCount };
}

export async function fetchTraktCalendarItems(token: string, clientId: string): Promise<Record<string, unknown>[]> {
  const headers = traktHeaders(token, clientId);
  const start = new Date();
  start.setDate(start.getDate() - 14);
  const startIso = start.toISOString().slice(0, 10);
  const days = 90;

  const [shows, movies] = await Promise.all([
    platformFetch(`https://api.trakt.tv/calendars/my/shows/${startIso}/${days}`, { headers })
      .then((res) => (res.ok ? res.json() : [])).catch(() => []),
    platformFetch(`https://api.trakt.tv/calendars/my/movies/${startIso}/${days}`, { headers })
      .then((res) => (res.ok ? res.json() : [])).catch(() => []),
  ]);

  const showItems = (Array.isArray(shows) ? shows : []).map((raw) => {
    const entry = raw as Record<string, unknown>;
    const episode = entry.episode as Record<string, unknown> | undefined;
    const show = entry.show as Record<string, unknown> | undefined;
    const ids = show?.ids as Record<string, unknown> | undefined;
    const imdb = typeof ids?.imdb === 'string' ? ids.imdb : undefined;
    const tmdb = ids?.tmdb != null ? `tmdb:${ids.tmdb}` : undefined;
    const seriesId = imdb ?? tmdb;
    const dateIso = typeof entry.first_aired === 'string' ? entry.first_aired : undefined;
    if (!seriesId || !dateIso) return null;
    return {
      id: `${seriesId}:${episode?.season}:${episode?.number}`,
      title: show?.title,
      episodeTitle: episode?.title,
      dateIso,
      contentId: seriesId,
      seriesId,
    } as Record<string, unknown>;
  }).filter((item): item is Record<string, unknown> => item !== null);

  const movieItems = (Array.isArray(movies) ? movies : []).map((raw) => {
    const entry = raw as Record<string, unknown>;
    const movie = entry.movie as Record<string, unknown> | undefined;
    const ids = movie?.ids as Record<string, unknown> | undefined;
    const imdb = typeof ids?.imdb === 'string' ? ids.imdb : undefined;
    const tmdb = ids?.tmdb != null ? `tmdb:${ids.tmdb}` : undefined;
    const contentId = imdb ?? tmdb;
    const dateIso = typeof entry.released === 'string' ? entry.released : undefined;
    if (!contentId || !dateIso) return null;
    return {
      id: contentId,
      title: movie?.title,
      dateIso,
      contentId,
    } as Record<string, unknown>;
  }).filter((item): item is Record<string, unknown> => item !== null);

  return [...showItems, ...movieItems];
}

export async function pushMarkWatchedTrakt(
  videoIds: string[],
  watched: boolean,
  token: string,
  clientId: string,
): Promise<void> {
  const body = await coreTraktMarkWatchedBody(JSON.stringify(videoIds));
  if (!body) return;
  const headers = traktHeaders(token, clientId);
  const endpoint = watched ? '/sync/history' : '/sync/history/remove';
  await platformFetch(`https://api.trakt.tv${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

export async function pushWatchlistTrakt(
  id: string,
  contentType: string,
  command: 'add' | 'remove',
  token: string,
  clientId: string,
): Promise<void> {
  const headers = traktHeaders(token, clientId);
  const ids = await coreBuildTraktIds(id);
  if (!ids) return;
  const endpoint = command === 'add' ? '/sync/watchlist' : '/sync/watchlist/remove';
  const body = contentType === 'series' ? { shows: [{ ids }] } : { movies: [{ ids }] };
  await platformFetch(`https://api.trakt.tv${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

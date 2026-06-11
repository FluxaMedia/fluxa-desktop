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
import { loadLibrary, saveLibrary } from './libraryOps';
import { platformFetch } from './httpClient';
import { traktHeaders } from './traktSync';
import { enrichWithAddonMeta, replaceExternalContinueWatching } from './externalSyncUtils';

async function mergeExternalWatchlist(externalItems: Record<string, unknown>[]): Promise<void> {
  const lib = await loadLibrary();
  const local = (lib.watchlist as Record<string, unknown>[] | undefined) ?? [];
  const mergedJson = await coreMergeExternalWatchlist(JSON.stringify(local), JSON.stringify(externalItems));
  const mergedList = mergedJson as Record<string, unknown>[];
  if (mergedList.length > local.length) {
    lib.watchlist = mergedList;
    await saveLibrary(lib);
  }
}

async function mergeExternalWatched(externalWatched: Record<string, boolean>): Promise<void> {
  const lib = await loadLibrary();
  const local = (lib.watched as Record<string, boolean> | undefined) ?? {};
  const merged = await coreMergeExternalWatched(JSON.stringify(local), JSON.stringify(externalWatched));
  lib.watched = merged;
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

  let watchlistCount = 0;
  try {
    const [watchlistMoviesRes, watchlistShowsRes, watchedMoviesRes, watchedShowsRes] = await Promise.all([
      platformFetch('https://api.trakt.tv/users/me/watchlist/movies?limit=500', { headers }),
      platformFetch('https://api.trakt.tv/users/me/watchlist/shows?limit=500', { headers }),
      platformFetch('https://api.trakt.tv/users/me/watched/movies', { headers }),
      platformFetch('https://api.trakt.tv/users/me/watched/shows?extended=episodes', { headers }),
    ]);

    const wlMoviesData = watchlistMoviesRes.ok ? JSON.stringify(await watchlistMoviesRes.json()) : '[]';
    const wlShowsData = watchlistShowsRes.ok ? JSON.stringify(await watchlistShowsRes.json()) : '[]';
    const watchlistItems = ((await coreTraktWatchlistToItems(wlMoviesData, wlShowsData)) ?? []) as Record<string, unknown>[];
    watchlistCount = watchlistItems.length;
    await mergeExternalWatchlist(watchlistItems);

    const watchedMoviesData = watchedMoviesRes.ok ? JSON.stringify(await watchedMoviesRes.json()) : '[]';
    const watchedShowsData = watchedShowsRes.ok ? JSON.stringify(await watchedShowsRes.json()) : '[]';
    const watchedIds = ((await coreTraktWatchedToIds(watchedMoviesData, watchedShowsData)) ?? {}) as Record<string, boolean>;
    await mergeExternalWatched(watchedIds);
  } catch {}

  return { synced: true, provider: 'trakt', continueWatchingCount: items.length, watchlistCount };
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

import {
  coreMergeExternalWatched,
  coreMergeExternalWatchlist,
  coreInvoke,
  coreSimklWatchedToIds,
  coreSimklWatchingToItems,
  coreSimklWatchlistToItems,
} from './engine';
import { loadLibrary, saveLibrary, persistStatusListMerge, persistWatchedMerge } from './libraryOps';
import { platformFetch } from './httpClient';
import { enrichWithAddonMeta, replaceExternalContinueWatching } from './externalSyncUtils';

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

export async function syncSimklNow(payload: Record<string, unknown>): Promise<unknown> {
  const token = typeof payload.token === 'string' ? payload.token : undefined;
  const clientId = typeof payload.clientId === 'string' && payload.clientId ? payload.clientId : '';
  if (!token) return { synced: false, error: 'Simkl is not connected' };

  const headers: HeadersInit = {
    'Authorization': `Bearer ${token}`,
    'simkl-api-key': clientId,
    'Content-Type': 'application/json',
  };

  const syncSignal = () => AbortSignal.timeout(60_000);
  const [showsRes, moviesRes, wlShowsRes, wlMoviesRes, doneShowsRes, doneMoviesRes] = await Promise.all([
    platformFetch('https://api.simkl.com/sync/all-items/shows/watching?extended=full', { headers, signal: syncSignal() }),
    platformFetch('https://api.simkl.com/sync/all-items/movies/watching?extended=full', { headers, signal: syncSignal() }),
    platformFetch('https://api.simkl.com/sync/all-items/shows/plantowatch?extended=full', { headers, signal: syncSignal() }),
    platformFetch('https://api.simkl.com/sync/all-items/movies/plantowatch?extended=full', { headers, signal: syncSignal() }),
    platformFetch('https://api.simkl.com/sync/all-items/shows/completed?extended=full', { headers, signal: syncSignal() }),
    platformFetch('https://api.simkl.com/sync/all-items/movies/completed?extended=full', { headers, signal: syncSignal() }),
  ]);

  const showsData = showsRes.ok ? JSON.stringify(await showsRes.json()) : '[]';
  const moviesData = moviesRes.ok ? JSON.stringify(await moviesRes.json()) : '[]';
  const rawItems = ((await coreSimklWatchingToItems(showsData, moviesData)) ?? []) as Record<string, unknown>[];
  const items = await enrichWithAddonMeta(rawItems);
  await replaceExternalContinueWatching({ items, provider: 'simkl' });
  const { promoteExternalProgress } = await import('./externalSync');
  await promoteExternalProgress(items, 'simkl', payload.profile as import('./types').UserProfile | null);

  try {
    const wlShowsData = wlShowsRes.ok ? JSON.stringify(await wlShowsRes.json()) : '[]';
    const wlMoviesData = wlMoviesRes.ok ? JSON.stringify(await wlMoviesRes.json()) : '[]';
    const watchlistItems = ((await coreSimklWatchlistToItems(wlShowsData, wlMoviesData)) ?? []) as Record<string, unknown>[];
    await mergeExternalWatchlist(watchlistItems);
  } catch {}

  try {
    const doneShowsData = doneShowsRes.ok ? JSON.stringify(await doneShowsRes.json()) : '[]';
    const doneMoviesData = doneMoviesRes.ok ? JSON.stringify(await doneMoviesRes.json()) : '[]';
    const watchedMap = ((await coreSimklWatchedToIds(doneShowsData, doneMoviesData)) ?? {}) as Record<string, boolean>;
    await mergeExternalWatched(watchedMap);
  } catch {}

  return { synced: true, provider: 'simkl', continueWatchingCount: items.length, watchlistCount: 0 };
}

export async function fetchSimklCalendarItems(token: string, clientId: string): Promise<Record<string, unknown>[]> {
  const headers: HeadersInit = {
    'Authorization': `Bearer ${token}`,
    'simkl-api-key': clientId,
    'Content-Type': 'application/json',
  };
  const start = new Date();
  start.setDate(start.getDate() - 14);
  const startIso = start.toISOString().slice(0, 10);
  const days = 90;

  const [shows, movies] = await Promise.all([
    platformFetch(`https://api.simkl.com/calendar/shows/${startIso}/${days}?extended=full`, { headers })
      .then((res) => (res.ok ? res.json() : [])).catch(() => []),
    platformFetch(`https://api.simkl.com/calendar/movies/${startIso}/${days}?extended=full`, { headers })
      .then((res) => (res.ok ? res.json() : [])).catch(() => []),
  ]);

  return (await coreInvoke<Record<string, unknown>[]>('providerCalendarItems', JSON.stringify({ provider: 'simkl', shows, movies }))) ?? [];
}

export async function pushMarkWatchedSimkl(
  videoIds: string[],
  watched: boolean,
  meta: Record<string, unknown> | undefined,
  token: string,
  clientId: string,
): Promise<void> {
  const simklHeaders: HeadersInit = {
    'Authorization': `Bearer ${token}`,
    'simkl-api-key': clientId,
    'Content-Type': 'application/json',
  };
  const endpoint = watched ? '/sync/history' : '/sync/history/remove';
  const body = await coreInvoke<Record<string, unknown>>('simklMarkWatchedBody', JSON.stringify({ videoIds, meta }));
  if (body) {
    await platformFetch(`https://api.simkl.com${endpoint}?client_id=${encodeURIComponent(clientId)}`, {
      method: 'POST', headers: simklHeaders, body: JSON.stringify(body),
    });
  }
}

export async function pushWatchlistSimkl(
  id: string,
  contentType: string,
  token: string,
  clientId: string,
): Promise<void> {
  const simklHeaders: HeadersInit = {
    'Authorization': `Bearer ${token}`,
    'simkl-api-key': clientId,
    'Content-Type': 'application/json',
  };
  const body = await coreInvoke<Record<string, unknown>>('simklWatchlistBody', JSON.stringify({ id, contentType }));
  if (!body) return;
  await platformFetch(`https://api.simkl.com/sync/add-to-list?client_id=${encodeURIComponent(clientId)}`, {
    method: 'POST', headers: simklHeaders, body: JSON.stringify(body),
  });
}

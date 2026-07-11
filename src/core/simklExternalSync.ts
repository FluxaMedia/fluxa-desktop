import {
  coreMergeExternalWatched,
  coreMergeExternalWatchlist,
  coreParseVideoId,
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

  const [showsRes, moviesRes, wlShowsRes, wlMoviesRes, doneShowsRes, doneMoviesRes] = await Promise.all([
    platformFetch('https://api.simkl.com/sync/all-items/shows/watching?extended=full', { headers }),
    platformFetch('https://api.simkl.com/sync/all-items/movies/watching?extended=full', { headers }),
    platformFetch('https://api.simkl.com/sync/all-items/shows/plantowatch?extended=full', { headers }),
    platformFetch('https://api.simkl.com/sync/all-items/movies/plantowatch?extended=full', { headers }),
    platformFetch('https://api.simkl.com/sync/all-items/shows/completed?extended=full', { headers }),
    platformFetch('https://api.simkl.com/sync/all-items/movies/completed?extended=full', { headers }),
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

  const showItems = (Array.isArray(shows) ? shows : []).map((raw) => {
    const entry = raw as Record<string, unknown>;
    const episode = entry.episode as Record<string, unknown> | undefined;
    const show = entry.show as Record<string, unknown> | undefined;
    const ids = show?.ids as Record<string, unknown> | undefined;
    const imdb = typeof ids?.imdb === 'string' ? ids.imdb : undefined;
    const tmdb = ids?.tmdb != null ? `tmdb:${ids.tmdb}` : undefined;
    const seriesId = imdb ?? tmdb;
    const dateIso = typeof entry.date === 'string' ? entry.date : undefined;
    if (!seriesId || !dateIso) return null;
    return {
      id: `${seriesId}:${episode?.season}:${episode?.episode}`,
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
    const dateIso = typeof entry.date === 'string' ? entry.date : undefined;
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
  const moviePayloads: Record<string, unknown>[] = [];
  const showPayloads: Map<string, Record<string, unknown>> = new Map();

  for (const vid of videoIds) {
    const parsed = await coreParseVideoId(vid);
    if (!parsed.imdb && !parsed.tmdb) continue;
    const ids: Record<string, unknown> = parsed.imdb ? { imdb: parsed.imdb } : { tmdb: parsed.tmdb };
    if (parsed.isEpisode) {
      const showId = String(parsed.imdb ?? parsed.tmdb ?? '');
      if (!showPayloads.has(showId)) showPayloads.set(showId, { ids, seasons: [] });
      const showEntry = showPayloads.get(showId)!;
      const seasons = showEntry.seasons as Record<string, unknown>[];
      let seasonEntry = seasons.find((s) => s.number === parsed.season);
      if (!seasonEntry) { seasonEntry = { number: parsed.season, episodes: [] }; seasons.push(seasonEntry); }
      (seasonEntry.episodes as Record<string, unknown>[]).push({ number: parsed.episode });
    } else {
      const contentType = (meta?.type ?? 'movie') === 'series' ? 'shows' : 'movies';
      if (contentType === 'movies') {
        moviePayloads.push({ ids, watched_at: 'now' });
      } else {
        showPayloads.set(String(parsed.imdb ?? parsed.tmdb ?? ''), { ids });
      }
    }
  }

  if (moviePayloads.length > 0 || showPayloads.size > 0) {
    const body: Record<string, unknown> = {};
    if (moviePayloads.length > 0) body.movies = moviePayloads;
    if (showPayloads.size > 0) body.shows = [...showPayloads.values()];
    await platformFetch(`https://api.simkl.com${endpoint}?client_id=${encodeURIComponent(clientId)}`, {
      method: 'POST', headers: simklHeaders, body: JSON.stringify(body),
    });
  }
}

export async function pushWatchlistSimkl(
  id: string,
  contentType: string,
  parsed: { imdb?: string; tmdb?: string },
  token: string,
  clientId: string,
): Promise<void> {
  const simklHeaders: HeadersInit = {
    'Authorization': `Bearer ${token}`,
    'simkl-api-key': clientId,
    'Content-Type': 'application/json',
  };
  const ids: Record<string, unknown> = parsed.imdb ? { imdb: parsed.imdb } : parsed.tmdb ? { tmdb: parsed.tmdb } : {};
  if (Object.keys(ids).length === 0) return;
  const body = contentType === 'series'
    ? { shows: [{ ids, to: 'plantowatch' }] }
    : { movies: [{ ids, to: 'plantowatch' }] };
  await platformFetch(`https://api.simkl.com/sync/add-to-list?client_id=${encodeURIComponent(clientId)}`, {
    method: 'POST', headers: simklHeaders, body: JSON.stringify(body),
  });
}

import {
  coreLibraryContinueWatchingItems,
  coreMergeExternalWatched,
  coreMergeExternalWatchlist,
  coreStremioWatchedToIds,
  coreStremioWatchlistToItems,
} from './engine';
import { loadLibrary, saveLibrary } from './libraryOps';
import { stremioPullLibrary } from './stremioApi';
import { enrichWithAddonMeta, replaceExternalContinueWatching } from './externalSyncUtils';

async function mergeExternalWatchlist(externalItems: Record<string, unknown>[]): Promise<number> {
  const lib = await loadLibrary();
  const local = (lib.watchlist as Record<string, unknown>[] | undefined) ?? [];
  const merged = await coreMergeExternalWatchlist(JSON.stringify(local), JSON.stringify(externalItems));
  if (merged.length > local.length) {
    lib.watchlist = merged;
    await saveLibrary(lib);
  }
  return externalItems.length;
}

async function mergeExternalWatched(externalWatched: Record<string, boolean>): Promise<void> {
  const lib = await loadLibrary();
  const local = (lib.watched as Record<string, boolean> | undefined) ?? {};
  const merged = await coreMergeExternalWatched(JSON.stringify(local), JSON.stringify(externalWatched));
  lib.watched = merged;
  await saveLibrary(lib);
}

export async function syncStremioNow(payload: Record<string, unknown>): Promise<unknown> {
  const authKey = typeof payload.token === 'string' ? payload.token : undefined;
  if (!authKey) return { synced: false, error: 'Stremio is not connected' };

  let libraryItems: Record<string, unknown>[];
  try {
    libraryItems = await stremioPullLibrary(authKey);
  } catch (err) {
    return { synced: false, error: err instanceof Error ? err.message : String(err) };
  }

  const rawItems = ((await coreLibraryContinueWatchingItems(libraryItems)) ?? []) as Record<string, unknown>[];
  const items = await enrichWithAddonMeta(rawItems);
  await replaceExternalContinueWatching({ items, provider: 'stremio' });

  let watchlistCount = 0;
  try {
    const watchlistItems = ((await coreStremioWatchlistToItems(libraryItems)) ?? []) as Record<string, unknown>[];
    watchlistCount = await mergeExternalWatchlist(watchlistItems);
  } catch {}

  try {
    const watchedIds = ((await coreStremioWatchedToIds(libraryItems)) ?? {}) as Record<string, boolean>;
    await mergeExternalWatched(watchedIds);
  } catch {}

  return { synced: true, provider: 'stremio', continueWatchingCount: items.length, watchlistCount };
}

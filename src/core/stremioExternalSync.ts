import {
  coreLibraryContinueWatchingItems,
  coreMergeExternalWatched,
  coreMergeExternalWatchlist,
  coreStremioWatchedToIds,
  coreStremioWatchlistToItems,
} from './engine';
import { loadLibrary, saveAddons, saveLibrary, persistStatusListMerge, persistWatchedMerge } from './libraryOps';
import { stremioPullAddons, stremioPullLibrary, stremioPushLibrary, stremioReplaceAddons } from './stremioApi';
import { normalizeAddonDescriptor } from './addons';
import { enrichWithAddonMeta, replaceExternalContinueWatching } from './externalSyncUtils';
import type { AddonDescriptor, UserProfile } from './types';

type WatchedEpisode = {
  contentId: string;
  contentType: string;
  videoId?: string;
  season?: number;
  episode?: number;
  title?: string;
};

type PlaybackProgress = {
  contentId: string;
  contentType: string;
  videoId: string;
  positionSeconds: number;
  durationSeconds: number;
  lastWatched: number;
  season?: number;
  episode?: number;
};

function stremioTimestamp(value: number): string {
  return new Date(Number.isFinite(value) ? value : Date.now()).toISOString();
}

function libraryItem(
  meta: Record<string, unknown>,
  state: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> | null {
  const id = String(meta.id ?? '');
  if (!id) return null;
  return {
    _id: id,
    name: String(meta.name ?? ''),
    type: String(meta.type ?? 'movie'),
    poster: meta.poster ?? null,
    background: meta.background ?? null,
    logo: meta.logo ?? null,
    state,
    ...extra,
  };
}

export async function pushStremioWatchlist(
  item: Record<string, unknown>,
  command: 'add' | 'remove',
  profile: UserProfile | null,
): Promise<void> {
  const authKey = profile?.stremioAuthKey;
  if (!authKey) return;
  const change = libraryItem(item, {
    lastWatched: null,
    timeOffset: 0,
    duration: 0,
    videoId: null,
    timesWatched: 0,
    flaggedWatched: 0,
  }, command === 'remove' ? { removed: 1 } : { removed: 0 });
  if (change) await stremioPushLibrary(authKey, [change]);
}

export async function pushStremioPlaybackProgress(
  meta: Record<string, unknown>,
  progress: PlaybackProgress,
  profile: UserProfile | null,
): Promise<void> {
  const authKey = profile?.stremioAuthKey;
  if (!authKey || progress.durationSeconds <= 0) return;
  const change = libraryItem(meta, {
    lastWatched: stremioTimestamp(progress.lastWatched),
    timeOffset: Math.max(0, Math.round(progress.positionSeconds)),
    duration: Math.max(0, Math.round(progress.durationSeconds)),
    videoId: progress.videoId,
  });
  if (change) await stremioPushLibrary(authKey, [change]);
}

export async function pushStremioWatched(
  meta: Record<string, unknown> | undefined,
  watched: boolean,
  episodes: WatchedEpisode[],
  profile: UserProfile | null,
): Promise<void> {
  const authKey = profile?.stremioAuthKey;
  if (!authKey) return;
  const watchedAt = watched ? stremioTimestamp(Date.now()) : null;
  const changes = episodes.length > 0
    ? episodes.map((episode) => {
        const videoId = episode.videoId || `${episode.contentId}:${episode.season ?? 0}:${episode.episode ?? 0}`;
        return {
          _id: videoId,
          name: episode.title ?? String(meta?.name ?? ''),
          type: episode.contentType,
          poster: meta?.poster ?? null,
          background: meta?.background ?? null,
          logo: meta?.logo ?? null,
          state: {
            lastWatched: watchedAt,
            timeOffset: 0,
            duration: 0,
            videoId,
            timesWatched: watched ? 1 : 0,
            flaggedWatched: watched ? 1 : 0,
          },
          lastWatched: watchedAt,
        };
      })
    : (() => {
        const change = meta ? libraryItem(meta, {
          lastWatched: watchedAt,
          timeOffset: 0,
          duration: 0,
          videoId: null,
          timesWatched: watched ? 1 : 0,
          flaggedWatched: watched ? 1 : 0,
        }, { lastWatched: watchedAt }) : null;
        return change ? [change] : [];
      })();
  await stremioPushLibrary(authKey, changes);
}

export async function syncStremioAddons(profile: UserProfile, addons: AddonDescriptor[]): Promise<void> {
  if (!profile.stremioAuthKey) return;
  await stremioReplaceAddons(profile.stremioAuthKey, addons);
}

async function mergeExternalWatchlist(externalItems: Record<string, unknown>[]): Promise<number> {
  const lib = await loadLibrary();
  const local = (lib.watchlist as Record<string, unknown>[] | undefined) ?? [];
  const merged = await coreMergeExternalWatchlist(JSON.stringify(local), JSON.stringify(externalItems));
  if (merged.length > local.length) {
    lib.watchlist = merged;
    await persistStatusListMerge(local, merged, 'watchlist');
    await saveLibrary(lib);
  }
  return externalItems.length;
}

async function mergeExternalWatched(externalWatched: Record<string, boolean>): Promise<void> {
  const lib = await loadLibrary();
  const local = (lib.watched as Record<string, boolean> | undefined) ?? {};
  const merged = await coreMergeExternalWatched(JSON.stringify(local), JSON.stringify(externalWatched));
  lib.watched = merged;
  await persistWatchedMerge(local, merged);
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

  let addonCount = 0;
  try {
    const addons = await stremioPullAddons(authKey);
    await saveAddons(await Promise.all(addons.map(normalizeAddonDescriptor)));
    addonCount = addons.length;
  } catch {}

  return { synced: true, provider: 'stremio', continueWatchingCount: items.length, watchlistCount, addonCount };
}

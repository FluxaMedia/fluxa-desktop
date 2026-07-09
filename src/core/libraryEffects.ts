import {
  coreCalendarItemsFromMeta,
  coreLibraryApplyMarkWatched,
  coreLibraryLocalStatePlan,
  coreMergeProgressMeta,
  coreNextUnairedEpisode,
  corePlaybackProgressMergePlan,
  coreWatchlistTogglePlan,
  storageRead,
  storageWrite,
} from './engine';
import { buildContinueWatching, loadActiveProfile, loadAddons, loadLibrary, saveLibrary } from './libraryOps';
import { pushLibraryStatusExternal, pushMarkWatchedExternal, pushPlaybackProgressExternal, pushWatchlistExternal, type WatchedEpisodeInfo, type WatchProgressInfo } from './externalSync';
import { fetchVideosForSeries, runWithConcurrency } from './fetchPlanning';
import { notify } from './notifications';
import { t } from '../i18n';
import type { LibraryItem } from './types';

const calendarCache = new Map<string, unknown>();

export function invalidateCalendarCache() {
  calendarCache.clear();
}

const AIR_DATE_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const AIR_DATE_REFRESH_CONCURRENCY = 3;

function isDueForAirDateCheck(item: LibraryItem, nowMs: number): boolean {
  if (item.type !== 'series') return false;
  const nextAirMs = item.nextEpisodeAirDate ? new Date(item.nextEpisodeAirDate).getTime() : NaN;
  const isMissingOrPast = !item.nextEpisodeAirDate || Number.isNaN(nextAirMs) || nextAirMs <= nowMs;
  if (!isMissingOrPast) return false;
  const lastCheckedMs = item.lastAirDateCheckedAt ? new Date(item.lastAirDateCheckedAt).getTime() : 0;
  return Number.isNaN(lastCheckedMs) || nowMs - lastCheckedMs >= AIR_DATE_COOLDOWN_MS;
}

export async function refreshWatchlistAirDates(): Promise<void> {
  const lib = await loadLibrary();
  const nowMs = Date.now();
  const watchlist = (lib.watchlist as LibraryItem[] | undefined) ?? [];
  const continueWatching = (lib.continueWatching as LibraryItem[] | undefined) ?? [];

  const byId = new Map<string, LibraryItem>();
  for (const item of [...watchlist, ...continueWatching]) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  const candidates = [...byId.values()].filter((item) => isDueForAirDateCheck(item, nowMs));
  if (candidates.length === 0) return;

  const addons = await loadAddons();
  const nowIso = new Date(nowMs).toISOString();

  const updates = await runWithConcurrency(candidates, AIR_DATE_REFRESH_CONCURRENCY, async (item) => {
    const videos = await fetchVideosForSeries(item.id, addons);
    const next = videos.length ? await coreNextUnairedEpisode(JSON.stringify(videos), nowMs) : null;
    return { id: item.id, nextEpisodeAirDate: next?.released, lastAirDateCheckedAt: nowIso };
  });

  const updatesById = new Map(updates.map((update) => [update.id, update]));
  const applyUpdate = (item: LibraryItem): LibraryItem => {
    const update = updatesById.get(item.id);
    return update
      ? { ...item, nextEpisodeAirDate: update.nextEpisodeAirDate, lastAirDateCheckedAt: update.lastAirDateCheckedAt }
      : item;
  };
  lib.watchlist = watchlist.map(applyUpdate);
  lib.continueWatching = continueWatching.map(applyUpdate);

  await saveLibrary(lib);
  invalidateCalendarCache();
}

const NOTIFIED_EPISODES_KEY = 'notified_released_episode_ids';
const NOTIFIED_EPISODES_LIMIT = 500;

function episodeOrderKey(ep: { season?: number; episode?: number; number?: number }): number {
  return (Number(ep.season ?? 1) * 10000) + Number(ep.episode ?? ep.number ?? 0);
}

async function deriveNextProgressInfo(
  seriesId: string | undefined,
  contentType: string,
  watchedEpisodes: Array<{ season?: number; episode?: number; number?: number }>,
): Promise<WatchProgressInfo | undefined> {
  if (!seriesId || watchedEpisodes.length === 0) return undefined;
  const lastWatchedOrder = Math.max(...watchedEpisodes.map(episodeOrderKey));
  if (!Number.isFinite(lastWatchedOrder)) return undefined;
  const addons = await loadAddons();
  const videos = await fetchVideosForSeries(seriesId, addons);
  const now = Date.now();
  const next = videos
    .filter((ep) => {
      if (episodeOrderKey(ep) <= lastWatchedOrder) return false;
      if (ep.released && new Date(ep.released).getTime() > now) return false;
      return true;
    })
    .sort((a, b) => episodeOrderKey(a) - episodeOrderKey(b))[0];
  if (!next?.id) return undefined;
  return {
    contentId: seriesId,
    contentType,
    videoId: next.id,
    positionSeconds: 1,
    durationSeconds: 99999,
    lastWatched: Date.now(),
    season: next.season,
    episode: next.episode ?? next.number,
  };
}

export async function notifyReleasedEpisodes(payload: Record<string, unknown>): Promise<void> {
  const items = (payload.items as Array<Record<string, unknown>> | undefined) ?? [];
  const todayIso = new Date().toISOString().slice(0, 10);
  const dueItems = items.filter((item) => (item.dateIso as string | undefined)?.slice(0, 10) === todayIso);
  if (dueItems.length === 0) return;

  const notifiedIds = new Set((await storageRead<string[]>(NOTIFIED_EPISODES_KEY)) ?? []);
  const freshItems = dueItems.filter((item) => item.id && !notifiedIds.has(item.id as string));
  if (freshItems.length === 0) return;

  for (const item of freshItems) {
    const body = (item.episodeTitle as string | undefined) ?? (item.subtitle as string | undefined);
    void notify(t('notifications.new_episode_title', item.title as string), body);
    notifiedIds.add(item.id as string);
  }
  const trimmed = [...notifiedIds].slice(-NOTIFIED_EPISODES_LIMIT);
  await storageWrite(NOTIFIED_EPISODES_KEY, trimmed);
}

export async function applyLibraryCommand(payload: Record<string, unknown>): Promise<unknown> {
  const lib = await loadLibrary();
  const command = payload.command as {
    type: string;
    item?: unknown;
    meta?: unknown;
    list?: string;
    watched?: boolean;
    videoIds?: string[];
    episodes?: Array<{ id?: string; name?: string; title?: string; season?: number; episode?: number; number?: number }>;
    seriesId?: string;
  } | undefined;
  if (!command) return lib;

  if (command.type === 'toggleLibraryStatus' && command.item && (command.list === 'dropped' || command.list === 'completed')) {
    const item = command.item as LibraryItem;
    const list = lib[command.list] as LibraryItem[] | undefined ?? [];
    const idx = list.findIndex((i) => i.id === item.id);
    const plan = await coreWatchlistTogglePlan({
      item: command.item,
      isCurrentlyInWatchlist: idx >= 0,
      profileId: payload.profileId,
    }) as { command?: 'add' | 'remove' } | null;
    const nextCommand = plan?.command ?? (idx >= 0 ? 'remove' : 'add');
    const stampedItem = { ...item, statusChangedAt: new Date().toISOString() };
    lib[command.list] = nextCommand === 'remove' ? list.filter((_, i) => i !== idx) : [stampedItem, ...list];
    if (nextCommand === 'add') {
      const watchlist = (lib.watchlist as LibraryItem[] | undefined) ?? [];
      lib.watchlist = watchlist.filter((i) => i.id !== item.id);
      const otherList = command.list === 'dropped' ? 'completed' : 'dropped';
      lib[otherList] = ((lib[otherList] as LibraryItem[] | undefined) ?? []).filter((i) => i.id !== item.id);
      const progressMap = (lib.progress as Record<string, unknown> | undefined) ?? {};
      delete progressMap[item.id];
      lib.progress = progressMap;
      lib.continueWatching = await buildContinueWatching(progressMap);
    }
    void loadActiveProfile().then((profile) =>
      pushLibraryStatusExternal(command.item as Record<string, unknown>, command.list!, nextCommand, profile)
    );
    await saveLibrary(lib);
    invalidateCalendarCache();
    return lib;
  }

  if (command.type === 'toggleWatchlist' && command.item) {
    const item = command.item as { id: string };
    const watchlist = (lib.watchlist as LibraryItem[] | undefined) ?? [];
    const idx = watchlist.findIndex((i) => i.id === item.id);
    const plan = await coreWatchlistTogglePlan({
      item: command.item,
      isCurrentlyInWatchlist: idx >= 0,
      profileId: payload.profileId,
    }) as { command?: 'add' | 'remove' } | null;
    const nextCommand = plan?.command ?? (idx >= 0 ? 'remove' : 'add');
    if (nextCommand === 'remove') {
      lib.watchlist = watchlist.filter((_, i) => i !== idx);
    } else {
      lib.watchlist = [command.item as LibraryItem, ...watchlist];
      lib.dropped = ((lib.dropped as LibraryItem[] | undefined) ?? []).filter((i) => i.id !== item.id);
      lib.completed = ((lib.completed as LibraryItem[] | undefined) ?? []).filter((i) => i.id !== item.id);
    }
    // Fire-and-forget push to external services
    void loadActiveProfile().then((profile) =>
      pushWatchlistExternal(command.item as Record<string, unknown>, nextCommand, profile)
    );
  }

  if (command.type === 'markWatched' && command.videoIds) {
    const watched = (lib.watched as Record<string, boolean> | undefined) ?? {};
    for (const vid of command.videoIds) {
      watched[vid] = command.watched !== false;
    }
    lib.watched = watched;

    const seriesId = command.seriesId;
    const progressBeforeUpdate = seriesId
      ? ((lib.progress as Record<string, unknown> | undefined) ?? {})[seriesId] as Record<string, unknown> | undefined
      : undefined;
    const itemMeta = (command.item as Record<string, unknown> | undefined)
      ?? (command.meta as Record<string, unknown> | undefined);
    const contentType = String(itemMeta?.type ?? (progressBeforeUpdate?.meta as Record<string, unknown> | undefined)?.type ?? 'series');
    const episodeInfos: WatchedEpisodeInfo[] = seriesId
      ? (command.episodes ?? [])
        .map((ep, index) => ({
          contentId: seriesId,
          contentType,
          videoId: ep.id,
          season: ep.season,
          episode: ep.episode ?? ep.number,
          title: ep.name ?? ep.title ?? String(command.videoIds?.[index] ?? ''),
        }))
        .filter((ep) => ep.season != null && ep.episode != null)
      : [];
    const progressEpisodeInfo: WatchedEpisodeInfo | undefined = progressBeforeUpdate && seriesId ? {
      contentId: seriesId,
      contentType: String((progressBeforeUpdate.meta as Record<string, unknown> | undefined)?.type ?? 'series'),
      season: progressBeforeUpdate.lastEpisodeSeason as number | undefined,
      episode: progressBeforeUpdate.lastEpisodeNumber as number | undefined,
      title: String((progressBeforeUpdate.meta as Record<string, unknown> | undefined)?.name ?? ''),
    } : undefined;

    if (command.watched !== false) {
      const updatedLib = await coreLibraryApplyMarkWatched(JSON.stringify(lib), JSON.stringify(command.videoIds));
      if (updatedLib) Object.assign(lib, updatedLib);
    }
    const progressAfterUpdate = seriesId
      ? ((lib.progress as Record<string, unknown> | undefined) ?? {})[seriesId] as Record<string, unknown> | undefined
      : undefined;
    const progressMeta = progressAfterUpdate?.meta as Record<string, unknown> | undefined;
    const progressInfo: WatchProgressInfo | undefined = progressAfterUpdate && seriesId && progressAfterUpdate.lastVideoId ? {
      contentId: seriesId,
      contentType: String(progressMeta?.type ?? contentType),
      videoId: String(progressAfterUpdate.lastVideoId),
      positionSeconds: Number(progressAfterUpdate.timeOffset ?? 0),
      durationSeconds: Number(progressAfterUpdate.duration ?? 0),
      lastWatched: progressAfterUpdate.savedAt ? new Date(String(progressAfterUpdate.savedAt)).getTime() : Date.now(),
      season: progressAfterUpdate.lastEpisodeSeason as number | undefined,
      episode: progressAfterUpdate.lastEpisodeNumber as number | undefined,
    } : await deriveNextProgressInfo(seriesId, contentType, command.episodes ?? []);
    await loadActiveProfile().then((profile) =>
      pushMarkWatchedExternal(
        command.videoIds as string[],
        command.watched !== false,
        itemMeta,
        profile,
        episodeInfos.length > 0 ? episodeInfos : progressEpisodeInfo,
        progressInfo,
      )
    ).catch(() => undefined);
  }

  await saveLibrary(lib);
  invalidateCalendarCache();
  return lib;
}

export async function writePlaybackProgress(payload: Record<string, unknown>): Promise<unknown> {
  const lib = await loadLibrary();
  const progress = payload.progress as Record<string, unknown> | undefined;
  const meta = progress?.meta as { id?: string; name?: string; type?: string; poster?: string } | undefined;
  if (meta?.id) {
    const progressMap = (lib.progress as Record<string, unknown> | undefined) ?? {};
    const existing = (progressMap[meta.id] as Record<string, unknown> | undefined) ?? {};
    const mergePlan = await corePlaybackProgressMergePlan({
      existing,
      incoming: progress,
    }) as Record<string, unknown> | null;
    const existingMeta = (existing.meta as Record<string, unknown> | undefined) ?? {};
    const mergedMeta = await coreMergeProgressMeta(JSON.stringify(meta), JSON.stringify(existingMeta));
    progressMap[meta.id] = {
      ...existing,
      ...progress,
      ...(mergePlan ?? {}),
      meta: mergedMeta,
      savedAt: new Date().toISOString(),
    };
    lib.progress = progressMap;
    lib.continueWatching = await buildContinueWatching(progressMap);
    await saveLibrary(lib);
    const duration = Number(progress.duration ?? 0);
    const videoId = typeof progress.lastVideoId === 'string' ? progress.lastVideoId : meta.id;
    if (duration > 0 && videoId) {
      void loadActiveProfile().then((profile) => pushPlaybackProgressExternal({
        contentId: meta.id,
        contentType: String(meta.type ?? 'movie'),
        videoId,
        positionSeconds: Number(progress.timeOffset ?? 0),
        durationSeconds: duration,
        lastWatched: Date.now(),
        season: typeof progress.lastEpisodeSeason === 'number' ? progress.lastEpisodeSeason : undefined,
        episode: typeof progress.lastEpisodeNumber === 'number' ? progress.lastEpisodeNumber : undefined,
      }, meta as Record<string, unknown>, profile));
    }
    invalidateCalendarCache();
  }
  return {};
}

export async function writeSettings(payload: Record<string, unknown>): Promise<unknown> {
  const existing = (await storageRead<Record<string, unknown>>('settings')) ?? {};
  const updated = { ...existing, ...payload };
  await storageWrite('settings', updated);
  return updated;
}

export async function readLibraryState(): Promise<unknown> {
  return loadLibrary();
}

export async function readPlaybackProgress(payload: Record<string, unknown>): Promise<unknown> {
  const lib = await loadLibrary();
  const id = payload.id as string | undefined;
  if (!id) return null;
  const progressMap = (lib.progress as Record<string, unknown> | undefined) ?? {};
  return progressMap[id] ?? null;
}

export async function readDetailLocalState(payload: Record<string, unknown>): Promise<unknown> {
  const lib = await loadLibrary();
  return (await coreLibraryLocalStatePlan({ library: lib, ...payload })) ?? {
    progress: null,
    isInWatchlist: false,
    watchedVideoIds: [],
  };
}

export async function readCalendarMonth(payload: Record<string, unknown>): Promise<unknown> {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const monthPrefix = Number.isFinite(year) && Number.isFinite(month)
    ? `${Math.trunc(year)}-${String(Math.trunc(month)).padStart(2, '0')}`
    : '';
  const plannedItems = Array.isArray(payload.plannedItems) ? payload.plannedItems : [];

  const cached = calendarCache.get(monthPrefix);
  if (cached) return cached;

  const lib = await loadLibrary();
  const libraryItems = [
    ...(((lib.watchlist as unknown[] | undefined) ?? [])),
    ...(((lib.continueWatching as unknown[] | undefined) ?? [])),
  ];
  const seen = new Set<string>();
  const localItemsNested = await Promise.all(libraryItems.map((raw) => coreCalendarItemsFromMeta(JSON.stringify(raw), monthPrefix)));
  const localItems = localItemsNested.flat().filter((item) => {
    const id = String((item as Record<string, unknown>).id ?? '');
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const externalItems = ((lib.externalCalendarItems as unknown[] | undefined) ?? [])
    .filter((item) => {
      const dateIso = (item as Record<string, unknown>).dateIso as string | undefined;
      return !monthPrefix || dateIso?.startsWith(monthPrefix);
    });
  const result = { items: plannedItems, localItems, externalItems };
  calendarCache.set(monthPrefix, result);
  return result;
}

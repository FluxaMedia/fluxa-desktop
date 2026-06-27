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
import { pushMarkWatchedExternal, pushWatchlistExternal } from './externalSync';
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
  const command = payload.command as { type: string; item?: unknown; list?: string; watched?: boolean; videoIds?: string[] } | undefined;
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

    if (command.watched !== false) {
      const updatedLib = await coreLibraryApplyMarkWatched(JSON.stringify(lib), JSON.stringify(command.videoIds));
      if (updatedLib) Object.assign(lib, updatedLib);
    }
    // Fire-and-forget push to external services
    void loadActiveProfile().then((profile) =>
      pushMarkWatchedExternal(
        command.videoIds as string[],
        command.watched !== false,
        command.item as Record<string, unknown> | undefined,
        profile,
      )
    );
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

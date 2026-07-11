import * as Sentry from '@sentry/react';
import { completeEffect, coreMergeContinueWatchingLists, dispatchAction, enqueueOfflineDownload, libraryContinueWatchingDelete, libraryProgressDelete } from './engine';
import { startTorrentStream, stopTorrentStream } from './mpvPlayer';
import { effectRunnerLibraryKey, loadActiveProfile, loadAddons, loadLibrary, loadPrefs, saveLibrary, buildContinueWatching, persistLastWatchedEpisode } from './libraryOps';
import { readHomeBootstrap, refreshReleasedContinueWatching } from './homeEffects';
import { invalidateCalendarCache } from './libraryEffects';
import {
  applyLibraryCommand,
  notifyReleasedEpisodes,
  readCalendarMonth,
  readDetailLocalState,
  readLibraryState,
  readPlaybackProgress,
  writePlaybackProgress,
  writeSettings,
} from './libraryEffects';
import { notify } from './notifications';
import { t } from '../i18n';
import { fetchAddonManifest, fetchAddonResource, refreshInstalledAddons } from './addonEffects';
import { fetchCatalogPage, readDiscoverCatalogFilters, runDiscover, runSearch } from './catalogEffects';
import {
  fetchDetailSecondary,
  fetchDetailStreams,
  fetchMetaDetail,
  fetchSeasonEpisodes,
  prefetchDetailStreams,
} from './detailEffects';
import { exchangeAuthCode, refreshAuthToken, runAuthFlow } from './authEffects';
import {
  dropExternalPlaybackProgress,
  enqueueTraktScrobble,
  pushMarkWatchedExternal,
  replaceExternalContinueWatching,
  syncExternalIntegrationNow,
  type WatchProgressInfo,
} from './externalSync';
import { fetchVideosForSeries } from './fetchPlanning';
import { fetchIntroSegments, fetchSubtitles, resolveIntroImdbId, type IntroSegmentResult } from './introEffects';
import type { AppState, Effect, EffectResult } from './types';

export { fetchMetaVideos } from './detailEffects';
export { syncExternalIntegrationNow } from './externalSync';
export type { IntroSegmentResult } from './introEffects';

async function startTorrentFromEffect(payload: Record<string, unknown>): Promise<unknown> {
  const stream = payload.stream && typeof payload.stream === 'object'
    ? { ...(payload.stream as Record<string, unknown>) }
    : {};
  if (typeof payload.url === 'string' && !stream.playableUrl && !stream.url) {
    stream.playableUrl = payload.url;
  }
  if (typeof payload.fileIdx === 'number' && stream.fileIdx == null) {
    stream.fileIdx = payload.fileIdx;
  }
  if (Array.isArray(payload.sources) && !Array.isArray(stream.sources)) {
    stream.sources = payload.sources;
  }
  const title = typeof payload.title === 'string' ? payload.title : undefined;
  const prefs = await loadPrefs();
  const url = await startTorrentStream(JSON.stringify(stream), title, prefs);
  return { url };
}

function episodeOrderKey(ep: { season?: number; episode?: number; number?: number }): number {
  return (Number(ep.season ?? 1) * 10000) + Number(ep.episode ?? ep.number ?? 0);
}

async function deriveNextProgressFromLastWatched(metaObj: Record<string, unknown>): Promise<WatchProgressInfo | undefined> {
  const id = metaObj.id as string | undefined;
  if (!id || metaObj.type !== 'series') return undefined;
  const currentSeason = metaObj.lastEpisodeSeason as number | undefined;
  const currentEpisode = metaObj.lastEpisodeNumber as number | undefined;
  if (currentSeason == null || currentEpisode == null) return undefined;
  const currentOrder = episodeOrderKey({ season: currentSeason, episode: currentEpisode });
  const videos = await fetchVideosForSeries(id, await loadAddons());
  const now = Date.now();
  const next = videos
    .filter((ep) => {
      if (episodeOrderKey(ep) <= currentOrder) return false;
      if (ep.released && new Date(ep.released).getTime() > now) return false;
      return true;
    })
    .sort((a, b) => episodeOrderKey(a) - episodeOrderKey(b))[0];
  if (!next?.id) return undefined;
  return {
    contentId: id,
    contentType: 'series',
    videoId: next.id,
    positionSeconds: 1,
    durationSeconds: 99999,
    lastWatched: Date.now(),
    season: next.season,
    episode: next.episode ?? next.number,
  };
}

async function runEffect(
  effect: Effect,
  onStateUpdate?: (state: Partial<AppState>) => void,
): Promise<unknown> {
  const p = effect.payload;
  let value: unknown;

  switch (effect.type) {
    case 'readHomeBootstrap':
      value = await readHomeBootstrap(p);
      break;

    case 'refreshContinueWatching': {
      const lib = await loadLibrary();
      const addons = await loadAddons();
      const prefs = await loadPrefs();
      const localCW = (lib.continueWatching as Record<string, unknown>[] | undefined) ?? [];
      const externalCW = (lib.externalContinueWatching as Record<string, unknown>[] | undefined) ?? [];
      const progressMap = (lib.progress as Record<string, unknown> | undefined) ?? {};
      const mergedCWRaw = await coreMergeContinueWatchingLists(
        JSON.stringify(localCW),
        JSON.stringify(externalCW),
        JSON.stringify(progressMap),
        prefs.syncCwSourceOfTruth as string | undefined,
        prefs.syncCwRanking as string | undefined,
      );
      const mergedCW = (mergedCWRaw ?? []) as Record<string, unknown>[];
      const lastWatched = (lib.lastWatchedEpisodes as Record<string, unknown> | undefined) ?? {};
      const mergedIds = new Set(mergedCW.map((item) => String(item.id ?? item._id ?? '')));
      const lastWatchedItems = Object.entries(lastWatched)
        .filter(([id]) => !mergedIds.has(id))
        .map(([id, entry]) => {
          const e = entry as Record<string, unknown>;
          const meta = (e.meta as Record<string, unknown> | undefined) ?? {};
          return {
            id,
            _id: id,
            type: 'series',
            name: meta.name,
            poster: meta.poster,
            background: meta.background,
            lastVideoId: e.lastVideoId,
            lastEpisodeSeason: e.lastEpisodeSeason,
            lastEpisodeNumber: e.lastEpisodeNumber,
            timeOffset: 1,
            duration: 99999,
            savedAt: e.savedAt,
          };
        });
      const continueWatching = await refreshReleasedContinueWatching(
        [...mergedCW, ...lastWatchedItems],
        lib as Record<string, unknown>,
        addons,
      );
      value = { continueWatching };
      break;
    }

    case 'readLibraryState':
      value = await readLibraryState();
      break;
    case 'readPlaybackProgress':
      value = await readPlaybackProgress(p);
      break;
    case 'readDetailLocalState':
      value = await readDetailLocalState(p);
      break;
    case 'readDiscoverCatalogFilters':
      value = await readDiscoverCatalogFilters(p);
      break;
    case 'readCalendarMonth':
      value = await readCalendarMonth(p);
      break;

    case 'writeLibraryCommand':
      value = await applyLibraryCommand(p);
      break;
    case 'writePlaybackProgress':
      value = await writePlaybackProgress(p);
      break;
    case 'writeFeedback':
      value = {};
      break;
    case 'clearPlaybackProgress': {
      const lib = await loadLibrary();
      const metaObj = (p.meta as Record<string, unknown>) ?? {};
      const id = metaObj.id as string | undefined;
      const preserveLastWatched = Boolean(metaObj._preserveLastWatched);
      if (id) {
        const progressMap = (lib.progress as Record<string, unknown> | undefined) ?? {};
        delete progressMap[id];
        lib.progress = progressMap;
        await libraryProgressDelete(await effectRunnerLibraryKey(), id);
        lib.continueWatching = await buildContinueWatching(progressMap);
        const extCW = (lib.externalContinueWatching as Record<string, unknown>[] | undefined) ?? [];
        const droppedExternal = extCW.find((item) => item.id === id);
        lib.externalContinueWatching = extCW.filter((item) => item.id !== id);
        if (droppedExternal) await libraryContinueWatchingDelete(await effectRunnerLibraryKey(), id);
        const lastWatched = (lib.lastWatchedEpisodes as Record<string, unknown> | undefined) ?? {};
        if (preserveLastWatched) {
          if (metaObj.lastVideoId != null) {
            const entry = {
              meta: {
                id,
                type: metaObj.type ?? 'series',
                name: metaObj.name,
                poster: metaObj.poster,
                background: metaObj.background,
              },
              lastVideoId: metaObj.lastVideoId,
              lastEpisodeSeason: metaObj.lastEpisodeSeason,
              lastEpisodeNumber: metaObj.lastEpisodeNumber,
              lastEpisodeName: metaObj.lastEpisodeName,
              lastEpisodeThumbnail: metaObj.lastEpisodeThumbnail,
              savedAt: new Date().toISOString(),
            };
            lastWatched[id] = entry;
            lib.lastWatchedEpisodes = lastWatched;
            await persistLastWatchedEpisode(id, entry);
          }
        } else {
          delete lastWatched[id];
          lib.lastWatchedEpisodes = lastWatched;
          await persistLastWatchedEpisode(id, null);
        }
        await saveLibrary(lib);
        invalidateCalendarCache();
        if (preserveLastWatched && metaObj.lastVideoId != null) {
          const profile = await loadActiveProfile();
          const nextProgress = await deriveNextProgressFromLastWatched(metaObj);
          await pushMarkWatchedExternal(
            [String(metaObj.lastVideoId)],
            true,
            metaObj,
            profile,
            {
              contentId: id,
              contentType: String(metaObj.type ?? 'series'),
              season: metaObj.lastEpisodeSeason as number | undefined,
              episode: metaObj.lastEpisodeNumber as number | undefined,
              title: String(metaObj.name ?? ''),
            },
            nextProgress,
          ).catch(() => undefined);
        }
        if (droppedExternal) {
          void dropExternalPlaybackProgress(droppedExternal);
        }
      }
      value = (id && !preserveLastWatched) ? { droppedId: id } : {};
      break;
    }
    case 'writeSettings':
      value = await writeSettings(p);
      break;
    case 'syncWatchedState':
      value = {};
      break;

    case 'fetchAddonManifest':
      value = await fetchAddonManifest(p);
      break;
    case 'refreshInstalledAddons':
      value = await refreshInstalledAddons(p);
      break;
    case 'fetchAddonResource':
      value = await fetchAddonResource(p);
      break;

    case 'fetchCatalogPage':
      value = await fetchCatalogPage(p);
      break;
    case 'runSearch':
      value = await runSearch(p);
      break;
    case 'runDiscover':
      value = await runDiscover(p);
      break;

    case 'fetchMetaDetail':
    case 'fetchMetaDetailLookup':
      value = await fetchMetaDetail(p);
      break;
    case 'fetchDetailSecondary':
      value = await fetchDetailSecondary(p);
      break;
    case 'prefetchDetailStreams':
      value = await prefetchDetailStreams(p);
      break;
    case 'fetchDetailStreams':
      value = await fetchDetailStreams(p, onStateUpdate, effect.generation);
      break;
    case 'fetchSeasonEpisodes':
      value = await fetchSeasonEpisodes(p);
      break;
    case 'loadStreams':
      value = await fetchDetailStreams(p);
      break;

    case 'fetchSubtitles':
      value = await fetchSubtitles(p);
      break;

    case 'resolveIntroImdbId':
      value = await resolveIntroImdbId(p);
      break;
    case 'fetchIntroSegments':
      value = await fetchIntroSegments(p);
      break;

    case 'runAuthFlow':
      value = await runAuthFlow(p);
      break;
    case 'exchangeAuthCode':
      value = await exchangeAuthCode(p);
      break;
    case 'refreshAuthToken':
      value = await refreshAuthToken(p);
      break;

    case 'runExternalSync':
      value = await syncExternalIntegrationNow(p);
      break;
    case 'syncExternalIntegration':
      value = { synced: false };
      break;
    case 'enqueueTraktScrobble':
      value = await enqueueTraktScrobble(p);
      break;

    case 'startTorrentStream':
      value = await startTorrentFromEffect(p);
      break;
    case 'stopTorrent':
      value = { stopped: await stopTorrentStream() };
      break;

    case 'enqueueOfflineDownload':
      value = await enqueueOfflineDownload(p);
      break;

    case 'notifyReleasedEpisodes':
      void notifyReleasedEpisodes(p);
      value = {};
      break;
    case 'updateCalendarWidget':
      value = {};
      break;
    case 'replaceExternalContinueWatching':
      value = await replaceExternalContinueWatching(p);
      break;

    case 'prepareDirectPlayback':
      value = await fetchDetailStreams(p);
      break;

    default:
      value = null;
      break;
  }

  return value;
}

export async function executeEffect(
  effect: Effect,
  onStateUpdate?: (state: Partial<AppState>) => void,
): Promise<EffectResult> {
  try {
    const value = await Sentry.startSpan(
      { name: effect.type, op: 'fluxa.effect' },
      () => runEffect(effect, onStateUpdate),
    );
    return { effectId: effect.id, status: 'ok', value };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (effect.type === 'runExternalSync') {
      void notify(t('notifications.trakt_sync_failed_title'), message);
    }
    return {
      effectId: effect.id,
      status: 'err',
      error: message,
    };
  }
}

export async function pumpEffects(
  effects: Effect[],
  onStateUpdate: (state: Partial<AppState>) => void,
): Promise<Partial<AppState> | null> {
  let lastState: Partial<AppState> | null = null;

  // Execute effects concurrently per batch, then feed completions back
  await Promise.all(
    effects.map(async (effect) => {
      const result = await executeEffect(effect, onStateUpdate);
      let dispatchResult: Awaited<ReturnType<typeof completeEffect>> = null;
      try {
        dispatchResult = await completeEffect(result);
      } catch {
      }
      if (dispatchResult) {
        lastState = dispatchResult.state;
        onStateUpdate(dispatchResult.state);
        if (dispatchResult.effects.length > 0) {
          await pumpEffects(dispatchResult.effects, onStateUpdate);
        }
      }
    }),
  );

  return lastState;
}

export async function fetchStreamsForEpisode(
  episodeId: string,
  contentType: string,
): Promise<{ streams: unknown[] }> {
  const result = await fetchDetailStreams({
    id: episodeId,
    contentType,
    requestIds: [episodeId],
  });
  return result as { streams: unknown[] };
}

export async function fetchPlaybackSkipSegments(opts: {
  imdbId: string;
  season: number;
  episode: number;
  title: string;
  useIntroDb?: boolean;
  useAniSkip?: boolean;
}): Promise<IntroSegmentResult[]> {
  return fetchIntroSegments(opts) as Promise<IntroSegmentResult[]>;
}

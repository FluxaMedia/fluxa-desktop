import { invoke } from '@tauri-apps/api/core';
import type { DispatchResult, EffectResult } from './types';

let engineHandle: number | null = null;

function debugLog(msg: string) {
  void invoke('debug_log', { msg }).catch(() => {});
}

function logDispatch(label: string, raw: string | null, ms: number) {
  if (!raw) return;
  let domains: string[] = [];
  try {
    domains = Object.keys((JSON.parse(raw) as DispatchResult).state ?? {});
  } catch {}
  debugLog(`${label} bytes=${raw.length} ms=${ms.toFixed(1)} domains=[${domains.join(',')}]`);
}

export async function initEngine(initialJson: string = '{}'): Promise<void> {
  if (engineHandle !== null) return;
  engineHandle = await invoke<number>('engine_init', { initialJson });
}

export async function dispatchAction(actionJson: string): Promise<DispatchResult | null> {
  const t0 = performance.now();
  const raw = await invoke<string | null>('engine_dispatch', { actionJson });
  let label = 'dispatch';
  try { label = `dispatch:${(JSON.parse(actionJson) as { type?: string }).type ?? '?'}`; } catch {}
  logDispatch(label, raw, performance.now() - t0);
  if (!raw) return null;
  return JSON.parse(raw) as DispatchResult;
}

export async function completeEffect(result: EffectResult): Promise<DispatchResult | null> {
  const t0 = performance.now();
  const raw = await invoke<string | null>('engine_complete_effect', {
    resultJson: JSON.stringify(result),
  });
  logDispatch(`completeEffect:${result.effectId}`, raw, performance.now() - t0);
  if (!raw) return null;
  return JSON.parse(raw) as DispatchResult;
}

export async function getSnapshot(): Promise<unknown | null> {
  const raw = await invoke<string | null>('engine_snapshot');
  if (!raw) return null;
  return JSON.parse(raw);
}

export async function httpFetchText(url: string): Promise<{ statusCode: number; body: string }> {
  const response = await invoke<{ status_code: number; body: string }>('http_fetch_text', { url });
  return { statusCode: response.status_code, body: response.body };
}

export async function storageRead<T>(key: string): Promise<T | null> {
  const raw = await invoke<string | null>('storage_read', { key });
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function storageWrite(key: string, value: unknown): Promise<boolean> {
  return invoke<boolean>('storage_write', { key, value: JSON.stringify(value) });
}

export async function storageDelete(key: string): Promise<boolean> {
  return invoke<boolean>('storage_delete', { key });
}

export async function enqueueOfflineDownload(request: unknown): Promise<unknown | null> {
  const raw = await invoke<string | null>('enqueue_offline_download', {
    requestJson: JSON.stringify(request),
  });
  return raw ? JSON.parse(raw) : null;
}

export async function coreInvoke<T>(method: string, argsJson: string): Promise<T | null> {
  const t0 = performance.now();
  const raw = await invoke<string>('core_invoke', { method, argsJson });
  debugLog(`coreInvoke:${method} bytes=${argsJson.length}+${raw.length} ms=${(performance.now() - t0).toFixed(1)}`);
  const envelope = JSON.parse(raw) as { ok: boolean; value?: T; error?: { kind: string; message: string } };
  if (!envelope.ok) {
    throw new Error(`[core] ${method}: ${envelope.error?.message ?? 'unknown error'}`);
  }
  return envelope.value ?? null;
}

export async function corePlaybackPreparePlan(request: unknown): Promise<Record<string, unknown> | null> {
  return coreInvoke('playbackPreparePlan', JSON.stringify(request));
}

export async function coreLibraryLocalStatePlan(request: unknown): Promise<Record<string, unknown> | null> {
  return coreInvoke('libraryLocalStatePlan', JSON.stringify(request));
}

export async function corePreferencesSchema(): Promise<Record<string, unknown> | null> {
  return coreInvoke('preferencesSchema', '{}');
}

export async function coreApplyPreferenceUpdate(request: unknown): Promise<Record<string, unknown> | null> {
  return coreInvoke('applyPreferenceUpdate', JSON.stringify(request));
}

export async function coreDetailEpisodePlan(request: unknown): Promise<Record<string, unknown> | null> {
  return coreInvoke('detailEpisodePlan', JSON.stringify(request));
}

export async function coreNormalizeAddonSubtitles(subtitles: unknown[], resourceUrl: string): Promise<unknown[]> {
  return (await coreInvoke<unknown[]>('normalizeAddonSubtitles', JSON.stringify({ subtitles: JSON.stringify(subtitles), resourceUrl }))) ?? [];
}

export async function streamPlaybackInfo(streamJson: string): Promise<unknown | null> {
  return coreInvoke('streamPlaybackInfo', streamJson);
}

export async function coreSearchResultGrouping(request: unknown): Promise<unknown | null> {
  return coreInvoke('searchResultGrouping', JSON.stringify(request));
}

export async function coreBuildMetadataFeedOptions(addons: unknown[]): Promise<unknown[] | null> {
  return coreInvoke('buildMetadataFeedOptions', JSON.stringify(addons));
}

export async function coreDiscoverCatalogOptions(addons: unknown[], selectedType: string): Promise<unknown[] | null> {
  return coreInvoke('discoverCatalogOptions', JSON.stringify({ addons: JSON.stringify(addons), selectedType }));
}

export async function coreDiscoverSortPlan(request: unknown): Promise<unknown | null> {
  return coreInvoke('discoverSortPlan', JSON.stringify(request));
}

export async function coreLibrarySortPlan(request: unknown): Promise<unknown | null> {
  return coreInvoke('librarySortPlan', JSON.stringify(request));
}

export async function coreWatchlistTogglePlan(request: unknown): Promise<unknown | null> {
  return coreInvoke('watchlistTogglePlan', JSON.stringify(request));
}

export async function corePlaybackProgressMergePlan(request: unknown): Promise<unknown | null> {
  return coreInvoke('playbackProgressMergePlan', JSON.stringify(request));
}

export async function coreLibraryContinueWatchingItems(items: unknown[]): Promise<unknown[] | null> {
  return coreInvoke('libraryContinueWatchingItems', JSON.stringify(items));
}

export async function coreDetailSeriesLookupId(rawId: string): Promise<string> {
  return (await coreInvoke<string>('detailSeriesLookupId', JSON.stringify({ id: rawId }))) ?? rawId;
}

export async function coreDetailSeasonLoadPlan(request: unknown): Promise<unknown | null> {
  return coreInvoke('detailSeasonLoadPlan', JSON.stringify(request));
}

export async function corePlayerBackendSelection(request: unknown): Promise<unknown | null> {
  return coreInvoke('playerBackendSelection', JSON.stringify(request));
}

export async function corePlayerBufferTargets(request: unknown): Promise<unknown | null> {
  return coreInvoke('playerBufferTargets', JSON.stringify(request));
}

export async function coreOfflineDownloadPlan(request: unknown): Promise<unknown | null> {
  return coreInvoke('offlineDownloadPlan', JSON.stringify(request));
}

export async function corePlaybackIntroLookupContentId(id: string): Promise<string> {
  return (await coreInvoke<string>('playbackIntroLookupContentId', JSON.stringify({ id }))) ?? id;
}

export async function corePlayerSourceSidebarPlan(request: unknown): Promise<unknown | null> {
  return coreInvoke('playerSourceSidebarPlan', JSON.stringify(request));
}

export async function corePlayerRetryPolicy(request: unknown): Promise<unknown | null> {
  return coreInvoke('playerRetryPolicy', JSON.stringify(request));
}

export async function coreEffectiveMetadataFeedSelection(
  selectedKeys: string[],
  availableKeys: string[],
): Promise<string[] | null> {
  return coreInvoke('effectiveMetadataFeedSelection', JSON.stringify({
    selectedKeys: JSON.stringify(selectedKeys),
    availableKeys: JSON.stringify(availableKeys),
  }));
}

export async function coreToggleMetadataFeedLimited(
  selectedKeys: string[],
  availableKeys: string[],
  key: string,
  maxEnabled: number,
): Promise<string[] | null> {
  return coreInvoke('toggleMetadataFeedLimited', JSON.stringify({
    selectedKeys: JSON.stringify(selectedKeys),
    availableKeys: JSON.stringify(availableKeys),
    key,
    maxEnabled,
  }));
}

export async function coreFindPreferredSubtitleIndex(
  tracks: unknown[],
  lastSubtitleLanguage?: string | null,
  preferredSubtitleLanguage?: string | null,
  secondarySubtitleLanguage?: string | null,
): Promise<number> {
  return (await coreInvoke<number>('findPreferredSubtitleIndex', JSON.stringify({
    tracks: JSON.stringify(tracks),
    lastSubtitleLanguage: lastSubtitleLanguage ?? null,
    preferredSubtitleLanguage: preferredSubtitleLanguage ?? null,
    secondarySubtitleLanguage: secondarySubtitleLanguage ?? null,
  }))) ?? -1;
}

export async function coreParseVideoId(id: string): Promise<{
  imdb?: string; tmdb?: string; season?: number; episode?: number; isEpisode: boolean;
}> {
  return (await coreInvoke('parseVideoId', JSON.stringify({ id }))) ?? { isEpisode: false };
}

export async function coreBuildTraktIds(videoId: string): Promise<Record<string, unknown> | null> {
  return coreInvoke('buildTraktIds', JSON.stringify({ id: videoId }));
}

export async function coreDetectAnimePlayback(
  metaJson: string,
  episodeJson: string,
  streamJson: string,
  addonsJson: string,
): Promise<{ isAnime: boolean; confidence: number; reasons: string[] }> {
  return (await coreInvoke('detectAnimePlayback', JSON.stringify({ metaJson, episodeJson, streamJson, addonsJson })))
    ?? { isAnime: false, confidence: 0, reasons: [] };
}

export async function coreAnilistEntriesToSync(entriesJson: string, nowMs: number): Promise<{
  watchlist: Record<string, unknown>[];
  completed: Record<string, unknown>[];
  dropped: Record<string, unknown>[];
  watching: Record<string, unknown>[];
  watched: Record<string, boolean>;
  progress: Record<string, unknown>;
} | null> {
  return coreInvoke('anilistEntriesToSync', JSON.stringify({ entriesJson, nowMs }));
}

export async function coreMergeLibraryItemsById(localJson: string, incomingJson: string): Promise<Record<string, unknown>[]> {
  return (await coreInvoke<Record<string, unknown>[]>('mergeLibraryItemsById', JSON.stringify({ localJson, incomingJson }))) ?? [];
}

export async function coreTmdbPeopleRequestPlan(metaJson: string, apiKey: string, language: string): Promise<{
  creditsUrl?: string; findUrl?: string;
} | null> {
  return coreInvoke('tmdbPeopleRequestPlan', JSON.stringify({ metaJson, apiKey, language }));
}

export async function coreTmdbCreditsUrlFromFind(findJson: string, metaJson: string, apiKey: string, language: string): Promise<string | null> {
  return coreInvoke('tmdbCreditsUrlFromFind', JSON.stringify({ findJson, metaJson, apiKey, language }));
}

export async function coreTmdbPeopleImagesFromCredits(creditsJson: string, linksJson: string): Promise<Record<string, string>> {
  return (await coreInvoke<Record<string, string>>('tmdbPeopleImagesFromCredits', JSON.stringify({ creditsJson, linksJson }))) ?? {};
}

export async function coreCalendarItemsFromMeta(metaJson: string, monthPrefix: string): Promise<unknown[]> {
  return (await coreInvoke<unknown[]>('calendarItemsFromMeta', JSON.stringify({ metaJson, monthPrefix }))) ?? [];
}

export async function coreCalendarItemMatchesMonth(itemJson: string, monthPrefix: string): Promise<boolean> {
  return (await coreInvoke<boolean>('calendarItemMatchesMonth', JSON.stringify({ itemJson, monthPrefix }))) ?? false;
}

export async function coreNextUnairedEpisode(videosJson: string, nowMs: number): Promise<{ released?: string } | null> {
  return coreInvoke('nextUnairedEpisode', JSON.stringify({ videosJson, nowMs }));
}

export async function coreTraktScrobblePlan(
  videoId: string,
  isEpisode: boolean,
  season: number | null,
  epNumber: number | null,
  timePosSec: number,
  durationSec: number,
): Promise<{ action: string; body: unknown } | null> {
  return coreInvoke('traktScrobblePlan', JSON.stringify({ videoId, isEpisode, season, epNumber, timePosSec, durationSec }));
}

export async function coreSimklScrobbleBody(
  idsJson: string,
  isEpisode: boolean,
  season: number,
  epNumber: number,
  timePosSec: number,
  durationSec: number,
): Promise<unknown | null> {
  return coreInvoke('simklScrobbleBody', JSON.stringify({ idsJson, isEpisode, season, epNumber, timePosSec, durationSec }));
}

export async function coreTraktPlaybackItemsToLibrary(itemsJson: string): Promise<unknown[] | null> {
  return coreInvoke('traktPlaybackItemsToLibrary', itemsJson);
}

export async function coreTraktWatchlistToItems(moviesJson: string, showsJson: string): Promise<unknown[] | null> {
  return coreInvoke('traktWatchlistToItems', JSON.stringify({ moviesJson, showsJson }));
}

export async function coreTraktWatchedToIds(moviesJson: string, showsJson: string): Promise<unknown[] | null> {
  return coreInvoke('traktWatchedToIds', JSON.stringify({ moviesJson, showsJson }));
}

export async function coreMergeExternalWatchlist(localJson: string, externalJson: string): Promise<Record<string, unknown>[]> {
  return (await coreInvoke<Record<string, unknown>[]>('mergeExternalWatchlist', JSON.stringify({ localJson, externalJson }))) ?? [];
}

export async function coreMergeExternalWatched(localJson: string, externalJson: string): Promise<Record<string, boolean>> {
  return (await coreInvoke<Record<string, boolean>>('mergeExternalWatched', JSON.stringify({ localJson, externalJson }))) ?? {};
}

export async function coreMergeContinueWatchingLists(
  localJson: string,
  externalJson: string,
  progressJson: string,
): Promise<unknown[] | null> {
  return coreInvoke('mergeContinueWatchingLists', JSON.stringify({ localJson, externalJson, progressJson }));
}

export async function coreSimklWatchingToItems(showsJson: string, moviesJson: string): Promise<unknown[] | null> {
  return coreInvoke('simklWatchingToItems', JSON.stringify({ showsJson, moviesJson }));
}

export async function coreSimklWatchlistToItems(showsJson: string, moviesJson: string): Promise<unknown[] | null> {
  return coreInvoke('simklWatchlistToItems', JSON.stringify({ showsJson, moviesJson }));
}

export async function coreSimklWatchedToIds(showsJson: string, moviesJson: string): Promise<Record<string, boolean> | null> {
  return coreInvoke('simklWatchedToIds', JSON.stringify({ showsJson, moviesJson }));
}

export async function coreStremioWatchlistToItems(items: unknown[]): Promise<unknown[] | null> {
  return coreInvoke('stremioWatchlistToItems', JSON.stringify(items));
}

export async function coreStremioWatchedToIds(items: unknown[]): Promise<Record<string, boolean> | null> {
  return coreInvoke('stremioWatchedToIds', JSON.stringify(items));
}

export async function coreNormalizeLibraryDocument(json: string): Promise<Record<string, unknown>> {
  return (await coreInvoke<Record<string, unknown>>('normalizeLibraryDocument', json)) ?? {};
}

export async function coreIsUpNextContinueWatchingItem(itemJson: string): Promise<boolean> {
  return (await coreInvoke<boolean>('isUpNextContinueWatchingItem', itemJson)) ?? false;
}

export async function coreRememberLastWatchedEpisodes(
  libJson: string,
  watchedIdsJson: string,
): Promise<Record<string, unknown>> {
  return (await coreInvoke<Record<string, unknown>>('rememberLastWatchedEpisodes', JSON.stringify({ libJson, watchedIdsJson }))) ?? {};
}

export async function coreBuildContinueWatchingFromProgress(progressJson: string): Promise<unknown[] | null> {
  return coreInvoke('buildContinueWatchingFromProgress', progressJson);
}

export async function coreComputeContinueWatchingBadges(
  candidatesJson: string,
  videosBySeriesJson: string,
  lastWatchedJson: string,
  nowMs: number,
): Promise<unknown[] | null> {
  return coreInvoke('computeContinueWatchingBadges', JSON.stringify({ candidatesJson, videosBySeriesJson, lastWatchedJson, nowMs }));
}

export async function coreTmdbContentType(contentType: string): Promise<string> {
  return (await coreInvoke<string>('tmdbContentType', JSON.stringify({ contentType }))) ?? contentType;
}

export async function coreTmdbLanguage(language: string): Promise<string> {
  return (await coreInvoke<string>('tmdbLanguage', JSON.stringify({ language }))) ?? language;
}

export async function coreTmdbImageUrl(path: string | null, size: string): Promise<string | null> {
  return coreInvoke('tmdbImageUrl', JSON.stringify({ path, size }));
}

export async function coreTmdbMetaToMeta(
  itemJson: string, requestedType: string, language: string,
): Promise<unknown | null> {
  return coreInvoke('tmdbMetaToMeta', JSON.stringify({ itemJson, requestedType, language }));
}

export async function coreTmdbVideoToTrailer(videoJson: string): Promise<unknown | null> {
  return coreInvoke('tmdbVideoToTrailer', videoJson);
}

export async function coreTmdbBulkMetas(
  itemsJson: string, requestedType: string, language: string,
): Promise<unknown[] | null> {
  return coreInvoke('tmdbBulkMetas', JSON.stringify({ itemsJson, requestedType, language }));
}

export async function coreTmdbBulkVideosToTrailers(itemsJson: string): Promise<unknown[] | null> {
  return coreInvoke('tmdbBulkVideosToTrailers', itemsJson);
}

export async function coreTmdbResolveIdHint(contentId: string): Promise<[string, boolean]> {
  return (await coreInvoke<[string, boolean]>('tmdbResolveIdHint', JSON.stringify({ contentId }))) ?? ['', false];
}

export async function coreParseIntroDbSegments(dataJson: string): Promise<unknown[] | null> {
  return coreInvoke('parseIntroDbSegments', dataJson);
}

export async function coreParseAniskipResults(resultsJson: string): Promise<unknown[] | null> {
  return coreInvoke('parseAniskipResults', resultsJson);
}

export async function coreUniqueIntroSegments(
  segmentsAJson: string, segmentsBJson: string,
): Promise<unknown[] | null> {
  return coreInvoke('uniqueIntroSegments', JSON.stringify({ segmentsAJson, segmentsBJson }));
}

export async function coreMergeIntroSegments(sourcesJson: string): Promise<unknown[] | null> {
  return coreInvoke('mergeIntroSegments', sourcesJson);
}

export async function coreResolveNextEpisode(
  videosJson: string,
  currentSeason: number,
  currentEpisode: number,
  nowMs: number,
  releasedOnly: boolean,
): Promise<unknown | null> {
  return coreInvoke('resolveNextEpisode', JSON.stringify({
    videos: JSON.parse(videosJson),
    currentSeason,
    currentEpisode,
    nowMs,
    releasedOnly,
  }));
}

export async function coreFormatEpisodeLine(
  lastEpisodeName?: string | null,
  lastEpisodeSeason?: number | null,
  lastEpisodeNumber?: number | null,
  lastVideoId?: string | null,
): Promise<string> {
  return (await coreInvoke<string>('formatEpisodeLine', JSON.stringify({
    lastEpisodeName: lastEpisodeName ?? null,
    lastEpisodeSeason: lastEpisodeSeason ?? null,
    lastEpisodeNumber: lastEpisodeNumber ?? null,
    lastVideoId: lastVideoId ?? null,
  }))) ?? '';
}

export async function coreSelectContinueWatchingArtwork(
  itemJson: string,
  artworkPreference: string,
  isHorizontal: boolean,
): Promise<string | null> {
  return coreInvoke('selectContinueWatchingArtwork', JSON.stringify({ item: JSON.parse(itemJson), artworkPreference, isHorizontal }));
}

// Batched form of the two functions above for a whole Continue Watching row — avoids
// one IPC round trip per card on every Home load.
export async function coreContinueWatchingCardFields(
  items: unknown[],
  artworkPreference: string,
  isHorizontal: boolean,
): Promise<Array<{ id: string; artwork: string | null; episodeLine: string }> | null> {
  return coreInvoke('continueWatchingCardFields', JSON.stringify({ items, artworkPreference, isHorizontal }));
}

export async function coreBuildHomeCollectionShelves(
  profileJson: string,
  addonsJson: string,
): Promise<{ pinnedShelves: unknown[]; regularShelves: unknown[]; hiddenFolderCategories: unknown[] } | null> {
  return coreInvoke('buildHomeCollectionShelves', JSON.stringify({ profileJson, addonsJson }));
}

export async function coreReplaceExternalContinueWatching(
  existingJson: string,
  provider: string | null,
  itemsJson: string,
): Promise<unknown[]> {
  return (await coreInvoke<unknown[]>('replaceExternalContinueWatching', JSON.stringify({ existingJson, provider, itemsJson }))) ?? [];
}

export async function coreResourceKindToResource(
  kind: string,
  requestResource?: string | null,
  itemResource?: string | null,
): Promise<string> {
  return (await coreInvoke<string>('resourceKindToResource', JSON.stringify({
    kind,
    requestResource: requestResource ?? null,
    itemResource: itemResource ?? null,
  }))) ?? kind;
}

export async function coreWrapAddonResourceResponse(resource: string, payloadJson: string): Promise<unknown> {
  return coreInvoke('wrapAddonResourceResponse', JSON.stringify({ resource, payloadJson }));
}

export async function coreCanPrefetchNextEpisode(prefsJson: string, streamJson: string): Promise<boolean> {
  return (await coreInvoke<boolean>('canPrefetchNextEpisode', JSON.stringify({ prefsJson, streamJson }))) ?? false;
}

export async function coreSelectNextEpisodeStream(
  streamsJson: string,
  currentStreamJson: string,
  prefsJson: string,
): Promise<unknown | null> {
  return coreInvoke('selectNextEpisodeStream', JSON.stringify({ streamsJson, currentStreamJson, prefsJson }));
}

export async function coreImportCollections(rawJson: string): Promise<unknown[] | null> {
  return coreInvoke('importCollections', rawJson);
}

export async function coreExportCollections(collectionsJson: string): Promise<unknown | null> {
  return coreInvoke('exportCollections', collectionsJson);
}

export async function coreResolveTransportUrl(sourceJson: string, addonsJson: string): Promise<string | null> {
  return coreInvoke('resolveTransportUrl', JSON.stringify({ sourceJson, addonsJson }));
}

export async function coreResolveFeedOptionGenre(feedOptionJson: string, addonsJson: string): Promise<string | null> {
  return coreInvoke('resolveFeedOptionGenre', JSON.stringify({ feedOptionJson, addonsJson }));
}

export async function coreTraktPlaybackItemsDedup(itemsJson: string): Promise<unknown[] | null> {
  return coreInvoke('traktPlaybackItemsDedup', itemsJson);
}

export async function coreTraktMarkWatchedBody(videoIdsJson: string): Promise<unknown | null> {
  return coreInvoke('traktMarkWatchedBody', videoIdsJson);
}

export async function coreSimklMatchEpisode(episodesJson: string, targetJson: string): Promise<{ season: number; episode: number } | null> {
  return coreInvoke('simklMatchEpisode', JSON.stringify({ episodesJson, targetJson }));
}

export async function coreLibraryApplyMarkWatched(libJson: string, videoIdsJson: string): Promise<Record<string, unknown> | null> {
  return coreInvoke('libraryApplyMarkWatched', JSON.stringify({ libJson, videoIdsJson }));
}

export async function coreMergeProgressMeta(incomingMetaJson: string, existingMetaJson: string): Promise<Record<string, unknown>> {
  return (await coreInvoke<Record<string, unknown>>('mergeProgressMeta', JSON.stringify({ incomingMetaJson, existingMetaJson }))) ?? JSON.parse(incomingMetaJson);
}

import {
  coreBuildHomeCollectionShelves,
  coreBuildMetadataFeedOptions,
  coreComputeContinueWatchingBadges,
  coreDiscoverCatalogOptions,
  coreEffectiveMetadataFeedSelection,
  coreMergeContinueWatchingLists,
  coreResolveFeedOptionGenre,
} from './engine';
import { buildResourceUrl } from './addonManifest';
import { loadActiveProfile, loadAddons, loadLibrary, loadPrefs } from './libraryOps';
import { fetchVideosForSeries, runWithConcurrency } from './fetchPlanning';
import { tryFetchJson } from './httpClient';
import type { AddonDescriptor } from './types';

interface MetadataFeedOption {
  key: string;
  label: string;
  homeTitle?: string;
  transportUrl: string;
  type: string;
  id: string;
  genre?: string | null;
}

export interface DiscoverCatalogOption {
  key: string;
  label: string;
  transportUrl: string;
  type: string;
  id: string;
  genres?: string[];
  requiresGenre?: boolean;
}

async function metadataFeedOptions(addons: AddonDescriptor[]): Promise<MetadataFeedOption[]> {
  const options = ((await coreBuildMetadataFeedOptions(addons)) ?? []) as MetadataFeedOption[];
  const addonsJson = JSON.stringify(addons);
  return Promise.all(options.map(async (option) => {
    const genre = await coreResolveFeedOptionGenre(JSON.stringify(option), addonsJson);
    return { ...option, genre };
  }));
}

export async function discoverCatalogOptions(addons: AddonDescriptor[], selectedType: string): Promise<DiscoverCatalogOption[]> {
  return ((await coreDiscoverCatalogOptions(addons, selectedType)) ?? []) as DiscoverCatalogOption[];
}

export async function refreshReleasedContinueWatching(
  items: Record<string, unknown>[],
  library: Record<string, unknown>,
  addons: AddonDescriptor[],
): Promise<Record<string, unknown>[]> {
  // Fetch addon videos for every series candidate (I/O — must stay in platform)
  const lastWatched = (library.lastWatchedEpisodes as Record<string, unknown> | undefined) ?? {};
  const seriesIds = new Set<string>();
  for (const item of items) {
    if (item.type === 'series') seriesIds.add(String(item.id ?? item._id ?? ''));
  }
  for (const id of Object.keys(lastWatched)) seriesIds.add(id);

  const videosBySeriesId: Record<string, unknown[]> = {};
  const seriesIdList = [...seriesIds];
  const fetchedVideos = await runWithConcurrency(seriesIdList, 3, (id) => fetchVideosForSeries(id, addons));
  fetchedVideos.forEach((videos, index) => {
    if (videos.length > 0) videosBySeriesId[seriesIdList[index]] = videos;
  });

  // All decision logic lives in Rust
  const result = await coreComputeContinueWatchingBadges(
    JSON.stringify(items),
    JSON.stringify(videosBySeriesId),
    JSON.stringify(lastWatched),
    Date.now(),
  );
  return (result ?? []) as Record<string, unknown>[];
}

export async function readHomeBootstrap(
  payload: Record<string, unknown>,
): Promise<unknown> {
  const addons = await loadAddons();
  const library = await loadLibrary();
  const prefs = await loadPrefs();
  const language = (payload.language as string | undefined) ?? 'en';

  const localContinueWatching = (library.continueWatching as Record<string, unknown>[] | undefined) ?? [];
  const externalContinueWatching = (library.externalContinueWatching as Record<string, unknown>[] | undefined) ?? [];

  const progressMap = (library.progress as Record<string, unknown> | undefined) ?? {};
  const mergedCWRaw = await coreMergeContinueWatchingLists(
    JSON.stringify(localContinueWatching),
    JSON.stringify(externalContinueWatching),
    JSON.stringify(progressMap),
    prefs.syncCwSourceOfTruth as string | undefined,
    prefs.syncCwRanking as string | undefined,
  );
  const continueWatching = (mergedCWRaw ?? []) as Record<string, unknown>[];

  const metadataFeeds = await metadataFeedOptions(addons);
  const selectedKeys = prefs.homeFeedToggles as string[] | undefined;
  const availableKeys = metadataFeeds.map((feed) => feed.key);
  // [] means "all enabled" (same convention as isFeedEnabled in Settings).
  // Only call the Rust filter when there are explicit key selections; otherwise show all.
  const effectiveKeys = selectedKeys?.length
    ? ((await coreEffectiveMetadataFeedSelection(selectedKeys, availableKeys)) ?? availableKeys)
    : availableKeys;
  const visibleFeeds = metadataFeeds.filter((feed) => effectiveKeys.includes(feed.key));

  const categoryResults = await Promise.all(
    visibleFeeds.map(async (feed) => {
      const extraJson = feed.genre ? JSON.stringify({ genre: feed.genre }) : undefined;
      const url = await buildResourceUrl(feed.transportUrl, 'catalog', feed.type, feed.id, extraJson);
      const data = (await tryFetchJson(url)) as { metas?: unknown[] } | null;
      const metas = Array.isArray(data?.metas) ? data.metas : [];
      if (metas.length === 0) return null;
      return {
        id: feed.key,
        name: feed.homeTitle ?? feed.label,
        semanticName: feed.homeTitle ?? feed.label,
        type: feed.type,
        items: metas,
        addonName: feed.label.split(' - ')[0] ?? feed.label,
        transportUrl: feed.transportUrl,
        catalogId: feed.id,
      };
    }),
  );
  const categories = categoryResults.filter((c): c is NonNullable<typeof c> => c !== null);

  const profile = await loadActiveProfile();
  const collectionShelves = await coreBuildHomeCollectionShelves(
    JSON.stringify(profile ?? {}),
    JSON.stringify(addons),
  );
  const pinnedCollections = collectionShelves?.pinnedShelves ?? [];
  const regularCollections = collectionShelves?.regularShelves ?? [];
  const hiddenFolderCategories = collectionShelves?.hiddenFolderCategories ?? [];

  const allCategories = [...pinnedCollections, ...categories, ...regularCollections, ...hiddenFolderCategories];

  const billboard =
    categories.length > 0
      ? ((categories[0] as { items: unknown[] }).items[0] ?? null)
      : null;

  return { categories: allCategories, continueWatching, metadataFeeds, billboard };
}

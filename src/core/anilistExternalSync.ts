import { platformFetch } from './httpClient';
import { loadLibrary, saveLibrary, buildContinueWatching } from './libraryOps';
import { replaceExternalContinueWatching } from './externalSyncUtils';

type AniListMedia = {
  id?: number;
  title?: { romaji?: string | null; english?: string | null; native?: string | null };
  coverImage?: { large?: string | null; extraLarge?: string | null };
  bannerImage?: string | null;
  episodes?: number | null;
  seasonYear?: number | null;
  genres?: string[] | null;
};

type AniListEntry = {
  status?: string | null;
  progress?: number | null;
  updatedAt?: number | null;
  media?: AniListMedia | null;
};

type AniListCollectionResponse = {
  MediaListCollection?: {
    lists?: Array<{ entries?: AniListEntry[] | null }> | null;
  } | null;
};

type LibraryItemRecord = Record<string, unknown>;

const ANILIST_COLLECTION_QUERY = `
  query ($userId: Int) {
    MediaListCollection(userId: $userId, type: ANIME) {
      lists {
        entries {
          status
          progress
          updatedAt
          media {
            id
            title { romaji english native }
            coverImage { large extraLarge }
            bannerImage
            episodes
            seasonYear
            genres
          }
        }
      }
    }
  }
`;

const ANILIST_VIEWER_QUERY = `query { Viewer { id } }`;

export async function syncAniListNow(payload: Record<string, unknown>): Promise<unknown> {
  const token = typeof payload.token === 'string' ? payload.token : undefined;
  if (!token) return { synced: false, error: 'AniList is not connected' };

  const viewer = await anilistGraphql<{ Viewer?: { id?: number } }>(ANILIST_VIEWER_QUERY, {}, token);
  const userId = viewer?.Viewer?.id;
  if (!userId) return { synced: false, error: 'AniList account could not be loaded' };

  const data = await anilistGraphql<AniListCollectionResponse>(ANILIST_COLLECTION_QUERY, { userId }, token);
  const entries = (data?.MediaListCollection?.lists ?? [])
    .flatMap((list) => list.entries ?? [])
    .filter((entry): entry is AniListEntry => Boolean(entry?.media?.id));

  const watchlist: LibraryItemRecord[] = [];
  const completed: LibraryItemRecord[] = [];
  const dropped: LibraryItemRecord[] = [];
  const watching: LibraryItemRecord[] = [];
  const watched: Record<string, boolean> = {};
  const progress: Record<string, unknown> = {};

  for (const entry of entries) {
    const item = anilistEntryToLibraryItem(entry);
    if (!item) continue;
    const id = String(item.id);
    const status = String(entry.status ?? '').toUpperCase();
    const progressEpisode = Math.max(0, Math.floor(Number(entry.progress ?? 0)));

    if (status === 'PLANNING') {
      watchlist.push({ ...item, inWatchlist: true });
    } else if (status === 'COMPLETED') {
      completed.push({ ...item, statusChangedAt: anilistUpdatedAt(entry) });
      markWatchedThrough(watched, id, progressEpisode || Number(entry.media?.episodes ?? 0));
    } else if (status === 'DROPPED' || status === 'PAUSED') {
      dropped.push({ ...item, statusChangedAt: anilistUpdatedAt(entry) });
      markWatchedThrough(watched, id, progressEpisode);
    } else if ((status === 'CURRENT' || status === 'REPEATING') && progressEpisode > 0) {
      watching.push({
        ...item,
        lastVideoId: `${id}:1:${progressEpisode}`,
        lastEpisodeSeason: 1,
        lastEpisodeNumber: progressEpisode,
        lastEpisodeName: `Episode ${progressEpisode}`,
        timeOffset: 1,
        duration: 1,
      });
      progress[id] = {
        meta: item,
        lastVideoId: `${id}:1:${progressEpisode}`,
        lastEpisodeSeason: 1,
        lastEpisodeNumber: progressEpisode,
        lastEpisodeName: `Episode ${progressEpisode}`,
        timeOffset: 1,
        duration: 1,
        savedAt: anilistUpdatedAt(entry),
      };
      markWatchedThrough(watched, id, progressEpisode);
    }
  }

  const lib = await loadLibrary();
  lib.watchlist = mergeById((lib.watchlist as LibraryItemRecord[] | undefined) ?? [], watchlist);
  lib.completed = mergeById((lib.completed as LibraryItemRecord[] | undefined) ?? [], completed);
  lib.dropped = mergeById((lib.dropped as LibraryItemRecord[] | undefined) ?? [], dropped);
  lib.watched = { ...((lib.watched as Record<string, boolean> | undefined) ?? {}), ...watched };
  lib.progress = { ...((lib.progress as Record<string, unknown> | undefined) ?? {}), ...progress };
  lib.continueWatching = await buildContinueWatching(lib.progress as Record<string, unknown>);
  await saveLibrary(lib);
  await replaceExternalContinueWatching({ provider: 'anilist', items: watching });

  return {
    synced: true,
    provider: 'anilist',
    continueWatchingCount: watching.length,
    watchlistCount: watchlist.length,
    completedCount: completed.length,
    droppedCount: dropped.length,
  };
}

export async function pushWatchlistAniList(
  id: string,
  command: 'add' | 'remove',
  token: string,
): Promise<void> {
  const anilistId = parseAniListId(id);
  if (!anilistId) return;
  if (command === 'remove') {
    await deleteAniListEntry(anilistId, token);
    return;
  }
  await setAniListStatus(anilistId, 'PLANNING', token);
}

export async function pushLibraryStatusAniList(
  id: string,
  list: string,
  command: 'add' | 'remove',
  token: string,
): Promise<void> {
  const anilistId = parseAniListId(id);
  if (!anilistId) return;
  if (command === 'remove') {
    await setAniListStatus(anilistId, 'CURRENT', token);
    return;
  }
  if (list === 'completed') {
    await setAniListStatus(anilistId, 'COMPLETED', token);
  } else if (list === 'dropped') {
    await setAniListStatus(anilistId, 'DROPPED', token);
  }
}

async function setAniListStatus(anilistId: number, status: string, token: string): Promise<void> {
  await anilistGraphql(`
    mutation ($mediaId: Int, $status: MediaListStatus) {
      SaveMediaListEntry(mediaId: $mediaId, status: $status) { id status }
    }
  `, { mediaId: anilistId, status }, token);
}

async function deleteAniListEntry(anilistId: number, token: string): Promise<void> {
  const viewer = await anilistGraphql<{ Viewer?: { id?: number } }>(ANILIST_VIEWER_QUERY, {}, token);
  const userId = viewer?.Viewer?.id;
  if (!userId) return;
  const entry = await anilistGraphql<{ MediaList?: { id?: number } }>(
    `query ($mediaId: Int, $userId: Int) { MediaList(mediaId: $mediaId, userId: $userId) { id } }`,
    { mediaId: anilistId, userId },
    token,
  );
  const entryId = entry?.MediaList?.id;
  if (!entryId) return;
  await anilistGraphql(`mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }`, { id: entryId }, token);
}

async function anilistGraphql<T>(query: string, variables: Record<string, unknown>, token: string): Promise<T | null> {
  const res = await platformFetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json() as { data?: T; errors?: Array<{ message?: string }> };
  if (!res.ok || json.errors?.length) {
    throw new Error(json.errors?.map((e) => e.message).filter(Boolean).join('; ') || `AniList request failed: HTTP ${res.status}`);
  }
  return json.data ?? null;
}

function anilistEntryToLibraryItem(entry: AniListEntry): LibraryItemRecord | null {
  const media = entry.media;
  if (!media?.id) return null;
  const title = media.title?.english?.trim() || media.title?.romaji?.trim() || media.title?.native?.trim() || `AniList ${media.id}`;
  return {
    id: `anilist:${media.id}`,
    name: title,
    type: 'series',
    poster: media.coverImage?.extraLarge ?? media.coverImage?.large ?? undefined,
    background: media.bannerImage ?? undefined,
    year: media.seasonYear ?? undefined,
    genres: media.genres ?? undefined,
    anilistId: media.id,
    totalEpisodes: media.episodes ?? undefined,
  };
}

function markWatchedThrough(watched: Record<string, boolean>, id: string, progressEpisode: number): void {
  if (!progressEpisode || progressEpisode < 1) return;
  for (let ep = 1; ep <= progressEpisode; ep += 1) {
    watched[`${id}:1:${ep}`] = true;
  }
}

function mergeById(local: LibraryItemRecord[], incoming: LibraryItemRecord[]): LibraryItemRecord[] {
  const map = new Map<string, LibraryItemRecord>();
  for (const item of local) map.set(String(item.id), item);
  for (const item of incoming) map.set(String(item.id), { ...(map.get(String(item.id)) ?? {}), ...item });
  return [...map.values()];
}

function anilistUpdatedAt(entry: AniListEntry): string {
  const seconds = Number(entry.updatedAt ?? 0);
  return new Date(seconds > 0 ? seconds * 1000 : Date.now()).toISOString();
}

function parseAniListId(id: string): number | null {
  const match = id.match(/^anilist:(\d+)/i);
  return match ? Number(match[1]) : null;
}

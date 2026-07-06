import { platformFetch } from './httpClient';
import { loadLibrary, saveLibrary, buildContinueWatching } from './libraryOps';
import { replaceExternalContinueWatching } from './externalSyncUtils';
import { coreAnilistEntriesToSync, coreMergeLibraryItemsById } from './engine';

type AniListEntry = {
  media?: { id?: number } | null;
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

  const plan = await coreAnilistEntriesToSync(entries, Date.now());
  if (!plan) return { synced: false, error: 'AniList entries could not be processed' };

  const lib = await loadLibrary();
  lib.watchlist = await coreMergeLibraryItemsById((lib.watchlist as LibraryItemRecord[] | undefined) ?? [], plan.watchlist);
  lib.completed = await coreMergeLibraryItemsById((lib.completed as LibraryItemRecord[] | undefined) ?? [], plan.completed);
  lib.dropped = await coreMergeLibraryItemsById((lib.dropped as LibraryItemRecord[] | undefined) ?? [], plan.dropped);
  lib.watched = { ...((lib.watched as Record<string, boolean> | undefined) ?? {}), ...plan.watched };
  lib.progress = { ...((lib.progress as Record<string, unknown> | undefined) ?? {}), ...plan.progress };
  lib.continueWatching = await buildContinueWatching(lib.progress as Record<string, unknown>);
  await saveLibrary(lib);
  await replaceExternalContinueWatching({ provider: 'anilist', items: plan.watching });

  return {
    synced: true,
    provider: 'anilist',
    continueWatchingCount: plan.watching.length,
    watchlistCount: plan.watchlist.length,
    completedCount: plan.completed.length,
    droppedCount: plan.dropped.length,
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

function parseAniListId(id: string): number | null {
  const match = id.match(/^anilist:(\d+)/i);
  return match ? Number(match[1]) : null;
}

import { invoke } from '@tauri-apps/api/core';
import { coreParseVideoId } from './engine';
import { dropTraktPlaybackProgress } from './traktSync';
import { syncTraktNow, pushMarkWatchedTrakt, pushWatchlistTrakt } from './traktExternalSync';
import { syncSimklNow, pushMarkWatchedSimkl, pushWatchlistSimkl } from './simklExternalSync';
import { pushAnimeTrackingExternal } from './animeExternalSync';
import { pushLibraryStatusAniList, pushWatchlistAniList, syncAniListNow } from './anilistExternalSync';
import { nuvioDeleteWatchProgress, nuvioPushWatchHistory, nuvioPushWatchProgress, nuvioRefreshToken } from './nuvioApi';
import { saveProfile } from './profiles';
import type { UserProfile } from './types';

export { enqueueTraktScrobble } from './traktSync';
export { replaceExternalContinueWatching } from './externalSyncUtils';

export type WatchedEpisodeInfo = {
  contentId: string;
  contentType: string;
  season?: number;
  episode?: number;
  title?: string;
};

export type WatchProgressInfo = {
  contentId: string;
  contentType: string;
  videoId: string;
  positionSeconds: number;
  durationSeconds: number;
  lastWatched: number;
  season?: number;
  episode?: number;
};

async function getOAuthClientId(service: string): Promise<string> {
  try {
    return await invoke<string>('get_oauth_client_id', { service });
  } catch {
    return '';
  }
}

function isAuthFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\b(401|403)\b|JWT|token|expired/i.test(message);
}

async function refreshNuvioProfile(profile: UserProfile): Promise<UserProfile> {
  if (!profile.nuvioRefreshToken) return profile;
  const session = await nuvioRefreshToken(profile.nuvioRefreshToken);
  const updated: UserProfile = {
    ...profile,
    nuvioAccessToken: session.access_token,
    nuvioRefreshToken: session.refresh_token ?? profile.nuvioRefreshToken,
    nuvioTokenExpiresAt: Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600),
    nuvioUserId: session.user?.id ?? profile.nuvioUserId,
  };
  await saveProfile(updated);
  return updated;
}

async function validNuvioProfile(profile: UserProfile): Promise<UserProfile> {
  if (!profile.nuvioAccessToken || !profile.nuvioRefreshToken) return profile;
  const expiresAt = profile.nuvioTokenExpiresAt ?? 0;
  if (expiresAt > Math.floor(Date.now() / 1000) + 60) return profile;
  return refreshNuvioProfile(profile);
}

export async function pushMarkWatchedExternal(
  videoIds: string[],
  watched: boolean,
  meta: Record<string, unknown> | undefined,
  profile: UserProfile | null,
  episodeInfo?: WatchedEpisodeInfo | WatchedEpisodeInfo[],
  progressInfo?: WatchProgressInfo,
): Promise<void> {
  if (!profile) return;
  const tasks: Promise<void>[] = [];

  if (profile.traktAccessToken && !(profile.traktTokenExpiresAt && Date.now() / 1000 > profile.traktTokenExpiresAt)) {
    tasks.push((async () => {
      const clientId = await getOAuthClientId('trakt');
      await pushMarkWatchedTrakt(videoIds, watched, profile.traktAccessToken!, clientId);
    })().catch(() => undefined));
  }

  if (profile.simklAccessToken) {
    tasks.push((async () => {
      const clientId = await getOAuthClientId('simkl');
      await pushMarkWatchedSimkl(videoIds, watched, meta, profile.simklAccessToken!, clientId);
    })().catch(() => undefined));
  }

  if (profile.anilistAccessToken && watched) {
    const animeEpisodeInfo = Array.isArray(episodeInfo) ? episodeInfo[episodeInfo.length - 1] : episodeInfo;
    tasks.push(pushAnimeTrackingExternal({
      meta,
      episode: animeEpisodeInfo,
      progressEpisode: progressInfo?.episode ?? animeEpisodeInfo?.episode,
      watched,
    }, profile).catch(() => undefined));
  }

  const nuvioEpisodes = (Array.isArray(episodeInfo) ? episodeInfo : episodeInfo ? [episodeInfo] : [])
    .filter((info) => info.contentId);
  if (profile.nuvioAccessToken && watched) {
    tasks.push((async () => {
      let nuvioProfile = await validNuvioProfile(profile);
      const push = async () => {
        const token = nuvioProfile.nuvioAccessToken!;
        const profileIdx = nuvioProfile.nuvioProfileIndex ?? 1;
        if (nuvioEpisodes.length > 0) {
          await Promise.all(nuvioEpisodes.map((info) =>
            nuvioDeleteWatchProgress(token, profileIdx, info.contentId, info.season, info.episode).catch(() => undefined),
          ));
          const watchedAt = Date.now();
          await nuvioPushWatchHistory(
            token,
            profileIdx,
            nuvioEpisodes.map((info) => ({
              content_id: info.contentId,
              content_type: info.contentType,
              title: info.title ?? '',
              season: info.season,
              episode: info.episode,
              watched_at: watchedAt,
            })),
          );
        }
        if (progressInfo?.contentId && progressInfo.videoId && progressInfo.durationSeconds > 0) {
          await nuvioPushWatchProgress(token, profileIdx, [{
            content_id: progressInfo.contentId,
            content_type: progressInfo.contentType,
            video_id: progressInfo.videoId,
            position: Math.round(progressInfo.positionSeconds * 1000),
            duration: Math.round(progressInfo.durationSeconds * 1000),
            last_watched: progressInfo.lastWatched,
            season: progressInfo.season,
            episode: progressInfo.episode,
          }]);
        }
      };
      try {
        await push();
      } catch (err) {
        if (!isAuthFailure(err)) throw err;
        nuvioProfile = await refreshNuvioProfile(nuvioProfile);
        await push();
      }
    })().catch(() => undefined));
  }

  await Promise.all(tasks);
}

export async function pushWatchlistExternal(
  item: Record<string, unknown>,
  command: 'add' | 'remove',
  profile: UserProfile | null,
): Promise<void> {
  if (!profile) return;
  const id = String(item.id ?? '');
  const contentType = String(item.type ?? 'movie');
  const tasks: Promise<void>[] = [];

  if (profile.traktAccessToken && !(profile.traktTokenExpiresAt && Date.now() / 1000 > profile.traktTokenExpiresAt)) {
    tasks.push((async () => {
      const clientId = await getOAuthClientId('trakt');
      await pushWatchlistTrakt(id, contentType, command, profile.traktAccessToken!, clientId);
    })().catch(() => undefined));
  }

  if (profile.simklAccessToken && command === 'add') {
    tasks.push((async () => {
      const clientId = await getOAuthClientId('simkl');
      const parsed = await coreParseVideoId(id);
      await pushWatchlistSimkl(id, contentType, parsed, profile.simklAccessToken!, clientId);
    })().catch(() => undefined));
  }

  if (profile.anilistAccessToken) {
    tasks.push(pushWatchlistAniList(id, command, profile.anilistAccessToken).catch(() => undefined));
  }

  await Promise.all(tasks);
}

export async function pushLibraryStatusExternal(
  item: Record<string, unknown>,
  list: string,
  command: 'add' | 'remove',
  profile: UserProfile | null,
): Promise<void> {
  if (!profile?.anilistAccessToken) return;
  const id = String(item.id ?? '');
  await pushLibraryStatusAniList(id, list, command, profile.anilistAccessToken).catch(() => undefined);
}

export async function dropExternalPlaybackProgress(item: Record<string, unknown>): Promise<void> {
  const reason = String(item.reason ?? '').toLowerCase();
  const id = String(item.id ?? '');
  if (!id) return;
  if (reason === 'trakt') {
    await dropTraktPlaybackProgress(id);
  }
  // Simkl: no playback progress API — local removal is sufficient.
}

export async function syncExternalIntegrationNow(payload: Record<string, unknown>): Promise<unknown> {
  const provider = String(payload.provider ?? 'trakt').toLowerCase();
  if (provider === 'anilist') return syncAniListNow(payload);
  if (provider === 'simkl') return syncSimklNow(payload);
  if (provider === 'trakt') return syncTraktNow(payload);
  return { synced: false, error: `Unsupported external sync provider: ${provider}` };
}

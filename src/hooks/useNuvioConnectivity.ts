import { useState, useEffect, useCallback } from 'react';
import { nuvioHealthCheck, nuvioPushWatchProgress, nuvioPushLibrary, nuvioPushWatchHistory } from '../core/nuvioApi';
import { loadLibrary } from '../core/libraryOps';
import { freshNuvioProfile, importNuvioProfileData } from '../core/nuvioSync';
import type { UserProfile } from '../core/types';

async function pushLocalToNuvio(profile: UserProfile): Promise<void> {
  const freshProfile = await freshNuvioProfile(profile).catch(() => profile);
  const token = freshProfile.nuvioAccessToken!;
  const profileIdx = freshProfile.nuvioProfileIndex ?? 1;
  const lib = await loadLibrary();

  const progressMap = (lib.progress as Record<string, Record<string, unknown>> | undefined) ?? {};
  const progressEntries = Object.entries(progressMap)
    .map(([contentId, e]) => {
      const meta = e.meta as { type?: string } | undefined;
      const timeOffset = Number(e.timeOffset ?? 0);
      const duration = Number(e.duration ?? 0);
      if (duration <= 0) return null;
      const videoId = e.lastVideoId ? String(e.lastVideoId) : contentId;
      return {
        content_id: contentId,
        content_type: String(meta?.type ?? 'movie'),
        video_id: videoId,
        position: Math.round(timeOffset * 1000),
        duration: Math.round(duration * 1000),
        last_watched: e.savedAt ? new Date(String(e.savedAt)).getTime() : Date.now(),
        season: e.lastEpisodeSeason != null ? Number(e.lastEpisodeSeason) : undefined,
        episode: e.lastEpisodeNumber != null ? Number(e.lastEpisodeNumber) : undefined,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  const watchlist = (lib.watchlist as Array<Record<string, unknown>> | undefined) ?? [];
  const libraryItems = watchlist
    .map((item) => ({
      content_id: String(item.id ?? ''),
      content_type: String(item.type ?? 'movie'),
      name: String(item.name ?? ''),
      poster: (item.poster as string | undefined) ?? null,
      background: (item.background as string | undefined) ?? null,
    }))
    .filter((i) => i.content_id);

  const watchedMap = (lib.watched as Record<string, boolean> | undefined) ?? {};
  const historyItems = Object.keys(watchedMap).map((videoId) => {
    const parts = videoId.split(':');
    const isSeries = parts.length === 3;
    return {
      content_id: parts[0],
      content_type: isSeries ? 'series' : 'movie',
      title: '',
      season: isSeries ? Number(parts[1]) : undefined,
      episode: isSeries ? Number(parts[2]) : undefined,
      watched_at: Date.now(),
    };
  });

  await Promise.allSettled([
    progressEntries.length > 0 ? nuvioPushWatchProgress(token, profileIdx, progressEntries) : Promise.resolve(),
    libraryItems.length > 0 ? nuvioPushLibrary(token, profileIdx, libraryItems) : Promise.resolve(),
    historyItems.length > 0 ? nuvioPushWatchHistory(token, profileIdx, historyItems) : Promise.resolve(),
  ]);
}

export function useNuvioConnectivity(activeProfile: UserProfile | null, onSynced?: () => void | Promise<void>) {
  const [serverDown, setServerDown] = useState(false);
  const [justRecovered, setJustRecovered] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const token = activeProfile?.nuvioAccessToken;
    if (!token) {
      setServerDown(false);
      return;
    }

    const profile = activeProfile!;
    let cancelled = false;
    let isCurrentlyDown = false;
    let pulledRemote = false;
    let timer: ReturnType<typeof setTimeout>;

    const run = async () => {
      if (cancelled) return;
      let down = isCurrentlyDown;
      try {
        const result = await nuvioHealthCheck();
        down = result?.status !== 'healthy' && result?.status !== 'ok';
      } catch {
        down = true;
      }
      if (cancelled) return;

      if (down && !isCurrentlyDown) {
        isCurrentlyDown = true;
        setDismissed(false);
        setServerDown(true);
        setJustRecovered(false);
      } else if (!down && isCurrentlyDown) {
        isCurrentlyDown = false;
        setServerDown(false);
        setJustRecovered(true);
        setDismissed(false);
        setTimeout(() => { if (!cancelled) setJustRecovered(false); }, 2000);
        void (async () => {
          await importNuvioProfileData(profile).catch(() => undefined);
          await pushLocalToNuvio(profile).catch(() => undefined);
          await onSynced?.();
        })();
      } else if (!down && !pulledRemote) {
        pulledRemote = true;
        void (async () => {
          await importNuvioProfileData(profile).catch(() => undefined);
          await onSynced?.();
        })();
      }

      timer = setTimeout(run, isCurrentlyDown ? 30_000 : 60_000);
    };

    void run();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeProfile?.nuvioAccessToken, activeProfile?.id, onSynced]);

  const dismiss = useCallback(() => setDismissed(true), []);

  return { serverDown, justRecovered, dismissed, dismiss };
}

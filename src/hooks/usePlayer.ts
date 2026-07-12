import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import * as Sentry from '@sentry/react';
import { dispatchAction, coreDetectAnimePlayback, corePlaybackIntroLookupContentId, corePlaybackPreparePlan, coreResolveNextEpisode, coreCanPrefetchNextEpisode, coreSelectNextEpisodeStream, coreTorrentStatusInfo } from '../core/engine';

function debugLog(msg: string) {
  void invoke('debug_log', { msg }).catch(() => {});
}
import {
  type EmbeddedMpvStatus,
  embeddedMpvAddSubtitle,
  embeddedMpvApplyPreferences,
  embeddedMpvSetHttpHeaders,
  destroyEmbeddedMpv,
  embeddedMpvLoad,
  embeddedMpvHide,
  embeddedMpvShowLoading,
  embeddedMpvSetLoadingArtwork,
  embeddedMpvSetTitle,
  embeddedMpvStatus,
  embeddedMpvStop,
  prefetchPlayerArtwork,
  initEmbeddedMpv,
  playerClearChapters,
  playerClearEpisodes,
  playerClearSkipInfo,
  playerSetEpisodes,
  playerSetSkipInfo,
  playerTorrentStats,
  startTorrentStream,
  stopTorrentStream,
} from '../core/mpvPlayer';
import { fetchPlaybackSkipSegments, fetchStreamsForEpisode, fetchMetaVideos, pumpEffects } from '../core/effectRunner';
import { fetchContentLogo } from '../core/detailEffects';
import { appPrefs, prefBool, prefString } from '../core/appPrefs';
import { getLanguage, t } from '../i18n';
import {
  playerDisplayTitle,
  playerArtwork,
  formatNextEpisodeSubtitle,
  isEpisodeReleasedForPlayback,
  withCloseTimeout,
} from '../core/playerUtils';
import type { PlayerDisplayTitle, PlayerArtwork, PlaybackPreparePlan } from '../core/playerUtils';
import { traktScrobbleOnClose, simklScrobbleOnClose } from '../core/scrobble';
import { saveProfile } from '../core/profiles';
import { resolvePlaybackSubtitles } from '../core/subtitles';
import type { ResolvedSubtitles } from '../core/subtitles';
import { persistLastPlaybackSource } from '../core/libraryStorage';
import type { AppState, Meta, Video, Stream, AddonDescriptor, UserProfile } from '../core/types';
import { usePlayerNativeEvents } from './usePlayerNativeEvents';

export type PlayerLoadingOverlayState = {
  background?: string | null;
  logo?: string | null;
  title?: string;
  episodeLine?: string;
  status?: string;
  error?: string | null;
  source?: {
    title?: string;
    addon?: string;
    filename?: string;
    fileIdx?: number;
    infoHash?: string;
    sources?: string[];
  };
};

interface UsePlayerOptions {
  stateRef: React.MutableRefObject<AppState>;
  activeProfile: UserProfile | null;
  updateState: (s: Partial<AppState>) => void;
  onProfileUpdated?: (profile: UserProfile) => void;
  onEpisodePlaybackFailed?: (meta: Meta, episode: Video, message: string) => Promise<void> | void;
}

interface UsePlayerResult {
  playerLoadingOverlay: PlayerLoadingOverlayState | null;
  playerUrl: string | null;
  playerTitle: string | undefined;
  playerEpisodeTitle: string | undefined;
  playerEpisode: Video | null;
  playerUsesTorrent: boolean;
  playerPosterUrl: string | undefined;
  playerLogoUrl: string | undefined;
  playerMetaId: string | undefined;
  playerSubtitleUrl: string | undefined;
  playerStreamHeaders: Record<string, string> | undefined;
  playerPlaybackError: string | null;
  playerSubtitleWarning: string[] | null;
  dismissSubtitleWarning: () => void;
  handlePlay: (stream: Stream, meta?: Meta, episode?: Video | null, resumeAtSeconds?: number, totalDurationSeconds?: number, sourceCandidates?: Stream[], openSourcePickerOnFailure?: boolean) => Promise<void>;
  closePlayer: () => Promise<void>;
  notifyFirstFrame: () => void;
  flushProgressOnQuit: () => Promise<void>;
}

function streamKey(stream: Stream | null | undefined): string {
  if (!stream) return '';
  return [
    stream.url ?? '',
    stream.playableUrl ?? '',
    stream.infoHash ?? '',
    stream.fileIdx ?? '',
    stream.title ?? '',
    stream.name ?? '',
  ].join('|');
}

function streamIsP2P(stream: Stream): boolean {
  return !!(stream.isTorrent || stream.infoHash);
}

function streamRequestHeaders(stream: Stream): Record<string, string> | undefined {
  const headers = stream.behaviorHints?.requestHeaders ?? stream.behaviorHints?.proxyHeaders?.request;
  if (!headers || Object.keys(headers).length === 0) return undefined;
  return headers;
}

export function usePlayer({ stateRef, activeProfile, updateState, onProfileUpdated, onEpisodePlaybackFailed }: UsePlayerOptions): UsePlayerResult {
  const [playerUrl, setPlayerUrl] = useState<string | null>(null);
  const [playerTitle, setPlayerTitle] = useState<string | undefined>();
  const [playerEpisodeTitle, setPlayerEpisodeTitle] = useState<string | undefined>();
  const [playerEpisode, setPlayerEpisode] = useState<Video | null>(null);
  const [playerPosterUrl, setPlayerPosterUrl] = useState<string | undefined>();
  const [playerLogoUrl, setPlayerLogoUrl] = useState<string | undefined>();
  const [playerMetaId, setPlayerMetaId] = useState<string | undefined>();
  const [playerSubtitleUrl, setPlayerSubtitleUrl] = useState<string | undefined>();
  const [playerStreamHeaders, setPlayerStreamHeaders] = useState<Record<string, string> | undefined>();
  const [playerUsesTorrent, setPlayerUsesTorrent] = useState(false);
  const [playerLoadingOverlay, setPlayerLoadingOverlay] = useState<PlayerLoadingOverlayState | null>(null);
  const [playerPlaybackError, setPlayerPlaybackError] = useState<string | null>(null);
  const [playerSubtitleWarning, setPlayerSubtitleWarning] = useState<string[] | null>(null);

  const activeProfileRef = useRef<UserProfile | null>(null);
  const mpvInitializedRef = useRef(false);
  const closingPlayerRef = useRef(false);
  const playGenerationRef = useRef(0);
  const artworkPrefetchRef = useRef<Promise<unknown> | null>(null);
  const inNativePlayerRef = useRef(false);
  const pendingArtworkRef = useRef<PlayerArtwork | null>(null);
  const playingMetaRef = useRef<Meta | null>(null);
  const playingEpisodeRef = useRef<Video | null>(null);
  const playingStreamRef = useRef<Stream | null>(null);
  const playingSourceCandidatesRef = useRef<Stream[]>([]);
  const attemptedSourceKeysRef = useRef<Set<string>>(new Set());
  const lastResumeAtSecondsRef = useRef<number | undefined>(undefined);
  const lastTotalDurationSecondsRef = useRef<number | undefined>(undefined);
  const playingNextEpisodeRef = useRef<Video | null>(null);
  const prefetchedNextEpRef = useRef<{ episodeId: string; stream: Stream } | null>(null);
  const playerUsesTorrentRef = useRef(false);
  const lastPlaybackStatusRef = useRef<EmbeddedMpvStatus | null>(null);
  const openSourcePickerOnFailureRef = useRef(false);
  const firstFrameHandoffPendingRef = useRef(false);

  const playerLoadingOverlayRef = useRef<PlayerLoadingOverlayState | null>(null);

  useEffect(() => { activeProfileRef.current = activeProfile; }, [activeProfile]);
  useEffect(() => { playerUsesTorrentRef.current = playerUsesTorrent; }, [playerUsesTorrent]);
  useEffect(() => { playerLoadingOverlayRef.current = playerLoadingOverlay; }, [playerLoadingOverlay]);

  const setLoadingStatus = useCallback((status: string) => {
    setPlayerLoadingOverlay((prev) => (prev ? { ...prev, status } : prev));
  }, []);

  const failPlayerLoading = useCallback(async (message: string) => {
    ++playGenerationRef.current;
    const shouldStopTorrent = playerUsesTorrentRef.current;
    setPlayerUrl(null);
    setPlayerSubtitleUrl(undefined);
    setPlayerStreamHeaders(undefined);
    setPlayerUsesTorrent(false);
    setPlayerPlaybackError(null);
    inNativePlayerRef.current = false;
    setPlayerLoadingOverlay((prev) => {
      if (prev) return { ...prev, error: message };
      const stream = playingStreamRef.current ?? undefined;
      const title = playerDisplayTitle(playingMetaRef.current ?? undefined, playingEpisodeRef.current, stream);
      const artwork = pendingArtworkRef.current ?? playerArtwork(playingMetaRef.current ?? undefined, playingEpisodeRef.current);
      return {
        background: artwork.background,
        logo: artwork.logo,
        title: title.contentTitle,
        episodeLine: title.episodeLine,
        error: message,
        source: stream ? {
          title: stream.name ?? stream.title ?? stream.description,
          addon: stream.addonName,
          filename: stream.behaviorHints?.filename,
          fileIdx: stream.fileIdx,
          infoHash: stream.infoHash,
          sources: stream.sources,
        } : undefined,
      };
    });
    await embeddedMpvHide().catch(() => undefined);
    await embeddedMpvStop().catch(() => undefined);
    if (shouldStopTorrent) await stopTorrentStream().catch(() => false);
  }, []);

  const nextRetrySource = useCallback((currentStream: Stream | null, force: boolean = false): Stream | null => {
    const prefs = appPrefs(stateRef.current);
    if (!force && !prefBool(prefs, 'autoRetryNextSource', false)) return null;
    const candidates = playingSourceCandidatesRef.current;
    if (candidates.length < 2 || !currentStream) return null;

    const currentKey = streamKey(currentStream);
    const bingeGroup = prefBool(prefs, 'tryBingeGroup', false)
      ? currentStream.behaviorHints?.bingeGroup?.trim()
      : undefined;
    if (currentKey) attemptedSourceKeysRef.current.add(currentKey);
    const startIndex = Math.max(0, candidates.findIndex((candidate) => streamKey(candidate) === currentKey));
    const p2pEnabled = prefBool(prefs, 'p2pEnabled', true);

    for (let offset = 1; offset <= candidates.length; offset += 1) {
      const candidate = candidates[(startIndex + offset) % candidates.length];
      const key = streamKey(candidate);
      if (!key || attemptedSourceKeysRef.current.has(key)) continue;
      if (bingeGroup && candidate.behaviorHints?.bingeGroup !== bingeGroup) continue;
      if (!p2pEnabled && streamIsP2P(candidate)) {
        attemptedSourceKeysRef.current.add(key);
        continue;
      }
      attemptedSourceKeysRef.current.add(key);
      return candidate;
    }
    return null;
  }, [stateRef]);

  const showPlayerLoading = useCallback((
    generation: number,
    title: PlayerDisplayTitle,
    artwork: PlayerArtwork,
    stream: Stream,
  ): Promise<unknown> => {
    const isCancelled = () => playGenerationRef.current !== generation;
    setPlayerTitle(title.contentTitle);
    setPlayerEpisodeTitle(title.episodeLine ?? undefined);
    pendingArtworkRef.current = artwork;
    setPlayerLoadingOverlay({
      background: artwork.background,
      logo: artwork.logo,
      title: title.contentTitle,
      episodeLine: title.episodeLine,
      status: t('player.status_preparing'),
      source: {
        title: stream.name ?? stream.title ?? stream.description,
        addon: stream.addonName,
        filename: stream.behaviorHints?.filename,
        fileIdx: stream.fileIdx,
        infoHash: stream.infoHash,
        sources: stream.sources,
      },
    });

    if (!inNativePlayerRef.current) {
      return Promise.resolve();
    }

    if (!isCancelled()) {
      void embeddedMpvSetLoadingArtwork(
        title.contentTitle ?? 'Fluxa',
        title.episodeLine,
        artwork.background,
        artwork.logo,
      ).catch(() => undefined);
    }
    const ready = (async () => {
      if (isCancelled()) return;
      await embeddedMpvShowLoading(title.contentTitle, title.episodeLine);
    })();
    return ready;
  }, []);

  const playInEmbeddedMpv = useCallback(async (
    generation: number,
    url: string,
    title: PlayerDisplayTitle | undefined,
    usesTorrent: boolean,
    subtitlesPromise: Promise<ResolvedSubtitles>,
    artworkPromise: Promise<unknown> | undefined,
    resumeAtSeconds?: number,
    totalDurationSeconds?: number,
    httpHeaders?: Record<string, string>,
    isAnimePlayback?: boolean,
  ) => {
    const isCancelled = () => playGenerationRef.current !== generation;
    if (isCancelled()) return;
    if (!usesTorrent && playerUsesTorrentRef.current) {
      await stopTorrentStream().catch(() => false);
    }
    setPlayerTitle(title?.contentTitle);
    setPlayerUrl(url);
    setPlayerUsesTorrent(usesTorrent);
    if (!mpvInitializedRef.current) {
      await initEmbeddedMpv();
      mpvInitializedRef.current = true;
    }
    if (isCancelled()) return;
    const prefs = appPrefs(stateRef.current);
    await embeddedMpvApplyPreferences({ ...prefs, isTorrentPlayback: usesTorrent, isAnimePlayback: !!isAnimePlayback }).catch(() => undefined);
    await embeddedMpvSetTitle(title?.contentTitle, title?.episodeLine).catch(() => undefined);
    if (isCancelled()) return;
    if (!inNativePlayerRef.current) {
      if (artworkPrefetchRef.current) {
        await Promise.race([artworkPrefetchRef.current, new Promise<void>((r) => setTimeout(r, 2000))]);
      }
      if (isCancelled()) return;
      inNativePlayerRef.current = true;
      // Don't clear the loading overlay yet — keep it visible until the first video
      // frame arrives (notifyFirstFrame() does the actual clear via ReactPlayerOverlay).
      await embeddedMpvShowLoading(title?.contentTitle ?? 'Fluxa', title?.episodeLine);
      void embeddedMpvSetLoadingArtwork(
        title?.contentTitle ?? 'Fluxa',
        title?.episodeLine,
        pendingArtworkRef.current?.background,
        pendingArtworkRef.current?.logo,
      ).catch(() => undefined);
      if (isCancelled()) return;
    } else if (artworkPromise) {
      await Promise.race([artworkPromise, new Promise<void>((r) => setTimeout(r, 2000))]);
      if (isCancelled()) return;
    }
    await embeddedMpvSetHttpHeaders(httpHeaders).catch(() => undefined);
    await embeddedMpvLoad(url, resumeAtSeconds, totalDurationSeconds);
    const { subtitles, failedAddons } = await subtitlesPromise.catch(() => ({ subtitles: [], failedAddons: [] } as ResolvedSubtitles));
    if (isCancelled()) return;
    const castableSubtitle = subtitles.find((s) => /^https?:\/\//i.test(s.url));
    setPlayerSubtitleUrl(castableSubtitle?.url);
    const failedTrackAddons: string[] = [];
    await Promise.all(
      subtitles.map((subtitle) =>
        embeddedMpvAddSubtitle(subtitle.url, subtitle.addonName ?? subtitle.label, subtitle.lang).catch(() => {
          if (subtitle.addonName) failedTrackAddons.push(subtitle.addonName);
        }),
      ),
    );
    if (isCancelled()) return;
    const allFailedAddons = Array.from(new Set([...failedAddons, ...failedTrackAddons]));
    setPlayerSubtitleWarning(allFailedAddons.length ? allFailedAddons : null);
  }, [stateRef]);

  const closePlayer = useCallback(async () => {
    if (closingPlayerRef.current) return;
    closingPlayerRef.current = true;
    ++playGenerationRef.current;
    const closeGeneration = playGenerationRef.current;
    const captureMeta = playingMetaRef.current;
    const captureEpisode = playingEpisodeRef.current;
    const captureStream = playingStreamRef.current;
    const shouldStopTorrent = playerUsesTorrentRef.current;
    setPlayerUrl(null);
    setPlayerTitle(undefined);
    setPlayerEpisode(null);
    setPlayerPosterUrl(undefined);
    setPlayerLogoUrl(undefined);
    setPlayerMetaId(undefined);
    setPlayerSubtitleUrl(undefined);
    setPlayerStreamHeaders(undefined);
    setPlayerUsesTorrent(false);
    setPlayerLoadingOverlay(null);
    setPlayerPlaybackError(null);
    setPlayerSubtitleWarning(null);
    inNativePlayerRef.current = false;
    await playerClearSkipInfo();
    void playerClearChapters();
    void playerClearEpisodes();
    try {
      const status = await withCloseTimeout(embeddedMpvStatus(), 700).catch(() => null) ?? lastPlaybackStatusRef.current;
      if (!status && captureMeta) {
        debugLog('closePlayer: embeddedMpvStatus timed out and no cached playback status is available');
      }
      if (captureMeta && captureStream) {
        await persistLastPlaybackSource(captureMeta, captureStream).catch(() => undefined);
      }
      await withCloseTimeout(embeddedMpvHide(), 400).catch(() => undefined);
      await withCloseTimeout(embeddedMpvStop(), 900).catch(() => undefined);
      await withCloseTimeout(destroyEmbeddedMpv(), 900).catch(() => undefined);
      closingPlayerRef.current = false;
      if (status && captureMeta) {
        const timePos = parseFloat(status.timePos ?? '0');
        const duration = parseFloat(status.duration ?? '0');
        if (timePos > 30 && duration > 0) {
          traktScrobbleOnClose(activeProfileRef.current, captureMeta, captureEpisode, timePos, duration);
          simklScrobbleOnClose(activeProfileRef.current, captureMeta, captureEpisode, timePos, duration, (revoked) => {
            void saveProfile(revoked);
            onProfileUpdated?.(revoked);
          });
          try {
            const closePrefs = appPrefs(stateRef.current);
            const watchedThreshold = (Number(prefString(closePrefs, 'watchedThresholdPercent', '90')) || 90) / 100;
            const isWatched = duration > 0 && timePos / duration >= watchedThreshold;
            const saveResult = await dispatchAction(JSON.stringify({
              type: 'savePlaybackProgressRequested',
              meta: captureMeta,
              timeOffset: Math.floor(timePos),
              duration: Math.floor(duration),
              lastVideoId: captureEpisode?.id ?? null,
              lastStreamIndex: stateRef.current.player.currentStreamIndex ?? null,
              lastEpisodeName: captureEpisode?.name ?? captureEpisode?.title ?? null,
              lastEpisodeSeason: captureEpisode?.season ?? null,
              lastEpisodeNumber: captureEpisode?.episode ?? captureEpisode?.number ?? null,
              lastEpisodeThumbnail: captureEpisode?.thumbnail ?? null,
              lastStreamUrl: captureStream?.playableUrl ?? captureStream?.url ?? null,
              lastStreamTitle: captureStream?.title ?? captureStream?.name ?? null,
              lastAudioLanguage: null,
              lastSubtitleLanguage: null,
              scrobbleTraktPause: true,
            }));
            if (saveResult) {
              updateState(saveResult.state);
              if (saveResult.effects.length > 0) await pumpEffects(saveResult.effects, updateState);
              if (isWatched) {
                const videoId = captureEpisode?.id ?? captureMeta.id;
                const watchedResult = await dispatchAction(JSON.stringify({
                  type: 'markWatchedRequested',
                  seriesId: captureMeta.id,
                  videoIds: [videoId],
                  watched: true,
                  meta: captureMeta,
                  episodes: captureEpisode ? [{
                    id: captureEpisode.id,
                    name: captureEpisode.name ?? captureEpisode.title,
                    season: captureEpisode.season,
                    number: captureEpisode.episode ?? captureEpisode.number,
                    thumbnail: captureEpisode.thumbnail,
                  }] : [],
                })).catch(() => null);
                if (watchedResult) {
                  updateState(watchedResult.state);
                  if (watchedResult.effects.length > 0) await pumpEffects(watchedResult.effects, updateState);
                }
                const nextEp = playingNextEpisodeRef.current;
                if (nextEp && captureMeta.type === 'series') {
                  const upNextResult = await dispatchAction(JSON.stringify({
                    type: 'savePlaybackProgressRequested',
                    meta: captureMeta,
                    timeOffset: 1,
                    duration: 99999,
                    lastVideoId: nextEp.id ?? null,
                    lastStreamIndex: null,
                    lastEpisodeName: nextEp.name ?? nextEp.title ?? null,
                    lastEpisodeSeason: nextEp.season ?? null,
                    lastEpisodeNumber: nextEp.episode ?? nextEp.number ?? null,
                    lastEpisodeThumbnail: nextEp.thumbnail ?? null,
                    lastStreamUrl: null,
                    lastStreamTitle: null,
                    lastAudioLanguage: null,
                    lastSubtitleLanguage: null,
                    scrobbleTraktPause: false,
                  })).catch(() => null);
                  if (upNextResult) {
                    updateState(upNextResult.state);
                    if (upNextResult.effects.length > 0) await pumpEffects(upNextResult.effects, updateState);
                  }
                }
              }
              void dispatchAction(JSON.stringify({ type: 'homeLoadRequested', language: getLanguage(), force: true }))
                .then((reloadResult) => {
                  if (reloadResult) {
                    updateState(reloadResult.state);
                    if (reloadResult.effects.length > 0) void pumpEffects(reloadResult.effects, updateState);
                  }
                }).catch(() => undefined);
            }
          } catch {}
        } else {
          try {
            const saveResult = await dispatchAction(JSON.stringify({
              type: 'savePlaybackProgressRequested',
              meta: captureMeta,
              timeOffset: 1,
              duration: duration > 0 ? Math.floor(duration) : 99999,
              lastVideoId: captureEpisode?.id ?? null,
              lastStreamIndex: stateRef.current.player.currentStreamIndex ?? null,
              lastEpisodeName: captureEpisode?.name ?? captureEpisode?.title ?? null,
              lastEpisodeSeason: captureEpisode?.season ?? null,
              lastEpisodeNumber: captureEpisode?.episode ?? captureEpisode?.number ?? null,
              lastEpisodeThumbnail: captureEpisode?.thumbnail ?? null,
              lastStreamUrl: captureStream?.playableUrl ?? captureStream?.url ?? null,
              lastStreamTitle: captureStream?.title ?? captureStream?.name ?? null,
              lastAudioLanguage: null,
              lastSubtitleLanguage: null,
              scrobbleTraktPause: true,
            }));
            if (saveResult) {
              updateState(saveResult.state);
              if (saveResult.effects.length > 0) await pumpEffects(saveResult.effects, updateState);
            }
          } catch {}
        }
      }
    } finally {
      const stillCurrent = playGenerationRef.current === closeGeneration;
      if (shouldStopTorrent && stillCurrent) {
        await stopTorrentStream().catch(() => false);
      }
      closingPlayerRef.current = false;
    }
    if (playGenerationRef.current === closeGeneration) {
      playingMetaRef.current = null;
      playingEpisodeRef.current = null;
      playingStreamRef.current = null;
      playingSourceCandidatesRef.current = [];
      attemptedSourceKeysRef.current = new Set();
      lastResumeAtSecondsRef.current = undefined;
      lastTotalDurationSecondsRef.current = undefined;
      lastPlaybackStatusRef.current = null;
    }
  }, [stateRef, updateState]);

  const saveProgressTick = useCallback(async () => {
    if (closingPlayerRef.current || !inNativePlayerRef.current) return;
    const captureMeta = playingMetaRef.current;
    if (!captureMeta) return;
    const captureEpisode = playingEpisodeRef.current;
    const captureStream = playingStreamRef.current;
    const status = await embeddedMpvStatus().catch(() => null);
    if (!status) return;
    lastPlaybackStatusRef.current = status;
    const timePos = parseFloat(status.timePos ?? '0');
    const duration = parseFloat(status.duration ?? '0');
    if (!(timePos > 30 && duration > 0)) return;
    try {
      const saveResult = await dispatchAction(JSON.stringify({
        type: 'savePlaybackProgressRequested',
        meta: captureMeta,
        timeOffset: Math.floor(timePos),
        duration: Math.floor(duration),
        lastVideoId: captureEpisode?.id ?? null,
        lastStreamIndex: stateRef.current.player.currentStreamIndex ?? null,
        lastEpisodeName: captureEpisode?.name ?? captureEpisode?.title ?? null,
        lastEpisodeSeason: captureEpisode?.season ?? null,
        lastEpisodeNumber: captureEpisode?.episode ?? captureEpisode?.number ?? null,
        lastEpisodeThumbnail: captureEpisode?.thumbnail ?? null,
        lastStreamUrl: captureStream?.playableUrl ?? captureStream?.url ?? null,
        lastStreamTitle: captureStream?.title ?? captureStream?.name ?? null,
        lastAudioLanguage: null,
        lastSubtitleLanguage: null,
        scrobbleTraktPause: false,
      }));
      if (saveResult) {
        updateState(saveResult.state);
        if (saveResult.effects.length > 0) await pumpEffects(saveResult.effects, updateState);
      }
    } catch {}
  }, [stateRef, updateState]);

  useEffect(() => {
    if (!playerUrl) return;
    const interval = setInterval(() => { void saveProgressTick(); }, 30000);
    return () => clearInterval(interval);
  }, [playerUrl, saveProgressTick]);

  const handlePlay = useCallback(async (
    stream: Stream,
    meta?: Meta,
    episode?: Video | null,
    resumeAtSeconds?: number,
    totalDurationSeconds?: number,
    sourceCandidates?: Stream[],
    openSourcePickerOnFailure = false,
  ) => {
    debugLog('handlePlay:start');
    setPlayerPlaybackError(null);
    setPlayerSubtitleWarning(null);
    try {
    const generation = ++playGenerationRef.current;
    const isCancelled = () => generation !== playGenerationRef.current;
    openSourcePickerOnFailureRef.current = openSourcePickerOnFailure;
    setPlayerUrl(null);
    setPlayerUsesTorrent(streamIsP2P(stream));
    const currentStreamKey = streamKey(stream);
    if (sourceCandidates?.length) {
      playingSourceCandidatesRef.current = sourceCandidates;
      attemptedSourceKeysRef.current = new Set();
    } else if (!playingSourceCandidatesRef.current.some((candidate) => streamKey(candidate) === currentStreamKey)) {
      playingSourceCandidatesRef.current = [stream];
      attemptedSourceKeysRef.current = new Set();
    }
    if (currentStreamKey) attemptedSourceKeysRef.current.add(currentStreamKey);
    prefetchedNextEpRef.current = null;
    if (meta) playingMetaRef.current = meta;
    playingEpisodeRef.current = episode ?? null;
    playingStreamRef.current = stream;
    lastResumeAtSecondsRef.current = resumeAtSeconds;
    lastTotalDurationSecondsRef.current = totalDurationSeconds;
    setPlayerEpisode(episode ?? null);


    const earlyTitle = playerDisplayTitle(meta, episode, stream);
    const earlyArtwork = playerArtwork(meta, episode);
    setPlayerPosterUrl(earlyArtwork.background ?? meta?.poster);
    setPlayerLogoUrl(earlyArtwork.logo ?? undefined);
    setPlayerMetaId(meta?.id);
    setPlayerStreamHeaders(streamRequestHeaders(stream));
    artworkPrefetchRef.current = prefetchPlayerArtwork(earlyArtwork.background, earlyArtwork.logo).catch(() => undefined);
    let loadingArtworkPromise = showPlayerLoading(generation, earlyTitle, earlyArtwork, stream);

    if (!earlyArtwork.logo && meta?.id && meta?.type) {
      const logoPrefs = appPrefs(stateRef.current);
      const tmdbApiKey = prefString(logoPrefs, 'tmdbApiKey');
      const fanartApiKey = prefString(logoPrefs, 'fanartApiKey');
      void fetchContentLogo(meta.id, meta.type, getLanguage(), tmdbApiKey, fanartApiKey)
        .then((logo) => {
          if (!logo || isCancelled()) return;
          if (playingMetaRef.current) playingMetaRef.current = { ...playingMetaRef.current, logo };
          setPlayerLogoUrl(logo);
          setPlayerLoadingOverlay((prev) => (prev ? { ...prev, logo } : prev));
        })
        .catch(() => undefined);
    }

    const effectiveTotalDuration = totalDurationSeconds
      ?? (meta?.id ? (stateRef.current.library.lastWrite?.progress as Record<string, import('../core/types').LibraryItem> | undefined)?.[meta.id]?.duration : undefined);
    lastTotalDurationSecondsRef.current = effectiveTotalDuration;

    const retryNextOrFail = async (message: string) => {
      const nextSource = nextRetrySource(stream, message === t('player.torrent_no_peers') || message === t('player.torrent_too_slow'));
      if (nextSource && meta && !isCancelled()) {
        setLoadingStatus(t('player.status_trying_next_source'));
        await handlePlay(nextSource, meta, episode, resumeAtSeconds, effectiveTotalDuration, undefined, openSourcePickerOnFailure);
        return;
      }
      if (openSourcePickerOnFailure && meta && episode && onEpisodePlaybackFailed) {
        await onEpisodePlaybackFailed(meta, episode, message);
        return;
      }
      if (!isCancelled()) await failPlayerLoading(message);
    };

    debugLog('handlePlay:resolving next episode');
    const nextEp = episode
      ? (await coreResolveNextEpisode(JSON.stringify(meta?.videos ?? []), episode.season ?? 0, episode.episode ?? episode.number ?? 0, Date.now(), false)) as Video | null
      : null;
    playingNextEpisodeRef.current = nextEp;

    debugLog('handlePlay:preparing plan');
    const playbackPlan = await corePlaybackPreparePlan({
      stream,
      meta,
      episode,
      preferredPlayer: prefString(appPrefs(stateRef.current), 'preferredPlayer', 'mpv'),
    }) as PlaybackPreparePlan | null;
    debugLog(`handlePlay:plan ready mode=${playbackPlan?.mode} url=${(playbackPlan?.url ?? stream.playableUrl ?? stream.url)?.slice(0, 80)}`);
    if (isCancelled()) return;

    const url = playbackPlan?.url ?? stream.playableUrl ?? stream.url;
    if (!url) {
      await retryNextOrFail(t('player.no_playable_url'));
      return;
    }
    if (playbackPlan?.mode === 'reject') {
      await retryNextOrFail(playbackPlan.rejectReason === 'incompatible_stream'
        ? t('player.incompatible_desktop_stream')
        : t('player.no_playable_url'));
      return;
    }

    const title = playbackPlan?.title ?? earlyTitle;
    if (playbackPlan?.artwork) {
      pendingArtworkRef.current = playbackPlan.artwork;
      setPlayerLogoUrl(playbackPlan.artwork.logo ?? undefined);
      setPlayerLoadingOverlay((prev) =>
        prev ? { ...prev, background: playbackPlan.artwork!.background, logo: playbackPlan.artwork!.logo } : prev,
      );
      if (inNativePlayerRef.current) {
        loadingArtworkPromise = embeddedMpvSetLoadingArtwork(
          title.contentTitle ?? 'Fluxa',
          title.episodeLine,
          playbackPlan.artwork.background,
          playbackPlan.artwork.logo,
        ).catch(() => undefined);
      }
    }

    const subtitlesPromise = resolvePlaybackSubtitles(
      stream,
      meta,
      episode,
      playbackPlan?.subtitleExtraArgs,
      stateRef.current.addons.installed ?? [] as AddonDescriptor[],
    ).catch(() => ({ subtitles: [], failedAddons: [] } as ResolvedSubtitles));

    await playerClearSkipInfo();
    const skipPrefs = appPrefs(stateRef.current);
    const skipThreshold = Number(prefString(skipPrefs, 'nextEpisodeThresholdPercent', '85')) || 85;
    const skipAutoPlay = prefBool(skipPrefs, 'autoPlayNextEpisode', true);
    const skipCountdown = Number(prefString(skipPrefs, 'autoPlayCountdownSecs', '7')) || 7;
    const playableInitialNextEp = nextEp && isEpisodeReleasedForPlayback(nextEp) ? nextEp : null;
    await playerSetSkipInfo(
      '[]',
      playableInitialNextEp ? formatNextEpisodeSubtitle(playableInitialNextEp) : undefined,
      skipThreshold,
      skipAutoPlay,
      skipCountdown,
      prefBool(skipPrefs, 'autoSkipIntro', false),
    );
    void playerClearChapters();
    const episodeList = meta?.videos ?? [];
    void playerSetEpisodes(JSON.stringify(episodeList));
    const animeDetection = await coreDetectAnimePlayback(
      meta ?? null,
      episode ?? null,
      stream ?? null,
      stateRef.current.addons.installed ?? [],
    );
    debugLog(`handlePlay:anime detection confidence=${animeDetection.confidence} isAnime=${animeDetection.isAnime} reasons=${animeDetection.reasons.join(', ')}`);
    const skipSegmentsPromise = (async () => {
      const useIntroDb = prefBool(skipPrefs, 'useIntroDb', true);
      const useAniSkip = prefBool(skipPrefs, 'useAniSkip', true);
      const useAnimeSkip = prefBool(skipPrefs, 'useAnimeSkip', false);
      if ((!useIntroDb && !useAniSkip && !useAnimeSkip) || !episode) return [];
      const imdbId = useIntroDb && meta?.id ? await corePlaybackIntroLookupContentId(meta.id) : '';
      const season = episode.season ?? 1;
      const epNum = episode.episode ?? episode.number ?? 1;
      return fetchPlaybackSkipSegments({ imdbId, season, episode: epNum, title: meta?.name ?? '', useIntroDb, useAniSkip, useAnimeSkip, animeSkipClientId: prefString(skipPrefs, 'animeSkipClientId', '') });
    })();
    void skipSegmentsPromise.then((segments) => {
      if (isCancelled() || segments.length === 0) return;
      return playerSetSkipInfo(
        JSON.stringify(segments),
        playableInitialNextEp ? formatNextEpisodeSubtitle(playableInitialNextEp) : undefined,
        skipThreshold,
        skipAutoPlay,
        skipCountdown,
        prefBool(skipPrefs, 'autoSkipIntro', false),
      );
    }).catch(() => undefined);

    let loadingStatusPollActive = true;
    const pollMpvLoadingStatus = async () => {
      while (loadingStatusPollActive && !isCancelled() && playerLoadingOverlayRef.current && !playerLoadingOverlayRef.current.error) {
        const status = await embeddedMpvStatus().catch(() => null);
        if (!loadingStatusPollActive || isCancelled() || !playerLoadingOverlayRef.current || playerLoadingOverlayRef.current.error) return;
        if (!status?.loaded) {
          setLoadingStatus(t('player.status_connecting_source'));
        } else if (status.pausedForCache === 'yes') {
          const pct = Math.round(parseFloat(status.cacheBufferingState ?? '') || 0);
          setLoadingStatus(pct > 0 ? t('player.status_buffering_percent', pct) : t('player.status_buffering'));
        } else if (
          !status.hasVideoTrack ||
          status.voConfigured !== 'yes' ||
          status.framesRendered < 2 ||
          (parseFloat(status.width ?? '0') || 0) <= 0 ||
          (parseFloat(status.height ?? '0') || 0) <= 0
        ) {
          setLoadingStatus(t('player.status_connecting_source'));
        } else {
          setLoadingStatus(t('player.status_starting_playback'));
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    };

    if (playbackPlan?.mode === 'torrent') {
      const MAX_PEER_RETRIES = playingSourceCandidatesRef.current.some((candidate) => streamKey(candidate) !== currentStreamKey) ? 1 : 2;
      const TORRENT_READY_FIRST_ATTEMPT_MS = 15_000;
      const TORRENT_READY_RETRY_BUDGET_MS = 45_000;
      const TORRENT_READY_PER_RETRY_MS = MAX_PEER_RETRIES > 0 ? Math.floor(TORRENT_READY_RETRY_BUDGET_MS / MAX_PEER_RETRIES) : 0;
      let statusPollActive = true;
      const retrySuffix = (retryIndex: number) => (retryIndex > 0 ? ` ${t('player.status_retry_attempt', retryIndex, MAX_PEER_RETRIES)}` : '');
      const pollTorrentStatus = async (retryIndex: number) => {
        while (statusPollActive && !isCancelled()) {
          const ts = await playerTorrentStats().catch(() => null);
          if (!statusPollActive || isCancelled()) return;
          const percent = ts && typeof ts.preload === 'number' ? Math.max(0, Math.min(100, Math.round(ts.preload))) : 0;
          if (ts && ts.active_peers > 0) {
            setLoadingStatus(t('player.status_fetching_peers', ts.active_peers, percent) + retrySuffix(retryIndex));
          } else {
            setLoadingStatus(t('player.status_fetching_torrent', percent) + retrySuffix(retryIndex));
          }
          await new Promise((r) => setTimeout(r, 700));
        }
      };
      const TORRENT_READY_HARD_LIMIT_MS = 120_000;
      const waitForTorrentReady = async (budgetMs: number) => {
        const startedAt = Date.now();
        let deadline = startedAt + budgetMs;
        let lastLoaded = 0;
        let sawPeers = false;
        while (Date.now() < Math.min(deadline, startedAt + TORRENT_READY_HARD_LIMIT_MS)) {
          if (isCancelled()) return;
          const ts = await playerTorrentStats().catch(() => null);
          if (ts?.stat === -1) throw new Error(ts.error?.trim() || t('player.torrent_no_peers'));
          if (ts) {
            const info = await coreTorrentStatusInfo(ts).catch(() => null);
            if (info?.isPlayableEnough) return;
            if (ts.active_peers > 0) sawPeers = true;
            if (ts.loaded_size > lastLoaded) {
              lastLoaded = ts.loaded_size;
              deadline = Date.now() + budgetMs;
            } else if (ts.active_peers > 0 || ts.resolving) {
              deadline = Math.max(deadline, Date.now() + 20_000);
            }
          }
          await new Promise((r) => setTimeout(r, 700));
        }
        throw new Error(t(sawPeers ? 'player.torrent_too_slow' : 'player.torrent_no_peers'));
      };
      try {
        let localUrl: string | null = null;
        for (let retryIndex = 0; retryIndex <= MAX_PEER_RETRIES; retryIndex++) {
          try {
            debugLog(`handlePlay:starting torrent stream retryIndex=${retryIndex}`);
            statusPollActive = true;
            setLoadingStatus(t('player.status_starting_torrent') + retrySuffix(retryIndex));
            void pollTorrentStatus(retryIndex);
            localUrl = await startTorrentStream(JSON.stringify(stream), title.contentTitle, appPrefs(stateRef.current));
            debugLog(`handlePlay:torrent stream started localUrl=${localUrl?.slice(0, 80)}`);
            if (isCancelled()) { statusPollActive = false; return; }
            await waitForTorrentReady(retryIndex === 0 ? TORRENT_READY_FIRST_ATTEMPT_MS : TORRENT_READY_PER_RETRY_MS);
            statusPollActive = false;
            break;
          } catch (retryErr) {
            statusPollActive = false;
            if (isCancelled()) return;
            if (retryIndex >= MAX_PEER_RETRIES) throw retryErr;
            debugLog(`handlePlay:torrent retry ${retryIndex} failed, retrying`);
            localUrl = null;
          }
        }
        if (isCancelled() || !localUrl) return;
        setLoadingStatus(t('player.status_loading_stream'));
        void pollMpvLoadingStatus();
        await playInEmbeddedMpv(generation, localUrl, title, true, subtitlesPromise, loadingArtworkPromise, resumeAtSeconds, effectiveTotalDuration, undefined, animeDetection.isAnime);
        debugLog('handlePlay:playInEmbeddedMpv (torrent) resolved');
      } catch (err) {
        statusPollActive = false;
        loadingStatusPollActive = false;
        debugLog(`handlePlay:torrent path FAILED ${err instanceof Error ? `${err.message}\n${err.stack}` : String(err)}`);
        await retryNextOrFail(err instanceof Error && err.message ? err.message : (t('player.playback_error') || 'Playback failed'));
        return;
      }
    } else {
      try {
        debugLog('handlePlay:calling playInEmbeddedMpv');
        setLoadingStatus(t('player.status_loading_stream'));
        void pollMpvLoadingStatus();
        await playInEmbeddedMpv(generation, url, title, false, subtitlesPromise, loadingArtworkPromise, resumeAtSeconds, effectiveTotalDuration, streamRequestHeaders(stream), animeDetection.isAnime);
        debugLog('handlePlay:playInEmbeddedMpv resolved');
      } catch (err) {
        loadingStatusPollActive = false;
        debugLog(`handlePlay:direct path FAILED ${err instanceof Error ? `${err.message}\n${err.stack}` : String(err)}`);
        await retryNextOrFail(err instanceof Error && err.message ? err.message : (t('player.playback_error') || 'Playback failed'));
        return;
      }
    }

    // Background: fetch skip segments + prefetch next episode stream
    void (async () => {
      try {
        const prefs = appPrefs(stateRef.current);
        const needVideos = !nextEp && !!meta?.id && !!meta?.type && !!episode;

        const [segmentResult, fetchedVideos] = await Promise.all([
          skipSegmentsPromise,
          needVideos ? fetchMetaVideos(meta!.id, meta!.type) : Promise.resolve([] as Video[]),
        ]);

        if (fetchedVideos.length > 0) {
          void playerSetEpisodes(JSON.stringify(fetchedVideos));
          if (playingMetaRef.current) playingMetaRef.current = { ...playingMetaRef.current, videos: fetchedVideos };
        }

        const videoList = fetchedVideos.length > 0 ? fetchedVideos : episodeList;
        let resolvedNextEp = nextEp;
        if (fetchedVideos.length > 0 && episode) {
          resolvedNextEp = (await coreResolveNextEpisode(JSON.stringify(videoList), episode.season ?? 0, episode.episode ?? episode.number ?? 0, Date.now(), false)) as Video | null;
          playingNextEpisodeRef.current = resolvedNextEp;
        }

        const resolvedPlayableNextEp = resolvedNextEp && isEpisodeReleasedForPlayback(resolvedNextEp) ? resolvedNextEp : null;
        if (segmentResult.length === 0 && !resolvedPlayableNextEp) return;

        const threshold = Number(prefString(prefs, 'nextEpisodeThresholdPercent', '85')) || 85;
        const autoPlay = prefBool(prefs, 'autoPlayNextEpisode', true);
        const countdown = Number(prefString(prefs, 'autoPlayCountdownSecs', '7')) || 7;
        await playerSetSkipInfo(
          JSON.stringify(segmentResult),
          resolvedPlayableNextEp ? formatNextEpisodeSubtitle(resolvedPlayableNextEp) : undefined,
          threshold,
          autoPlay,
          countdown,
          prefBool(prefs, 'autoSkipIntro', false),
        );

        if (resolvedPlayableNextEp && await coreCanPrefetchNextEpisode(JSON.stringify(prefs), JSON.stringify(stream))) {
          void (async () => {
            try {
              const result = await fetchStreamsForEpisode(resolvedPlayableNextEp.id, meta?.type ?? 'series');
              const streams = result.streams as Stream[];
              if (streams.length > 0) {
                const chosen = (await coreSelectNextEpisodeStream(JSON.stringify(streams), JSON.stringify(stream), JSON.stringify(prefs), resolvedPlayableNextEp.id)) as Stream | null;
                if (chosen) prefetchedNextEpRef.current = { episodeId: resolvedPlayableNextEp.id, stream: chosen };
              }
            } catch {}
          })();
        }
      } catch {}
    })();
    } catch (err) {
      debugLog(`handlePlay:FATAL ${err instanceof Error ? `${err.message}\n${err.stack}` : String(err)}`);
      if (openSourcePickerOnFailure && meta && episode && onEpisodePlaybackFailed) {
        await onEpisodePlaybackFailed(meta, episode, err instanceof Error && err.message ? err.message : t('player.playback_error'));
        return;
      }
      await failPlayerLoading(err instanceof Error && err.message ? err.message : (t('player.playback_error') || 'Playback failed'));
    }
  }, [stateRef, showPlayerLoading, failPlayerLoading, playInEmbeddedMpv, nextRetrySource, setLoadingStatus, onEpisodePlaybackFailed]);

  const handleNativePlayerError = useCallback(async (message: string) => {
    const nextSource = nextRetrySource(playingStreamRef.current);
    if (nextSource && playingMetaRef.current) {
      const status = await embeddedMpvStatus().catch(() => null);
      const timePos = Number.parseFloat(status?.timePos ?? '');
      await handlePlay(
        nextSource,
        playingMetaRef.current,
        playingEpisodeRef.current,
        Number.isFinite(timePos) && timePos > 0 ? Math.floor(timePos) : lastResumeAtSecondsRef.current,
        lastTotalDurationSecondsRef.current,
      );
      return;
    }
    if (openSourcePickerOnFailureRef.current && playingMetaRef.current && playingEpisodeRef.current && onEpisodePlaybackFailed) {
      await onEpisodePlaybackFailed(playingMetaRef.current, playingEpisodeRef.current, message);
      return;
    }
    if (!playerLoadingOverlayRef.current?.error) await failPlayerLoading(message);
  }, [failPlayerLoading, handlePlay, nextRetrySource, onEpisodePlaybackFailed]);

  const showEpisodeTransitionLoading = useCallback((meta: Meta, episode: Video, stream: Stream) => {
    const title = playerDisplayTitle(meta, episode, stream);
    const artwork = playerArtwork(meta, episode);
    setPlayerTitle(title.contentTitle);
    setPlayerEpisodeTitle(title.episodeLine ?? undefined);
    setPlayerPosterUrl(artwork.background ?? meta.poster);
    setPlayerLogoUrl(artwork.logo ?? undefined);
    setPlayerMetaId(meta.id);
    setPlayerPlaybackError(null);
    setPlayerSubtitleWarning(null);
    setPlayerLoadingOverlay({
      background: artwork.background,
      logo: artwork.logo,
      title: title.contentTitle,
      episodeLine: title.episodeLine,
      status: t('player.status_preparing'),
      source: {
        title: stream.name ?? stream.title ?? stream.description,
        addon: stream.addonName,
        filename: stream.behaviorHints?.filename,
        fileIdx: stream.fileIdx,
        infoHash: stream.infoHash,
        sources: stream.sources,
      },
    });
  }, []);

  usePlayerNativeEvents({
    stateRef,
    closingPlayerRef,
    playingMetaRef,
    playingStreamRef,
    playingEpisodeRef,
    playingNextEpisodeRef,
    prefetchedNextEpRef,
    closePlayer,
    handlePlay,
    onPlayerError: handleNativePlayerError,
    onEpisodePlaybackFailed,
    showEpisodeTransitionLoading,
  });

  const notifyFirstFrame = useCallback(() => {
    if (firstFrameHandoffPendingRef.current) return;
    firstFrameHandoffPendingRef.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        firstFrameHandoffPendingRef.current = false;
        setPlayerLoadingOverlay((prev) => (prev?.error ? prev : null));
      });
    });
  }, []);

  const dismissSubtitleWarning = useCallback(() => {
    setPlayerSubtitleWarning(null);
  }, []);

  return { playerLoadingOverlay, playerUrl, playerPlaybackError, playerSubtitleWarning, dismissSubtitleWarning, playerTitle, playerEpisodeTitle, playerEpisode, playerUsesTorrent, playerPosterUrl, playerLogoUrl, playerMetaId, playerSubtitleUrl, playerStreamHeaders, handlePlay, closePlayer, notifyFirstFrame, flushProgressOnQuit: saveProgressTick };
}

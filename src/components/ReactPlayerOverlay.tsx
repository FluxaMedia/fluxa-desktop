import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import {
  AudioLines,
  Camera,
  Captions,
  Cast,
  ChevronLeft,
  Clock,
  Fullscreen,
  GalleryVerticalEnd,
  Gauge,
  Info,
  Minimize2,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  RotateCcw,
  RotateCw,
  SkipForward,
  Volume1,
  Volume2,
  VolumeOff,
} from 'lucide-react';
import { setSuppressWindowGeometrySave } from '../core/windowGeometry';
import type { EmbeddedMpvStatus } from '../core/mpvPlayer';
import { playerGetPlaybackInfo, playerGetTrackOptions } from '../core/mpvPlayer';
import type { PlayerTrackOption } from '../core/mpvPlayer';
import { VolumeBar } from './player/VolumeBar';
import { NextEpCard } from './player/NextEpCard';
import { EpisodePanel, epLabel } from './player/EpisodePanel';
import type { EpisodeInfo } from './player/EpisodePanel';
import { TrackPopover } from './player/TrackPopover';
import { CastPopover } from './player/CastPopover';
import { setIdleDiscordPresence, updateDiscordPresence } from '../core/discordPresence';
import { castDisconnect, castPlay, castPause, castSeek, castSetVolume, discoverCastDevices, proxyMediaUrl, resolveCastMediaUrl, startCasting } from '../core/cast';
import type { CastDevice } from '../core/cast';

type Chapter = { title: string; startMs: number };
type SkipSegment = { type: string; startTime: number; endTime: number };
type ActiveSkip = { label: string; startMs: number; endMs: number };
type FeedbackFlash = { icon: 'play' | 'pause' | 'seekBack' | 'seekFwd' | 'speed' | 'abLoop' | 'screenshot' | 'subDelay'; label: string };

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function sendCmd(command: string) {
  invoke('player_command', { command }).catch(() => undefined);
}

function parseChapters(json: string | null | undefined): Chapter[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as Array<{ title?: string; startTime?: number }>;
    return arr.map((c) => ({ title: c.title ?? '', startMs: c.startTime ?? 0 }));
  } catch { return []; }
}

function parseSegments(json: string | null | undefined): SkipSegment[] {
  if (!json) return [];
  try { return JSON.parse(json) as SkipSegment[]; } catch { return []; }
}

function parseEpisodes(json: string | null | undefined): EpisodeInfo[] {
  if (!json) return [];
  try { return JSON.parse(json) as EpisodeInfo[]; } catch { return []; }
}

function skipLabelForType(type: string): string {
  switch (type) {
    case 'intro': return t('player.skip_intro');
    case 'outro': return t('player.skip_outro');
    case 'recap': return t('player.skip_recap');
    case 'preview': return t('player.skip_preview');
    default: return t('player.skip');
  }
}

function IconVolume({ muted, level }: { muted: boolean; level: number }) {
  if (muted || level === 0) return <VolumeOff size={24} />;
  if (level < 50) return <Volume1 size={24} />;
  return <Volume2 size={24} />;
}

interface Props {
  closePlayer: () => Promise<void>;
  onFirstFrame?: () => void;
  initialTitle?: string;
  initialEpisodeTitle?: string;
  initialPosterUrl?: string;
  initialSubtitleUrl?: string;
  initialStreamHeaders?: Record<string, string>;
  bannerOffset?: number;
}

export function ReactPlayerOverlay({ closePlayer, onFirstFrame, initialTitle, initialEpisodeTitle, initialPosterUrl, initialSubtitleUrl, initialStreamHeaders, bannerOffset = 0 }: Props) {
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(100);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [title, setTitle] = useState(initialTitle ?? '');
  const [episodeTitle, setEpisodeTitle] = useState(initialEpisodeTitle ?? '');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [skipSegments, setSkipSegments] = useState<SkipSegment[]>([]);
  const [nextEpSubtitle, setNextEpSubtitle] = useState('');
  const [nextEpThreshold, setNextEpThreshold] = useState(85);
  const [autoPlayNextEpisode, setAutoPlayNextEpisode] = useState(false);
  const [autoPlayCountdownSecs, setAutoPlayCountdownSecs] = useState(7);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [nextEpDismissed, setNextEpDismissed] = useState(false);
  const [episodes, setEpisodes] = useState<EpisodeInfo[]>([]);
  const [showEpisodePanel, setShowEpisodePanel] = useState(false);
  const [activeSkip, setActiveSkip] = useState<ActiveSkip | null>(null);
  const [autoSkipSegments, setAutoSkipSegments] = useState(false);
  const autoSkippedKeysRef = useRef<Set<string>>(new Set());
  const [showNextEpCard, setShowNextEpCard] = useState(false);
  const [trackPopover, setTrackPopover] = useState<'audio' | 'sub' | 'speed' | null>(null);
  const [miniPlayerActive, setMiniPlayerActive] = useState(false);
  const miniPlayerActiveRef = useRef(false);
  const preMiniPlayerSizeRef = useRef<PhysicalSize | null>(null);
  const preMiniPlayerPosRef = useRef<PhysicalPosition | null>(null);
  const [castPopoverOpen, setCastPopoverOpen] = useState(false);
  const [castDevices, setCastDevices] = useState<CastDevice[]>([]);
  const [castDiscovering, setCastDiscovering] = useState(false);
  const [activeCastDeviceId, setActiveCastDeviceId] = useState<string | null>(null);
  const activeCastDeviceIdRef = useRef<string | null>(null);
  const [activeCastDeviceName, setActiveCastDeviceName] = useState('');
  const [castPaused, setCastPaused] = useState(false);
  const [abLoopStage, setAbLoopStage] = useState<'none' | 'a' | 'ab'>('none');
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [audioTracks, setAudioTracks] = useState<PlayerTrackOption[]>([]);
  const [subTracks, setSubTracks] = useState<PlayerTrackOption[]>([]);
  const [feedback, setFeedback] = useState<FeedbackFlash | null>(null);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const volumeHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showSeekOverlay, setShowSeekOverlay] = useState(false);
  const seekOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const seekFillRef = useRef<HTMLDivElement>(null);
  const seekBufferRef = useRef<HTMLDivElement>(null);
  const seekDotRef = useRef<HTMLDivElement>(null);
  const currentTimeRef = useRef<HTMLSpanElement>(null);
  const durationRef = useRef<HTMLSpanElement>(null);
  const seekbarRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const segFillRefs = useRef<(HTMLDivElement | null)[]>([]);
  const segBufRefs = useRef<(HTMLDivElement | null)[]>([]);
  const skipFillRef = useRef<HTMLDivElement>(null);
  const chapterSegmentsRef = useRef<Array<{ start: number; end: number }> | null>(null);
  const chaptersRef = useRef<Chapter[]>([]);

  const posRef = useRef(0);
  const durRef = useRef(0);
  const pausedRef = useRef(false);
  const lastActivityRef = useRef(Date.now());
  const isOverControlsRef = useRef(false);
  const miniProgressRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragPosRef = useRef(0);
  const lastSeekAtRef = useRef(0);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdActiveRef = useRef(false);
  const preSpeedRef = useRef(1.0);
  const controlsVisibleRef = useRef(true);
  const episodePanelOpenRef = useRef(false);
  const firstFrameFiredRef = useRef(false);
  const loadStartedAtRef = useRef(Date.now());
  const isFullscreenRef = useRef(false);
  const activeSkipKeyRef = useRef<string | null>(null);
  const discordPresenceKeyRef = useRef<string | null>(null);
  const discordPresenceSentAtRef = useRef(0);

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (!controlsVisibleRef.current) {
      controlsVisibleRef.current = true;
      setControlsVisible(true);
      if (overlayRef.current) overlayRef.current.classList.remove('fluxa-cursor-hidden');
      getCurrentWindow().setCursorVisible(true).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const win = getCurrentWindow();
    win.isFullscreen().then((fs) => { isFullscreenRef.current = fs; }).catch(() => {});
    let unlisten: (() => void) | null = null;
    win.listen('tauri://resize', () => {
      win.isFullscreen().then((fs) => { isFullscreenRef.current = fs; }).catch(() => {});
      resetActivity();
    }).then((u) => { unlisten = u; }).catch(() => {});
    return () => { unlisten?.(); };
  }, [resetActivity]);

  const toggleFullscreen = useCallback(async () => {
    const next = !isFullscreenRef.current;
    isFullscreenRef.current = next;
    await getCurrentWindow().setFullscreen(next);
  }, []);

  const toggleMiniPlayer = useCallback(async () => {
    const win = getCurrentWindow();
    if (!miniPlayerActive) {
      if (isFullscreenRef.current) {
        isFullscreenRef.current = false;
        await win.setFullscreen(false);
      }
      try {
        preMiniPlayerSizeRef.current = await win.outerSize();
        preMiniPlayerPosRef.current = await win.outerPosition();
      } catch {}
      setSuppressWindowGeometrySave(true);
      const width = 420;
      const height = 236;
      try {
        const monitor = await currentMonitor();
        if (monitor) {
          const margin = 24;
          await win.setPosition(new PhysicalPosition(
            monitor.position.x + monitor.size.width - width - margin,
            monitor.position.y + monitor.size.height - height - margin,
          ));
        }
      } catch {}
      await win.setSize(new PhysicalSize(width, height));
      await win.setAlwaysOnTop(true);
      setMiniPlayerActive(true);
    } else {
      await win.setAlwaysOnTop(false);
      try {
        if (preMiniPlayerSizeRef.current) await win.setSize(preMiniPlayerSizeRef.current);
        if (preMiniPlayerPosRef.current) await win.setPosition(preMiniPlayerPosRef.current);
      } catch {}
      setSuppressWindowGeometrySave(false);
      setMiniPlayerActive(false);
    }
  }, [miniPlayerActive]);

  const flashFeedback = useCallback((icon: FeedbackFlash['icon'], label: string) => {
    setFeedback({ icon, label });
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 700);
  }, []);

  const startSeekOverlay = useCallback(() => {
    setShowSeekOverlay(true);
    if (seekOverlayTimerRef.current) clearTimeout(seekOverlayTimerRef.current);
    seekOverlayTimerRef.current = setTimeout(() => setShowSeekOverlay(false), 30000);
  }, []);

  const seekToFraction = useCallback((fraction: number) => {
    const tt = fraction * durRef.current;
    lastSeekAtRef.current = Date.now();
    startSeekOverlay();
    if (activeCastDeviceIdRef.current) castSeek(tt);
    else sendCmd(`set time-pos ${Math.floor(tt)}`);
  }, [startSeekOverlay]);

  const fractionFromSeekbarEvent = useCallback((clientX: number): number => {
    const bar = seekbarRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const applyFills = useCallback((frac: number, bufFrac?: number) => {
    const segs = chapterSegmentsRef.current;
    if (segs && segs.length > 0) {
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        const segLen = seg.end - seg.start;
        const fillEl = segFillRefs.current[i];
        const bufEl = segBufRefs.current[i];
        if (fillEl) {
          if (frac >= seg.end) fillEl.style.width = '100%';
          else if (frac <= seg.start) fillEl.style.width = '0%';
          else fillEl.style.width = `${((frac - seg.start) / segLen * 100).toFixed(3)}%`;
        }
        if (bufEl && bufFrac !== undefined) {
          if (bufFrac >= seg.end) bufEl.style.width = '100%';
          else if (bufFrac <= seg.start) bufEl.style.width = '0%';
          else bufEl.style.width = `${((bufFrac - seg.start) / segLen * 100).toFixed(3)}%`;
        }
      }
    } else {
      if (seekFillRef.current) seekFillRef.current.style.width = `${(frac * 100).toFixed(3)}%`;
      if (seekBufferRef.current && bufFrac !== undefined) seekBufferRef.current.style.width = `${(bufFrac * 100).toFixed(3)}%`;
    }
    if (seekDotRef.current) seekDotRef.current.style.left = `${(frac * 100).toFixed(3)}%`;
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      let status: EmbeddedMpvStatus | null = null;
      try { status = await invoke<EmbeddedMpvStatus>('player_status'); } catch { return; }
      if (!status) return;

      const pos = parseFloat(status.timePos ?? '0');
      const dur = parseFloat(status.duration ?? '0');
      const isPaused = status.pause === 'yes';
      const isMuted = (status as Record<string, unknown>).mute === 'yes';
      const vol = parseFloat((status as Record<string, unknown>).volume as string ?? '100');
      const buffered = parseFloat(status.demuxerCacheDuration ?? '0');

      posRef.current = pos;
      durRef.current = dur;
      pausedRef.current = isPaused;

      const presenceKey = `${title}|${episodeTitle}|${isPaused}`;
      const presenceDue = Date.now() - discordPresenceSentAtRef.current > 25000;
      if (title && (presenceKey !== discordPresenceKeyRef.current || presenceDue)) {
        discordPresenceKeyRef.current = presenceKey;
        discordPresenceSentAtRef.current = Date.now();
        updateDiscordPresence({
          title,
          detail: episodeTitle || undefined,
          paused: isPaused,
          startUnixSecs: isPaused ? undefined : Math.floor(Date.now() / 1000 - pos),
          posterUrl: initialPosterUrl,
        });
      }

      if (!firstFrameFiredRef.current && onFirstFrame) {
        const voReady = status.voConfigured === 'yes';
        const audioPlaying = !voReady && status.coreIdle === 'no' && !isPaused && pos > 0;
        const noVideoTrack = !status.videoCodec && Date.now() - loadStartedAtRef.current > 1000;
        if (voReady || audioPlaying || noVideoTrack) {
          firstFrameFiredRef.current = true;
          sendCmd('set pause no');
          onFirstFrame();
        }
      }

      if (currentTimeRef.current) currentTimeRef.current.textContent = fmtTime(pos);
      if (durationRef.current) durationRef.current.textContent = fmtTime(dur);

      const fraction = dur > 0 ? pos / dur : 0;
      const bufFraction = dur > 0 ? Math.min(1, (pos + buffered) / dur) : 0;

      const seekSuppressed = Date.now() - lastSeekAtRef.current < 800 || status.seeking === 'yes';
      if (!isDraggingRef.current && !seekSuppressed) {
        applyFills(fraction, bufFraction);
      }

      if (status.seeking !== 'yes') {
        setShowSeekOverlay((prev) => {
          if (!prev) return prev;
          if (seekOverlayTimerRef.current) { clearTimeout(seekOverlayTimerRef.current); seekOverlayTimerRef.current = null; }
          return false;
        });
      }

      setPaused((prev) => (prev !== isPaused ? isPaused : prev));
      setMuted((prev) => (prev !== isMuted ? isMuted : prev));
      setVolumeLevel((prev) => {
        const rounded = Math.round(vol);
        return prev !== rounded ? rounded : prev;
      });

      const idle = Date.now() - lastActivityRef.current;
      if (idle > 3000 && !isPaused && !episodePanelOpenRef.current && trackPopover === null && !isOverControlsRef.current) {
        if (controlsVisibleRef.current) {
          controlsVisibleRef.current = false;
          setControlsVisible(false);
          if (overlayRef.current) overlayRef.current.classList.add('fluxa-cursor-hidden');
          getCurrentWindow().setCursorVisible(false).catch(() => {});
        }
      }

      if (miniProgressRef.current) miniProgressRef.current.style.width = `${(fraction * 100).toFixed(3)}%`;

      const posMs = pos * 1000;
      const seg = skipSegments.find((s) => posMs >= s.startTime && posMs < s.endTime);
      const newSkipKey = seg ? `${seg.type}:${seg.endTime}` : null;
      if (newSkipKey !== activeSkipKeyRef.current) {
        activeSkipKeyRef.current = newSkipKey;
        if (seg && newSkipKey && autoSkipSegments && !autoSkippedKeysRef.current.has(newSkipKey)) {
          autoSkippedKeysRef.current.add(newSkipKey);
          lastSeekAtRef.current = Date.now();
          sendCmd(`set time-pos ${Math.floor(seg.endTime / 1000)}`);
          flashFeedback('seekFwd', t('player.skipped'));
          setActiveSkip(null);
        } else {
          setActiveSkip(seg ? { label: skipLabelForType(seg.type), startMs: seg.startTime, endMs: seg.endTime } : null);
        }
      }
      if (seg && skipFillRef.current) {
        const span = seg.endTime - seg.startTime;
        const skipFrac = span > 0 ? Math.min(1, Math.max(0, (posMs - seg.startTime) / span)) : 0;
        skipFillRef.current.style.width = `${(skipFrac * 100).toFixed(2)}%`;
      }

      setShowNextEpCard((prev) => {
        const next = !isPaused && dur > 0 && !!nextEpSubtitle && (pos / dur) * 100 >= nextEpThreshold;
        return prev === next ? prev : next;
      });
    }, 500);

    return () => clearInterval(interval);
  }, [skipSegments, nextEpSubtitle, nextEpThreshold, trackPopover, onFirstFrame, applyFills, title, episodeTitle, initialPosterUrl, autoSkipSegments, flashFeedback]);

  useEffect(() => {
    return () => setIdleDiscordPresence();
  }, []);

  useEffect(() => {
    miniPlayerActiveRef.current = miniPlayerActive;
  }, [miniPlayerActive]);

  useEffect(() => {
    return () => {
      if (!miniPlayerActiveRef.current) return;
      const win = getCurrentWindow();
      setSuppressWindowGeometrySave(false);
      void win.setAlwaysOnTop(false).catch(() => undefined);
      if (preMiniPlayerSizeRef.current) void win.setSize(preMiniPlayerSizeRef.current).catch(() => undefined);
      if (preMiniPlayerPosRef.current) void win.setPosition(preMiniPlayerPosRef.current).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    activeCastDeviceIdRef.current = activeCastDeviceId;
    return () => { if (activeCastDeviceId) castDisconnect(); };
  }, [activeCastDeviceId]);

  useEffect(() => {
    const poll = async () => {
      try {
        const info = await playerGetPlaybackInfo();
        const parsedChapters = parseChapters(info.chaptersJson);
        chaptersRef.current = parsedChapters;
        setChapters(parsedChapters);
        setSkipSegments(parseSegments(info.skipSegmentsJson));
        setNextEpSubtitle(info.nextEpSubtitle ?? '');
        setNextEpThreshold(info.nextEpThresholdPercent ?? 85);
        setAutoPlayNextEpisode(info.autoPlayNextEpisode ?? false);
        setAutoPlayCountdownSecs(info.autoPlayCountdownSecs ?? 7);
        setAutoSkipSegments(info.autoSkipSegments ?? false);
        setEpisodes(parseEpisodes(info.episodesJson));
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!showNextEpCard) {
      setNextEpDismissed(false);
      setCountdown(null);
      return;
    }
    if (!autoPlayNextEpisode || nextEpDismissed) {
      setCountdown(null);
      return;
    }
    setCountdown(autoPlayCountdownSecs);
  }, [showNextEpCard, autoPlayNextEpisode, nextEpDismissed, autoPlayCountdownSecs]);

  useEffect(() => {
    if (countdown === null) return;
    const id = setInterval(() => {
      if (pausedRef.current) return;
      setCountdown((c) => (c !== null && c > 0 ? c - 1 : c));
    }, 1000);
    return () => clearInterval(id);
  }, [countdown === null]);

  useEffect(() => {
    if (countdown === 0) {
      resetActivity();
      void emit('native-player-next-episode', null);
    }
  }, [countdown]);

  useEffect(() => {
    let cancelled = false;
    listen<{ title?: string; episodeTitle?: string }>('native-player-title', (ev) => {
      if (cancelled) return;
      setTitle(ev.payload.title ?? '');
      setEpisodeTitle(ev.payload.episodeTitle ?? '');
      setAbLoopStage('none');
      autoSkippedKeysRef.current.clear();
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const triggerActiveSkip = useCallback(() => {
    if (!activeSkip) return false;
    resetActivity();
    sendCmd(`set time-pos ${Math.floor(activeSkip.endMs / 1000)}`);
    flashFeedback('seekFwd', activeSkip.label);
    return true;
  }, [activeSkip, flashFeedback, resetActivity]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      resetActivity();
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (holdTimerRef.current) return;
          holdActiveRef.current = false;
          {
            const spd = parseFloat(String((window as unknown as Record<string, unknown>).__fluxaSpeed ?? '1')) || 1;
            preSpeedRef.current = spd;
          }
          holdTimerRef.current = setTimeout(() => {
            holdActiveRef.current = true;
            sendCmd('set speed 2.00');
            flashFeedback('speed', '2×');
          }, 300);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          startSeekOverlay();
          flashFeedback('seekBack', '-10s');
          sendCmd('seek -10 relative');
          break;
        case 'ArrowRight':
          e.preventDefault();
          startSeekOverlay();
          flashFeedback('seekFwd', '+10s');
          sendCmd('seek 10 relative');
          break;
        case 'ArrowUp':
          e.preventDefault();
          sendCmd('add volume 5');
          break;
        case 'ArrowDown':
          e.preventDefault();
          sendCmd('add volume -5');
          break;
        case 'Digit9':
          e.preventDefault();
          sendCmd('add volume -5');
          break;
        case 'Digit0':
          e.preventDefault();
          sendCmd('add volume 5');
          break;
        case 'Period':
          e.preventDefault();
          sendCmd('frame-step');
          flashFeedback('seekFwd', t('player.frame_step'));
          break;
        case 'Comma':
          e.preventDefault();
          sendCmd('frame-back-step');
          flashFeedback('seekBack', t('player.frame_back_step'));
          break;
        case 'KeyS':
          if (triggerActiveSkip()) e.preventDefault();
          break;
        case 'Enter':
          if (triggerActiveSkip()) e.preventDefault();
          break;
        case 'KeyN':
          if (e.shiftKey && nextEpSubtitle) {
            e.preventDefault();
            void emit('native-player-next-episode', null);
          }
          break;
        case 'KeyM':
          e.preventDefault();
          sendCmd('cycle mute');
          break;
        case 'KeyZ':
          e.preventDefault();
          flashFeedback('subDelay', t('player.subtitle_delay_earlier'));
          sendCmd('add sub-delay -0.100');
          break;
        case 'KeyX':
          e.preventDefault();
          flashFeedback('subDelay', t('player.subtitle_delay_later'));
          sendCmd('add sub-delay 0.100');
          break;
        case 'KeyF':
        case 'F11':
          e.preventDefault();
          void toggleFullscreen();
          break;
        case 'Escape':
          e.preventDefault();
          if (contextMenu) { setContextMenu(null); return; }
          if (showEpisodePanel) { setShowEpisodePanel(false); episodePanelOpenRef.current = false; return; }
          if (trackPopover) { setTrackPopover(null); return; }
          if (isFullscreenRef.current) { isFullscreenRef.current = false; void getCurrentWindow().setFullscreen(false); }
          break;
        default:
          break;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
        if (holdActiveRef.current) {
          holdActiveRef.current = false;
          sendCmd(`set speed ${preSpeedRef.current.toFixed(2)}`);
        } else {
          const icon = pausedRef.current ? 'play' : 'pause';
          flashFeedback(icon, '');
          setPaused((prev) => !prev);
          sendCmd('cycle pause');
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [closePlayer, contextMenu, flashFeedback, nextEpSubtitle, resetActivity, showEpisodePanel, startSeekOverlay, toggleFullscreen, trackPopover, triggerActiveSkip]);

  useEffect(() => {
    return () => {
      getCurrentWindow().setCursorVisible(true).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onMouseDown = (e: MouseEvent) => {
      if (contextMenuRef.current?.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('blur', close);
    };
  }, [contextMenu]);

  useEffect(() => {
    const onMove = () => resetActivity();
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [resetActivity]);

  const onOverlayWheel = useCallback((e: React.WheelEvent) => {
    if (Math.abs(e.deltaY) < 2) return;
    resetActivity();
    if (e.shiftKey) {
      sendCmd(`add volume ${e.deltaY < 0 ? 5 : -5}`);
      return;
    }
    startSeekOverlay();
    const seconds = e.deltaY < 0 ? 5 : -5;
    flashFeedback(seconds > 0 ? 'seekFwd' : 'seekBack', `${seconds > 0 ? '+' : ''}${seconds}s`);
    sendCmd(`seek ${seconds} relative`);
  }, [flashFeedback, resetActivity, startSeekOverlay]);

  const onSeekMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    resetActivity();
    isDraggingRef.current = true;
    const frac = fractionFromSeekbarEvent(e.clientX);
    dragPosRef.current = frac;
    applyFills(frac);
  }, [fractionFromSeekbarEvent, resetActivity, applyFills]);

  useEffect(() => {
    const onMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      seekToFraction(dragPosRef.current);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const bar = seekbarRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      dragPosRef.current = frac;
      applyFills(frac);
    };
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    return () => {
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [seekToFraction, applyFills]);

  const openTrackPopover = useCallback(async (type: 'audio' | 'sub' | 'speed') => {
    resetActivity();
    if (trackPopover === type) { setTrackPopover(null); return; }
    if (type === 'audio') { try { setAudioTracks(await playerGetTrackOptions('audio')); } catch {} }
    else if (type === 'sub') { try { setSubTracks(await playerGetTrackOptions('sub')); } catch {} }
    setTrackPopover(type);
  }, [trackPopover, resetActivity]);

  const setSpeed = useCallback((speed: number) => {
    sendCmd(`set speed ${speed.toFixed(2)}`);
    setPlaybackSpeed(speed);
    setTrackPopover(null);
  }, []);

  const selectTrack = useCallback((type: 'audio' | 'sub', id: string) => {
    sendCmd(type === 'audio' ? `set aid ${id}` : `set sid ${id}`);
    setTrackPopover(null);
    if (type === 'audio') setAudioTracks((prev) => prev.map((tr) => ({ ...tr, selected: tr.id === id })));
    else setSubTracks((prev) => prev.map((tr) => ({ ...tr, selected: tr.id === id })));
  }, []);

  const disableSubs = useCallback(() => {
    sendCmd('set sid no');
    setSubTracks((prev) => prev.map((tr) => ({ ...tr, selected: false })));
    setTrackPopover(null);
  }, []);

  const openCastPopover = useCallback(async () => {
    resetActivity();
    if (castPopoverOpen) { setCastPopoverOpen(false); return; }
    setCastPopoverOpen(true);
    setCastDiscovering(true);
    setCastDevices(await discoverCastDevices());
    setCastDiscovering(false);
  }, [castPopoverOpen, resetActivity]);

  const selectCastDevice = useCallback(async (device: CastDevice) => {
    let status: EmbeddedMpvStatus | null = null;
    try { status = await invoke<EmbeddedMpvStatus>('player_status'); } catch {}
    const streamUrl = status?.path;
    if (!streamUrl) { setCastPopoverOpen(false); return; }
    const mediaUrl = initialStreamHeaders && Object.keys(initialStreamHeaders).length > 0
      ? await proxyMediaUrl(streamUrl, initialStreamHeaders)
      : await resolveCastMediaUrl(streamUrl);
    try {
      await startCasting(device, mediaUrl, title || episodeTitle || 'Fluxa', initialSubtitleUrl);
      setActiveCastDeviceId(device.id);
      setActiveCastDeviceName(device.name);
      setCastPaused(false);
      sendCmd('set pause yes');
    } catch {}
    setCastPopoverOpen(false);
  }, [title, episodeTitle, initialSubtitleUrl, initialStreamHeaders]);

  const disconnectCast = useCallback(() => {
    castDisconnect();
    setActiveCastDeviceId(null);
    setActiveCastDeviceName('');
    setCastPopoverOpen(false);
  }, []);

  const toggleCastPause = useCallback(() => {
    if (castPaused) { castPlay(); setCastPaused(false); }
    else { castPause(); setCastPaused(true); }
  }, [castPaused]);

  const cycleAbLoop = useCallback(() => {
    resetActivity();
    if (abLoopStage === 'none') {
      sendCmd(`set ab-loop-a ${posRef.current.toFixed(3)}`);
      setAbLoopStage('a');
      flashFeedback('abLoop', t('player.ab_loop_a_set'));
    } else if (abLoopStage === 'a') {
      sendCmd(`set ab-loop-b ${posRef.current.toFixed(3)}`);
      setAbLoopStage('ab');
      flashFeedback('abLoop', t('player.ab_loop_active'));
    } else {
      sendCmd('set ab-loop-a no');
      sendCmd('set ab-loop-b no');
      setAbLoopStage('none');
      flashFeedback('abLoop', t('player.ab_loop_cleared'));
    }
  }, [abLoopStage, resetActivity, flashFeedback]);

  const takeScreenshot = useCallback(async () => {
    resetActivity();
    try {
      await invoke<string>('player_screenshot', { suggestedName: title || 'fluxa' });
      flashFeedback('screenshot', t('player.screenshot_saved'));
    } catch {
      flashFeedback('screenshot', t('player.screenshot_failed'));
    }
  }, [resetActivity, flashFeedback, title]);

  const copyTimestamp = useCallback(async () => {
    const text = fmtTime(posRef.current);
    try { await navigator.clipboard.writeText(text); } catch {}
    flashFeedback('subDelay', text);
  }, [flashFeedback]);

  const centerClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const centerHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const centerHoldActiveRef = useRef(false);
  const centerHoldJustEndedRef = useRef(false);

  const onCenterMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    resetActivity();
    const spd = parseFloat(String((window as unknown as Record<string, unknown>).__fluxaSpeed ?? '1')) || 1;
    preSpeedRef.current = spd;
    centerHoldTimerRef.current = setTimeout(() => {
      centerHoldActiveRef.current = true;
      sendCmd('set speed 2.00');
      flashFeedback('speed', '2×');
    }, 300);
  }, [flashFeedback, resetActivity]);

  const releaseCenterHold = useCallback(() => {
    if (centerHoldTimerRef.current) { clearTimeout(centerHoldTimerRef.current); centerHoldTimerRef.current = null; }
    if (centerHoldActiveRef.current) {
      centerHoldActiveRef.current = false;
      centerHoldJustEndedRef.current = true;
      sendCmd(`set speed ${preSpeedRef.current.toFixed(2)}`);
    }
  }, []);

  const onCenterClick = useCallback(() => {
    if (centerHoldJustEndedRef.current) { centerHoldJustEndedRef.current = false; return; }
    resetActivity();
    if (showEpisodePanel) { setShowEpisodePanel(false); episodePanelOpenRef.current = false; return; }
    if (trackPopover) { setTrackPopover(null); return; }
    if (centerClickTimerRef.current) {
      clearTimeout(centerClickTimerRef.current);
      centerClickTimerRef.current = null;
      void toggleFullscreen();
      return;
    }
    centerClickTimerRef.current = setTimeout(() => {
      centerClickTimerRef.current = null;
      const icon = pausedRef.current ? 'play' : 'pause';
      flashFeedback(icon, '');
      setPaused((prev) => !prev);
      sendCmd('cycle pause');
    }, 250);
  }, [flashFeedback, resetActivity, showEpisodePanel, toggleFullscreen, trackPopover]);

  const opacityStyle: React.CSSProperties = {
    opacity: controlsVisible ? 1 : 0,
    transition: 'opacity 0.4s ease',
    pointerEvents: controlsVisible ? 'auto' : 'none',
  };

  const dur = durRef.current;
  const chapterSegments = chapters.length >= 2 && dur > 0
    ? chapters.map((ch, i) => {
        const start = ch.startMs / 1000 / dur;
        const end = i + 1 < chapters.length ? chapters[i + 1].startMs / 1000 / dur : 1;
        return { start, end };
      })
    : null;
  chapterSegmentsRef.current = chapterSegments;
  const skipMarkers = dur > 0
    ? skipSegments
        .map((seg) => ({
          start: Math.max(0, Math.min(1, (seg.startTime / 1000) / dur)),
          end: Math.max(0, Math.min(1, (seg.endTime / 1000) / dur)),
        }))
        .filter((seg) => seg.end > seg.start)
    : [];

  if (miniPlayerActive) {
    return (
      <div
        ref={overlayRef}
        onMouseMove={resetActivity}
        style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'transparent' }}
      >
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'rgba(255,255,255,0.15)' }}>
          <div ref={miniProgressRef} style={{ height: '100%', width: '0%', background: 'var(--primary-accent-color)' }} />
        </div>
        <div
          style={{ ...opacityStyle, position: 'absolute', bottom: 2, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '8px 10px', background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)' }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); resetActivity(); flashFeedback(paused ? 'play' : 'pause', ''); setPaused((prev) => !prev); sendCmd('cycle pause'); }}
            className="fluxa-ibtn"
            style={styles.iconBtn}
            title={paused ? t('player.play') : t('player.pause')}
          >
            {paused ? <Play size={16} fill="currentColor" strokeWidth={0} /> : <Pause size={16} fill="currentColor" strokeWidth={0} />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); resetActivity(); void toggleMiniPlayer(); }}
            className="fluxa-ibtn"
            style={styles.iconBtn}
            title={t('player.restore_window')}
          >
            <Minimize2 size={16} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); void closePlayer(); }}
            className="fluxa-ibtn"
            style={styles.iconBtn}
            title={t('player.back')}
          >
            <ChevronLeft size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={overlayRef}
      style={{ position: 'fixed', inset: 0, zIndex: 9998, display: 'flex', flexDirection: 'column', background: 'transparent' }}
      onWheel={onOverlayWheel}
      onContextMenu={(e) => { e.preventDefault(); resetActivity(); setContextMenu({ x: e.clientX, y: e.clientY }); }}
    >
      <style>{`
        @keyframes fluxa-seek-spin { to { transform: rotate(360deg); } }
        @keyframes fluxa-skip-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .fluxa-ibtn { opacity: 0.8; transition: opacity 0.15s, background 0.12s; }
        .fluxa-ibtn:hover { opacity: 1; background: rgba(255,255,255,0.09) !important; }
        .fluxa-skip-btn { animation: fluxa-skip-in 0.18s ease-out; transition: background 0.12s, border-color 0.12s; }
        .fluxa-skip-btn:hover { background: rgba(255,255,255,0.1) !important; border-color: rgba(255,255,255,0.22) !important; }
        .fluxa-skip-btn:focus-visible { outline: 2px solid rgba(255,255,255,0.4); outline-offset: 2px; }
        .fluxa-cursor-hidden, .fluxa-cursor-hidden * { cursor: none !important; }
        .fluxa-seek-track { height: 3px; transition: height 0.15s ease; }
        .fluxa-seekbar:hover .fluxa-seek-track { height: 5px; }
        .fluxa-seek-dot { width: 11px; height: 11px; transition: width 0.15s, height 0.15s; }
        .fluxa-seekbar:hover .fluxa-seek-dot { width: 14px; height: 14px; }
      `}</style>

      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 140, background: 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)', pointerEvents: 'none', zIndex: 1 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 230, background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.5) 45%, transparent 100%)', pointerEvents: 'none', zIndex: 1 }} />

      <div style={{ ...opacityStyle, position: 'absolute', top: bannerOffset, left: 0, right: 0, zIndex: 3, display: 'flex', alignItems: 'center', padding: '14px 12px', gap: 6 }}>
        <button
          onClick={(e) => { e.stopPropagation(); resetActivity(); void closePlayer(); }}
          className="fluxa-ibtn"
          style={styles.iconBtn}
          title={t('player.back')}
        >
          <ChevronLeft size={22} />
        </button>
        <div style={{ flex: 1, minWidth: 0, padding: '0 6px', overflow: 'hidden' }}>
          {(title || episodeTitle) && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, overflow: 'hidden' }}>
              {title && (
                <span style={{ color: '#fff', fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 1 auto', minWidth: 0 }}>
                  {title}
                </span>
              )}
              {title && episodeTitle && (
                <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 14, flexShrink: 0 }}>·</span>
              )}
              {episodeTitle && (
                <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                  {episodeTitle}
                </span>
              )}
            </div>
          )}
          {activeCastDeviceId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <Cast size={11} style={{ color: 'var(--primary-accent-color)' }} />
              <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11 }}>{t('player.casting_to', activeCastDeviceName)}</span>
            </div>
          )}
        </div>
        {activeCastDeviceId && (
          <button onClick={(e) => { e.stopPropagation(); resetActivity(); toggleCastPause(); }} className="fluxa-ibtn" style={styles.iconBtn} title={castPaused ? t('player.play') : t('player.pause')}>
            {castPaused ? <Play size={18} /> : <Pause size={18} />}
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); void openCastPopover(); }}
          className="fluxa-ibtn"
          style={{ ...styles.iconBtn, color: activeCastDeviceId ? 'var(--primary-accent-color)' : undefined }}
          title={t('player.cast')}
        >
          <Cast size={20} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); resetActivity(); void toggleMiniPlayer(); }}
          className="fluxa-ibtn"
          style={{ ...styles.iconBtn, color: miniPlayerActive ? 'var(--primary-accent-color)' : undefined }}
          title={t('player.picture_in_picture')}
        >
          <PictureInPicture2 size={20} />
        </button>
      </div>

      <div style={{ flex: 1, cursor: 'default' }} onMouseDown={onCenterMouseDown} onMouseUp={releaseCenterHold} onMouseLeave={releaseCenterHold} onClick={onCenterClick} />

      {feedback && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', borderRadius: 14, padding: '12px 22px', display: 'flex', alignItems: 'center', gap: 8, color: '#fff', fontSize: 18, fontWeight: 700, pointerEvents: 'none', zIndex: 5 }}>
          {feedback.icon === 'play' && <Play size={20} fill="currentColor" strokeWidth={0} />}
          {feedback.icon === 'pause' && <Pause size={20} fill="currentColor" strokeWidth={0} />}
          {feedback.icon === 'seekBack' && <RotateCcw size={20} />}
          {feedback.icon === 'seekFwd' && <RotateCw size={20} />}
          {feedback.icon === 'speed' && <Gauge size={20} />}
          {feedback.icon === 'abLoop' && <Repeat size={20} />}
          {feedback.icon === 'screenshot' && <Camera size={20} />}
          {feedback.icon === 'subDelay' && <Captions size={20} />}
          {feedback.label && <span>{feedback.label}</span>}
        </div>
      )}

      {showSeekOverlay && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 4, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid rgba(255,255,255,0.15)', borderTopColor: 'rgba(255,255,255,0.75)', animation: 'fluxa-seek-spin 0.75s linear infinite' }} />
        </div>
      )}

      {activeSkip && (
        <div style={{ position: 'absolute', bottom: 106, right: 22, zIndex: 4 }}>
          <button
            onClick={(e) => { e.stopPropagation(); resetActivity(); sendCmd(`set time-pos ${Math.floor(activeSkip.endMs / 1000)}`); }}
            className="fluxa-skip-btn"
            style={styles.skipBtn}
          >
            <SkipForward size={17} />
            {activeSkip.label}
            <div ref={skipFillRef} style={{ position: 'absolute', left: 0, bottom: 0, height: 2, width: '0%', background: 'rgba(255,255,255,0.4)' }} />
          </button>
        </div>
      )}

      {showNextEpCard && nextEpSubtitle && !showEpisodePanel && (
        <NextEpCard
          subtitle={nextEpSubtitle}
          posterUrl={initialPosterUrl}
          countdown={countdown}
          countdownTotal={autoPlayCountdownSecs}
          bottom={activeSkip ? 160 : 106}
          onPlay={() => { resetActivity(); void emit('native-player-next-episode', null); }}
          onDismiss={() => setNextEpDismissed(true)}
        />
      )}

      {showEpisodePanel && (
        <EpisodePanel
          episodes={episodes}
          episodeTitle={episodeTitle}
          onClose={() => { setShowEpisodePanel(false); episodePanelOpenRef.current = false; }}
        />
      )}

      {trackPopover && (
        <TrackPopover
          type={trackPopover}
          audioTracks={audioTracks}
          subTracks={subTracks}
          playbackSpeed={playbackSpeed}
          showEpisodePanel={showEpisodePanel}
          onSetSpeed={setSpeed}
          onSelectTrack={selectTrack}
          onDisableSubs={disableSubs}
        />
      )}

      {castPopoverOpen && (
        <CastPopover
          devices={castDevices}
          discovering={castDiscovering}
          activeDeviceId={activeCastDeviceId}
          showEpisodePanel={showEpisodePanel}
          onSelectDevice={(device) => void selectCastDevice(device)}
          onDisconnect={disconnectCast}
        />
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: 'rgba(18,22,30,0.97)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10,
            padding: '6px 0',
            minWidth: 180,
            zIndex: 20,
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            onClick={() => { cycleAbLoop(); setContextMenu(null); }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', color: abLoopStage !== 'none' ? 'var(--primary-accent-color)' : 'rgba(255,255,255,0.85)', fontSize: 13, padding: '8px 14px', cursor: 'pointer', textAlign: 'left' }}
          >
            <Repeat size={15} />
            {abLoopStage === 'none' ? t('player.ab_loop') : abLoopStage === 'a' ? t('player.ab_loop_a_set') : t('player.ab_loop_active')}
          </button>
          <button
            onClick={() => { void copyTimestamp(); setContextMenu(null); }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', color: 'rgba(255,255,255,0.85)', fontSize: 13, padding: '8px 14px', cursor: 'pointer', textAlign: 'left' }}
          >
            <Clock size={15} />
            {t('player.copy_timestamp')}
          </button>
          <button
            onClick={() => { sendCmd('keypress i'); setContextMenu(null); }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', color: 'rgba(255,255,255,0.85)', fontSize: 13, padding: '8px 14px', cursor: 'pointer', textAlign: 'left' }}
          >
            <Info size={15} />
            {t('player.stats')}
          </button>
          <button
            onClick={() => { void openTrackPopover('audio'); setContextMenu(null); }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', color: 'rgba(255,255,255,0.85)', fontSize: 13, padding: '8px 14px', cursor: 'pointer', textAlign: 'left' }}
          >
            <AudioLines size={15} />
            {t('player.track_info')}
          </button>
          <button
            onClick={() => { void takeScreenshot(); setContextMenu(null); }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', color: 'rgba(255,255,255,0.85)', fontSize: 13, padding: '8px 14px', cursor: 'pointer', textAlign: 'left' }}
          >
            <Camera size={15} />
            {t('player.screenshot')}
          </button>
        </div>
      )}

      <div
        style={{
          ...opacityStyle,
          position: 'relative',
          paddingRight: showEpisodePanel ? 380 : 0,
          background: 'transparent',
          zIndex: 2,
          overflow: 'visible',
        }}
        onMouseEnter={() => { isOverControlsRef.current = true; }}
        onMouseLeave={() => { isOverControlsRef.current = false; }}
      >
        <div
          ref={seekbarRef}
          className="fluxa-seekbar"
          style={{ position: 'relative', width: '100%', height: 36, cursor: 'pointer', overflow: 'visible', display: 'flex', alignItems: 'center' }}
          onMouseDown={onSeekMouseDown}
        >
          <div className="fluxa-seek-track" style={{ position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.22)', borderRadius: 3 }} />
          {!chapterSegments && skipMarkers.map((seg, i) => (
            <div
              key={`${seg.start}-${seg.end}-${i}`}
              className="fluxa-seek-track"
              style={{
                position: 'absolute',
                left: `${seg.start * 100}%`,
                width: `${(seg.end - seg.start) * 100}%`,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'color-mix(in srgb, var(--primary-accent-color) 20%, transparent)',
                borderRadius: 3,
                pointerEvents: 'none',
              }}
            />
          ))}

          {chapterSegments ? (
            chapterSegments.map((seg, i) => (
              <div key={i} className="fluxa-seek-track" style={{ position: 'absolute', left: `calc(${seg.start * 100}% + 2px)`, width: `calc(${(seg.end - seg.start) * 100}% - 4px)`, top: '50%', transform: 'translateY(-50%)', overflow: 'hidden', background: 'rgba(255,255,255,0.18)', borderRadius: 2 }}>
                <div ref={(el) => { segBufRefs.current[i] = el; }} style={{ position: 'absolute', left: 0, top: 0, width: '0%', height: '100%', background: 'rgba(255,255,255,0.3)' }} />
                <div ref={(el) => { segFillRefs.current[i] = el; }} style={{ position: 'absolute', left: 0, top: 0, width: '0%', height: '100%', background: 'var(--primary-accent-color)' }} />
              </div>
            ))
          ) : (
            <>
              <div ref={seekBufferRef} className="fluxa-seek-track" style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: '0%', background: 'rgba(255,255,255,0.3)', borderRadius: 3 }} />
              <div ref={seekFillRef} className="fluxa-seek-track" style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: '0%', background: 'var(--primary-accent-color)', borderRadius: 3 }} />
            </>
          )}

          <div
            ref={seekDotRef}
            className="fluxa-seek-dot"
            style={{ position: 'absolute', left: '0%', top: '50%', borderRadius: '50%', background: 'var(--primary-accent-color)', transform: 'translate(-50%, -50%)', boxShadow: '0 1px 6px rgba(0,0,0,0.7)', pointerEvents: 'none' }}
          />

          <SeekPreview barRef={seekbarRef} durRef={durRef} chaptersRef={chaptersRef} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px 14px', gap: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); resetActivity(); flashFeedback(paused ? 'play' : 'pause', ''); setPaused((prev) => !prev); sendCmd('cycle pause'); }}
            className="fluxa-ibtn"
            style={{ ...styles.iconBtn, width: 48, height: 48 }}
            title={paused ? t('player.play') : t('player.pause')}
          >
            {paused ? <Play size={26} fill="currentColor" strokeWidth={0} /> : <Pause size={26} fill="currentColor" strokeWidth={0} />}
          </button>
          <button onClick={(e) => { e.stopPropagation(); resetActivity(); startSeekOverlay(); flashFeedback('seekBack', '-10s'); sendCmd('seek -10 relative'); }} className="fluxa-ibtn" style={styles.iconBtn} title={t('player.seek_back')}>
            <RotateCcw size={22} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); resetActivity(); startSeekOverlay(); flashFeedback('seekFwd', '+10s'); sendCmd('seek 10 relative'); }} className="fluxa-ibtn" style={styles.iconBtn} title={t('player.seek_forward')}>
            <RotateCw size={22} />
          </button>
          <div
            style={{ display: 'flex', alignItems: 'center', position: 'relative' }}
            onMouseEnter={() => { if (volumeHideTimer.current) clearTimeout(volumeHideTimer.current); setShowVolumeSlider(true); }}
            onMouseLeave={() => { volumeHideTimer.current = setTimeout(() => setShowVolumeSlider(false), 200); }}
            onWheel={(e) => {
              e.stopPropagation();
              resetActivity();
              sendCmd(`add volume ${e.deltaY < 0 ? 5 : -5}`);
            }}
          >
            <button onClick={(e) => { e.stopPropagation(); resetActivity(); setMuted((prev) => !prev); sendCmd('cycle mute'); }} className="fluxa-ibtn" style={styles.iconBtn} title={muted ? t('player.unmute') : t('player.mute')}>
              <IconVolume muted={muted} level={volumeLevel} />
            </button>
            <div style={{ position: 'absolute', left: '100%', top: '50%', transform: 'translateY(-50%)', opacity: showVolumeSlider ? 1 : 0, pointerEvents: showVolumeSlider ? 'auto' : 'none', transition: 'opacity 0.18s ease', display: 'flex', alignItems: 'center', paddingLeft: 4, paddingRight: 8 }}>
              <VolumeBar
                value={muted ? 0 : volumeLevel}
                max={130}
                onChange={(v) => {
                  resetActivity();
                  if (activeCastDeviceIdRef.current) { castSetVolume(v / 100); return; }
                  sendCmd(`set volume ${v}`);
                  if (muted && v > 0) sendCmd('set mute no');
                }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, paddingLeft: 10, pointerEvents: 'none', flexShrink: 0 }}>
            <span ref={currentTimeRef} style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'rgba(255,255,255,0.9)', letterSpacing: 0.2 }}>0:00</span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>/</span>
            <span ref={durationRef} style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'rgba(255,255,255,0.4)', letterSpacing: 0.2 }}>0:00</span>
          </div>

          <div style={{ flex: 1 }} />

          {nextEpSubtitle && (
            <button onClick={(e) => { e.stopPropagation(); resetActivity(); void emit('native-player-next-episode', null); }} className="fluxa-ibtn" style={styles.iconBtn} title={t('player.next_label', nextEpSubtitle)}>
              <SkipForward size={22} />
            </button>
          )}
          {episodes.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                resetActivity();
                const next = !showEpisodePanel;
                setShowEpisodePanel(next);
                episodePanelOpenRef.current = next;
              }}
              className="fluxa-ibtn"
              style={styles.iconBtn}
              title={t('player.episodes')}
            >
              <GalleryVerticalEnd size={22} />
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); void openTrackPopover('sub'); }} className="fluxa-ibtn" style={styles.iconBtn} title={t('player.subtitles')}>
            <Captions size={22} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); void openTrackPopover('audio'); }} className="fluxa-ibtn" style={styles.iconBtn} title={t('player.audio')}>
            <AudioLines size={22} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); void openTrackPopover('speed'); }} className="fluxa-ibtn" style={styles.iconBtn} title={t('player.speed_label', playbackSpeed === 1 ? t('player.normal') : `${playbackSpeed}×`)}>
            <Gauge size={22} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); resetActivity(); void toggleFullscreen(); }} className="fluxa-ibtn" style={styles.iconBtn} title={t('player.fullscreen')}>
            <Fullscreen size={22} />
          </button>
        </div>
      </div>
    </div>
  );
}

function SeekPreview({ barRef, durRef, chaptersRef }: {
  barRef: React.RefObject<HTMLDivElement | null>;
  durRef: React.MutableRefObject<number>;
  chaptersRef: React.MutableRefObject<Chapter[]>;
}) {
  const [preview, setPreview] = useState<{ x: number; time: number; chapter: string | null } | null>(null);
  const [thumbImg, setThumbImg] = useState<string | null>(null);
  const thumbTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbRequestTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const onMove = (e: MouseEvent) => {
      const rect = bar.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const previewTime = frac * durRef.current;
      const chaps = chaptersRef.current;
      let chapterName: string | null = null;
      if (chaps.length > 0) {
        let found = chaps[0].title;
        for (const ch of chaps) {
          if (ch.startMs / 1000 <= previewTime) found = ch.title;
          else break;
        }
        chapterName = found || null;
      }
      setPreview({ x: e.clientX - rect.left, time: previewTime, chapter: chapterName });
    };
    const onLeave = () => setPreview(null);
    bar.addEventListener('mousemove', onMove);
    bar.addEventListener('mouseleave', onLeave);
    return () => {
      bar.removeEventListener('mousemove', onMove);
      bar.removeEventListener('mouseleave', onLeave);
    };
  }, [barRef, durRef, chaptersRef]);

  useEffect(() => {
    if (!preview) { setThumbImg(null); return; }
    const requestedTime = preview.time;
    thumbRequestTimeRef.current = requestedTime;
    if (thumbTimerRef.current) clearTimeout(thumbTimerRef.current);
    thumbTimerRef.current = setTimeout(() => {
      invoke<string>('player_get_seek_thumbnail', { timePos: requestedTime })
        .then((img) => { if (img && thumbRequestTimeRef.current === requestedTime) setThumbImg(img); })
        .catch(() => undefined);
    }, 120);
    return () => {
      if (thumbTimerRef.current) clearTimeout(thumbTimerRef.current);
    };
  }, [preview?.time]);

  if (!preview) return null;

  return (
    <div style={{ position: 'absolute', bottom: 22, left: preview.x, transform: 'translateX(-50%)', pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      {thumbImg && (
        <div style={{ width: 160, height: 90, borderRadius: 4, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.12)', flexShrink: 0 }}>
          <img src={thumbImg} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
      )}
      <div style={{ whiteSpace: 'nowrap', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        {preview.chapter && (
          <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)', letterSpacing: 0.2, textShadow: '0 1px 6px rgba(0,0,0,1), 0 0 12px rgba(0,0,0,0.9)' }}>
            {preview.chapter}
          </span>
        )}
        <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', letterSpacing: 0.4, textShadow: '0 1px 6px rgba(0,0,0,1), 0 0 12px rgba(0,0,0,0.9)' }}>
          {fmtTime(preview.time)}
        </span>
      </div>
    </div>
  );
}

const styles = {
  iconBtn: {
    background: 'none',
    border: 'none',
    color: '#fff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    borderRadius: 8,
    padding: 0,
    flexShrink: 0,
  } as React.CSSProperties,

  skipBtn: {
    appearance: 'none',
    background: 'rgba(20,22,28,0.92)',
    boxShadow: 'none',
    outline: 'none',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 8,
    color: '#fff',
    fontSize: 15,
    fontWeight: 600,
    padding: '12px 22px',
    cursor: 'pointer',
    letterSpacing: 0.2,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    position: 'relative',
    overflow: 'hidden',
  } as React.CSSProperties,
} satisfies Record<string, React.CSSProperties>;

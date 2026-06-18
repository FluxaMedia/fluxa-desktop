import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  AudioLines,
  Captions,
  Cast,
  ChevronLeft,
  Fullscreen,
  GalleryVerticalEnd,
  Gauge,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  SkipForward,
  Volume1,
  Volume2,
  VolumeOff,
} from 'lucide-react';
import type { EmbeddedMpvStatus } from '../core/mpvPlayer';
import { playerGetPlaybackInfo, playerGetTrackOptions } from '../core/mpvPlayer';
import type { PlayerTrackOption } from '../core/mpvPlayer';
import { VolumeBar } from './player/VolumeBar';
import { NextEpCard } from './player/NextEpCard';
import { EpisodePanel, epLabel } from './player/EpisodePanel';
import type { EpisodeInfo } from './player/EpisodePanel';
import { TrackPopover } from './player/TrackPopover';

type Chapter = { title: string; startMs: number };
type SkipSegment = { type: string; startTime: number; endTime: number };
type ActiveSkip = { label: string; startMs: number; endMs: number };
type FeedbackFlash = { icon: 'play' | 'pause' | 'seekBack' | 'seekFwd' | 'speed'; label: string };

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
    case 'intro': return 'Skip Intro';
    case 'outro': return 'Skip Outro';
    case 'recap': return 'Skip Recap';
    case 'preview': return 'Skip Preview';
    default: return 'Skip';
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
  bannerOffset?: number;
}

export function ReactPlayerOverlay({ closePlayer, onFirstFrame, initialTitle, initialEpisodeTitle, bannerOffset = 0 }: Props) {
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
  const [skipProgress, setSkipProgress] = useState(0);
  const [showNextEpCard, setShowNextEpCard] = useState(false);
  const [trackPopover, setTrackPopover] = useState<'audio' | 'sub' | 'speed' | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [audioTracks, setAudioTracks] = useState<PlayerTrackOption[]>([]);
  const [subTracks, setSubTracks] = useState<PlayerTrackOption[]>([]);
  const [feedback, setFeedback] = useState<FeedbackFlash | null>(null);
  const [seekPreview, setSeekPreview] = useState<{ x: number; time: number; chapter: string | null } | null>(null);
  const [seekThumbImg, setSeekThumbImg] = useState<string | null>(null);
  const seekThumbTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const volumeHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showSeekOverlay, setShowSeekOverlay] = useState(false);
  const seekOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const seekFillRef = useRef<HTMLDivElement>(null);
  const seekBufferRef = useRef<HTMLDivElement>(null);
  const seekDotRef = useRef<HTMLDivElement>(null);
  const currentTimeRef = useRef<HTMLSpanElement>(null);
  const durationRef = useRef<HTMLSpanElement>(null);
  const seekbarRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const segFillRefs = useRef<(HTMLDivElement | null)[]>([]);
  const segBufRefs = useRef<(HTMLDivElement | null)[]>([]);
  const chapterSegmentsRef = useRef<Array<{ start: number; end: number }> | null>(null);
  const chaptersRef = useRef<Chapter[]>([]);

  const posRef = useRef(0);
  const durRef = useRef(0);
  const pausedRef = useRef(false);
  const lastActivityRef = useRef(Date.now());
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

  useEffect(() => {
    const win = getCurrentWindow();
    win.isFullscreen().then((fs) => { isFullscreenRef.current = fs; }).catch(() => {});
    let unlisten: (() => void) | null = null;
    win.listen('tauri://resize', () => {
      win.isFullscreen().then((fs) => { isFullscreenRef.current = fs; }).catch(() => {});
    }).then((u) => { unlisten = u; }).catch(() => {});
    return () => { unlisten?.(); };
  }, []);

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (!controlsVisibleRef.current) {
      controlsVisibleRef.current = true;
      setControlsVisible(true);
      if (overlayRef.current) overlayRef.current.classList.remove('fluxa-cursor-hidden');
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const next = !isFullscreenRef.current;
    isFullscreenRef.current = next;
    await getCurrentWindow().setFullscreen(next);
  }, []);

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
    sendCmd(`set time-pos ${Math.floor(tt)}`);
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

      if (!firstFrameFiredRef.current && onFirstFrame) {
        const voReady = status.voConfigured === 'yes';
        const audioPlaying = !voReady && status.coreIdle === 'no' && !isPaused && pos > 0;
        // Safety net for video-less streams: vo-configured never arrives, so
        // don't leave playback paused forever waiting for a frame that won't come.
        const timedOut = Date.now() - loadStartedAtRef.current > 4000;
        if (voReady || audioPlaying || timedOut) {
          firstFrameFiredRef.current = true;
          // mpv stays paused from load() until now, so audio doesn't start
          // ahead of the picture -- release it the moment the frame is ready.
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
      if (idle > 3000 && !isPaused && !episodePanelOpenRef.current && trackPopover === null) {
        if (controlsVisibleRef.current) {
          controlsVisibleRef.current = false;
          setControlsVisible(false);
          if (overlayRef.current) overlayRef.current.classList.add('fluxa-cursor-hidden');
        }
      }

      const posMs = pos * 1000;
      const seg = skipSegments.find((s) => posMs >= s.startTime && posMs < s.endTime);
      const newSkipKey = seg ? `${seg.type}:${seg.endTime}` : null;
      if (newSkipKey !== activeSkipKeyRef.current) {
        activeSkipKeyRef.current = newSkipKey;
        setActiveSkip(seg ? { label: skipLabelForType(seg.type), startMs: seg.startTime, endMs: seg.endTime } : null);
      }
      if (seg) {
        const span = seg.endTime - seg.startTime;
        setSkipProgress(span > 0 ? Math.min(1, Math.max(0, (posMs - seg.startTime) / span)) : 0);
      }

      if (dur > 0 && nextEpSubtitle) {
        const progress = (pos / dur) * 100;
        setShowNextEpCard(progress >= nextEpThreshold);
      } else {
        setShowNextEpCard(false);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [skipSegments, nextEpSubtitle, nextEpThreshold, trackPopover, onFirstFrame, applyFills]);

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
        setEpisodes(parseEpisodes(info.episodesJson));
      } catch { /* renderer may not be ready yet */ }
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
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

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
        case 'KeyM':
          e.preventDefault();
          sendCmd('cycle mute');
          break;
        case 'KeyF':
        case 'F11':
          e.preventDefault();
          void toggleFullscreen();
          break;
        case 'Escape':
          e.preventDefault();
          if (showEpisodePanel) { setShowEpisodePanel(false); episodePanelOpenRef.current = false; return; }
          if (trackPopover) { setTrackPopover(null); return; }
          void (async () => {
            if (isFullscreenRef.current) { isFullscreenRef.current = false; await getCurrentWindow().setFullscreen(false); return; }
            await closePlayer();
          })();
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
  }, [closePlayer, flashFeedback, resetActivity, showEpisodePanel, startSeekOverlay, toggleFullscreen, trackPopover]);

  useEffect(() => {
    const onMove = () => resetActivity();
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [resetActivity]);

  const onSeekMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    resetActivity();
    isDraggingRef.current = true;
    const frac = fractionFromSeekbarEvent(e.clientX);
    dragPosRef.current = frac;
    applyFills(frac);
  }, [fractionFromSeekbarEvent, resetActivity, applyFills]);

  const onSeekMouseMove = useCallback((e: React.MouseEvent) => {
    const bar = seekbarRef.current;
    if (!bar) return;
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
    setSeekPreview({ x: e.clientX - rect.left, time: previewTime, chapter: chapterName });
    if (isDraggingRef.current) {
      dragPosRef.current = frac;
      applyFills(frac);
    }
  }, [applyFills]);

  const onSeekMouseLeave = useCallback(() => {
    setSeekPreview(null);
    setSeekThumbImg(null);
    if (seekThumbTimerRef.current) { clearTimeout(seekThumbTimerRef.current); seekThumbTimerRef.current = null; }
  }, []);

  useEffect(() => {
    if (!seekPreview) { setSeekThumbImg(null); return; }
    const time = seekPreview.time;
    if (seekThumbTimerRef.current) clearTimeout(seekThumbTimerRef.current);
    seekThumbTimerRef.current = setTimeout(() => {
      invoke<string>('player_get_seek_thumbnail', { timePos: time })
        .then((img) => { if (img) setSeekThumbImg(img); })
        .catch(() => undefined);
    }, 120);
    return () => {
      if (seekThumbTimerRef.current) clearTimeout(seekThumbTimerRef.current);
    };
  }, [seekPreview?.time]);

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
    if (type === 'audio') { try { setAudioTracks(await playerGetTrackOptions('audio')); } catch { /* ignore */ } }
    else if (type === 'sub') { try { setSubTracks(await playerGetTrackOptions('sub')); } catch { /* ignore */ } }
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

  const seekHovered = seekPreview !== null;

  return (
    <div
      ref={overlayRef}
      style={{ position: 'fixed', inset: 0, zIndex: 9998, display: 'flex', flexDirection: 'column', background: 'transparent' }}
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
      `}</style>

      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 140, background: 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)', pointerEvents: 'none', zIndex: 1 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 230, background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.5) 45%, transparent 100%)', pointerEvents: 'none', zIndex: 1 }} />

      {/* Top bar */}
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
                <span style={{ color: '#fff', fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0, maxWidth: '55%' }}>
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
        </div>
        <button onClick={(e) => { e.stopPropagation(); resetActivity(); }} className="fluxa-ibtn" style={styles.iconBtn} title={t('player.cast')}>
          <Cast size={20} />
        </button>
        <button
          onClick={async (e) => {
            e.stopPropagation();
            resetActivity();
            try { await (document as unknown as Record<string, unknown>).pictureInPictureElement
              ? (document as unknown as { exitPictureInPicture: () => Promise<void> }).exitPictureInPicture()
              : await (document.querySelector('video') as HTMLVideoElement & { requestPictureInPicture: () => Promise<void> })?.requestPictureInPicture?.();
            } catch { /* not supported */ }
          }}
          className="fluxa-ibtn"
          style={styles.iconBtn}
          title={t('player.picture_in_picture')}
        >
          <PictureInPicture2 size={20} />
        </button>
      </div>

      {/* Center */}
      <div style={{ flex: 1, cursor: 'default' }} onMouseDown={onCenterMouseDown} onMouseUp={releaseCenterHold} onMouseLeave={releaseCenterHold} onClick={onCenterClick} />

      {feedback && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', borderRadius: 14, padding: '12px 22px', display: 'flex', alignItems: 'center', gap: 8, color: '#fff', fontSize: 18, fontWeight: 700, pointerEvents: 'none', zIndex: 5 }}>
          {feedback.icon === 'play' && <Play size={20} fill="currentColor" strokeWidth={0} />}
          {feedback.icon === 'pause' && <Pause size={20} fill="currentColor" strokeWidth={0} />}
          {feedback.icon === 'seekBack' && <RotateCcw size={20} />}
          {feedback.icon === 'seekFwd' && <RotateCw size={20} />}
          {feedback.icon === 'speed' && <Gauge size={20} />}
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
            <div style={{ position: 'absolute', left: 0, bottom: 0, height: 2, width: `${skipProgress * 100}%`, background: 'rgba(255,255,255,0.4)' }} />
          </button>
        </div>
      )}

      {showNextEpCard && nextEpSubtitle && !showEpisodePanel && (
        <NextEpCard
          subtitle={nextEpSubtitle}
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

      {/* Bottom controls */}
      <div
        style={{
          ...opacityStyle,
          position: 'relative',
          paddingRight: showEpisodePanel ? 380 : 0,
          background: 'transparent',
          zIndex: 2,
          overflow: 'visible',
        }}
      >
        {/* Seekbar */}
        <div
          ref={seekbarRef}
          style={{ position: 'relative', width: '100%', height: 36, cursor: 'pointer', overflow: 'visible', display: 'flex', alignItems: 'center' }}
          onMouseDown={onSeekMouseDown}
          onMouseMove={onSeekMouseMove}
          onMouseLeave={onSeekMouseLeave}
        >
          <div style={{ position: 'absolute', left: 0, right: 0, height: seekHovered ? 5 : 3, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.22)', borderRadius: 3, transition: 'height 0.15s ease' }} />

          {chapterSegments ? (
            chapterSegments.map((seg, i) => (
              <div key={i} style={{ position: 'absolute', left: `calc(${seg.start * 100}% + 2px)`, width: `calc(${(seg.end - seg.start) * 100}% - 4px)`, height: seekHovered ? 5 : 3, top: '50%', transform: 'translateY(-50%)', overflow: 'hidden', background: 'rgba(255,255,255,0.18)', borderRadius: 2, transition: 'height 0.15s ease' }}>
                <div ref={(el) => { segBufRefs.current[i] = el; }} style={{ position: 'absolute', left: 0, top: 0, width: '0%', height: '100%', background: 'rgba(255,255,255,0.5)' }} />
                <div ref={(el) => { segFillRefs.current[i] = el; }} style={{ position: 'absolute', left: 0, top: 0, width: '0%', height: '100%', background: '#E53935' }} />
              </div>
            ))
          ) : (
            <>
              <div ref={seekBufferRef} style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: '0%', height: seekHovered ? 5 : 3, background: 'rgba(255,255,255,0.5)', borderRadius: 3, transition: 'height 0.15s ease' }} />
              <div ref={seekFillRef} style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: '0%', height: seekHovered ? 5 : 3, background: '#E53935', borderRadius: 3, transition: 'height 0.15s ease' }} />
            </>
          )}

          <div
            ref={seekDotRef}
            style={{ position: 'absolute', left: '0%', top: '50%', width: seekHovered ? 14 : 11, height: seekHovered ? 14 : 11, borderRadius: '50%', background: '#E53935', transform: 'translate(-50%, -50%)', boxShadow: '0 1px 6px rgba(0,0,0,0.7)', pointerEvents: 'none', transition: 'width 0.15s, height 0.15s' }}
          />

          {seekPreview && (
            <div style={{ position: 'absolute', bottom: 22, left: seekPreview.x, transform: 'translateX(-50%)', pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              {seekThumbImg && (
                <div style={{ width: 160, height: 90, borderRadius: 4, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.12)', flexShrink: 0 }}>
                  <img src={seekThumbImg} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
              )}
              <div style={{ whiteSpace: 'nowrap', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                {seekPreview.chapter && (
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)', letterSpacing: 0.2, textShadow: '0 1px 6px rgba(0,0,0,1), 0 0 12px rgba(0,0,0,0.9)' }}>
                    {seekPreview.chapter}
                  </span>
                )}
                <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', letterSpacing: 0.4, textShadow: '0 1px 6px rgba(0,0,0,1), 0 0 12px rgba(0,0,0,0.9)' }}>
                  {fmtTime(seekPreview.time)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Controls row */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px 14px', gap: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); resetActivity(); flashFeedback(paused ? 'play' : 'pause', ''); sendCmd('cycle pause'); }}
            className="fluxa-ibtn"
            style={{ ...styles.iconBtn, width: 48, height: 48 }}
            title={paused ? 'Play' : 'Pause'}
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
          >
            <button onClick={(e) => { e.stopPropagation(); resetActivity(); sendCmd('cycle mute'); }} className="fluxa-ibtn" style={styles.iconBtn} title={muted ? 'Unmute' : 'Mute'}>
              <IconVolume muted={muted} level={volumeLevel} />
            </button>
            <div style={{ overflow: 'hidden', width: showVolumeSlider ? 96 : 0, opacity: showVolumeSlider ? 1 : 0, transition: 'width 0.22s ease, opacity 0.18s ease', display: 'flex', alignItems: 'center', paddingRight: showVolumeSlider ? 8 : 0 }}>
              <VolumeBar
                value={muted ? 0 : volumeLevel}
                max={130}
                onChange={(v) => { resetActivity(); sendCmd(`set volume ${v}`); if (muted && v > 0) sendCmd('set mute no'); }}
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
            <button onClick={(e) => { e.stopPropagation(); resetActivity(); void emit('native-player-next-episode', null); }} className="fluxa-ibtn" style={styles.iconBtn} title={`Next: ${nextEpSubtitle}`}>
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
          <button onClick={(e) => { e.stopPropagation(); void openTrackPopover('speed'); }} className="fluxa-ibtn" style={styles.iconBtn} title={`Speed: ${playbackSpeed === 1 ? 'Normal' : `${playbackSpeed}×`}`}>
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

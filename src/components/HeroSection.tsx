import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Info, Maximize2, Play, Plus, Volume2, VolumeX } from 'lucide-react';
import { seasonPosterUrl } from '../core/seasonPosters';
import { youtubeVideoId } from './detail/TrailerCarousel';
import { httpFetchText, resolveYoutubeTrailer, type YoutubeTrailerSubtitleTrack } from '../core/engine';
import type { Meta } from '../core/types';
import { t } from '../i18n';

type TrailerCue = {
  start: number;
  end: number;
  text: string;
};

interface Props {
  meta: Meta;
  slides?: Meta[];
  onPlay?: (meta: Meta) => void;
  onDetails?: (meta: Meta) => void;
  onAddToWatchlist?: (meta: Meta) => void;
  preferSeasonPosters?: boolean;
  isActive?: boolean;
  autoplayTrailer?: boolean;
  autoplayTrailerDelaySecs?: number;
  preferredSubtitleLanguage?: string;
  secondarySubtitleLanguage?: string;
}

const DEFAULT_SLIDE_INTERVAL_MS = 6500;
const STALL_TIMEOUT_MS = 7000;
const PANEL_LEFT = '7.5rem';

const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const keyframes = `
@keyframes heroKenBurns {
  from { transform: scale(1); }
  to { transform: scale(1.06); }
}
@keyframes heroIndicatorFill {
  from { width: 0%; }
  to { width: 100%; }
}
`;

export const HeroSection = React.memo(function HeroSection({
  meta,
  slides,
  onPlay,
  onDetails,
  onAddToWatchlist,
  preferSeasonPosters = false,
  isActive = true,
  autoplayTrailer = false,
  autoplayTrailerDelaySecs = 2,
  preferredSubtitleLanguage,
  secondarySubtitleLanguage,
}: Props) {
  const items = useMemo(() => {
    const seen = new Set<string>();
    return [meta, ...(slides ?? [])].filter((item) => {
      const key = item.id || item.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return !!(item.background || item.poster || seasonPosterUrl(item));
    });
  }, [meta, slides]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const [bgError, setBgError] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  const activeMeta = items[activeIndex] ?? meta;
  const canSlide = items.length > 1;
  const slideIntervalMs = autoplayTrailer ? Math.max(DEFAULT_SLIDE_INTERVAL_MS, autoplayTrailerDelaySecs * 1000 + 3000) : DEFAULT_SLIDE_INTERVAL_MS;
  const imageUrl = (preferSeasonPosters ? seasonPosterUrl(activeMeta) : undefined) ?? activeMeta.background ?? activeMeta.poster;
  const bgUrl = !bgError ? imageUrl : null;
  const logoUrl = !logoError ? activeMeta.logo : null;
  const trailerVideoId = useMemo(() => {
    for (const trailer of activeMeta.trailers ?? []) {
      const id = youtubeVideoId(trailer.url);
      if (id) return id;
    }
    return null;
  }, [activeMeta.trailers]);
  const [trailerStreamUrl, setTrailerStreamUrl] = useState<string | null>(null);
  const [trailerAudioUrl, setTrailerAudioUrl] = useState<string | null>(null);
  const [trailerSubtitles, setTrailerSubtitles] = useState<YoutubeTrailerSubtitleTrack[]>([]);
  const [trailerSubtitleCues, setTrailerSubtitleCues] = useState<TrailerCue[]>([]);
  const [activeTrailerSubtitle, setActiveTrailerSubtitle] = useState('');
  const [trailerReady, setTrailerReady] = useState(false);
  const [trailerResolving, setTrailerResolving] = useState(false);
  const [trailerLoading, setTrailerLoading] = useState(false);
  const [trailerProgress, setTrailerProgress] = useState(0);
  const [trailerMuted, setTrailerMuted] = useState(true);
  const lastTrailerProgressAtRef = useRef(0);
  const trailerVideoRef = useRef<HTMLVideoElement | null>(null);
  const trailerAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeTrailerSubtitleRef = useRef('');
  const trailerActive = !!trailerStreamUrl && trailerReady;
  const trailerPending = trailerResolving || trailerLoading || !!trailerStreamUrl;
  const selectedTrailerSubtitle = useMemo(
    () => selectTrailerSubtitle(trailerSubtitles, preferredSubtitleLanguage, secondarySubtitleLanguage),
    [trailerSubtitles, preferredSubtitleLanguage, secondarySubtitleLanguage],
  );

  const imdbNum = activeMeta.imdbRating != null ? Number(activeMeta.imdbRating) : NaN;
  const releaseYear = activeMeta.year ?? parseReleaseYear(activeMeta.releaseInfo);
  const tagline = readOptionalString(activeMeta, ['tagline', 'tagLine', 'slogan']);
  const awards = readOptionalString(activeMeta, ['awards']);
  const certification = readOptionalString(activeMeta, ['certification', 'contentRating', 'rating']);
  const network = readOptionalString(activeMeta, ['network', 'studio', 'broadcaster']);

  const metaParts: string[] = [];
  if (releaseYear) metaParts.push(String(releaseYear));
  if (activeMeta.runtime) metaParts.push(String(activeMeta.runtime));
  if (network) metaParts.push(network);

  const genreLine = (Array.isArray(activeMeta.genres) ? activeMeta.genres : [])
    .filter((g): g is string => typeof g === 'string' && g.length > 0)
    .slice(0, 5);

  useEffect(() => {
    setBgError(false);
    setLogoError(false);
  }, [activeMeta.id, imageUrl, activeMeta.logo]);

  useEffect(() => {
    setTrailerStreamUrl(null);
    setTrailerAudioUrl(null);
    setTrailerSubtitles([]);
    setTrailerSubtitleCues([]);
    setActiveTrailerSubtitle('');
    activeTrailerSubtitleRef.current = '';
    setTrailerReady(false);
    setTrailerProgress(0);
    setTrailerResolving(false);
    setTrailerLoading(false);
    setTrailerMuted(true);
  }, [activeMeta.id]);

  useEffect(() => {
    if (!autoplayTrailer || !isActive || !trailerVideoId) return;
    let cancelled = false;
    let delayElapsed = autoplayTrailerDelaySecs <= 0;
    let resolvedTrailer: Awaited<ReturnType<typeof resolveYoutubeTrailer>> | null = null;
    let resolveFinished = false;
    setTrailerResolving(true);

    const applyResolvedTrailer = () => {
      if (cancelled || !delayElapsed || !resolveFinished) return;
      if (resolvedTrailer?.streamUrl) {
        setTrailerSubtitles(resolvedTrailer.subtitles ?? []);
        setTrailerAudioUrl(resolvedTrailer.audioUrl ?? null);
        setTrailerReady(false);
        setTrailerLoading(true);
        setTrailerStreamUrl(resolvedTrailer.streamUrl);
      }
      setTrailerResolving(false);
      if (!resolvedTrailer?.streamUrl) setTrailerLoading(false);
    };

    const delayId = window.setTimeout(() => {
      delayElapsed = true;
      if (!resolveFinished) setTrailerLoading(true);
      applyResolvedTrailer();
    }, autoplayTrailerDelaySecs * 1000);

    resolveYoutubeTrailer(trailerVideoId).then((resolved) => {
      if (cancelled) return;
      resolvedTrailer = resolved;
      resolveFinished = true;
      applyResolvedTrailer();
    }).catch((err) => {
      console.error('resolveYoutubeTrailerUrl failed', err);
      resolveFinished = true;
      if (!cancelled) {
        setTrailerResolving(false);
        if (delayElapsed) setTrailerLoading(false);
      }
    });

    return () => {
      cancelled = true;
      setTrailerResolving(false);
      window.clearTimeout(delayId);
    };
  }, [trailerVideoId, autoplayTrailer, autoplayTrailerDelaySecs, isActive]);

  useEffect(() => {
    let cancelled = false;
    setTrailerSubtitleCues([]);
    setActiveTrailerSubtitle('');
    activeTrailerSubtitleRef.current = '';
    if (!selectedTrailerSubtitle?.url || !trailerStreamUrl) return;

    httpFetchText(normalizeTrailerSubtitleUrl(selectedTrailerSubtitle.url)).then((response) => {
      if (cancelled || response.statusCode < 200 || response.statusCode > 299 || !response.body.trim()) return;
      const cues = parseTrailerSubtitleCues(response.body);
      setTrailerSubtitleCues(cues);
      updateActiveTrailerSubtitle(trailerVideoRef.current?.currentTime ?? 0, cues);
    }).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [selectedTrailerSubtitle?.url, trailerStreamUrl]);

  function updateActiveTrailerSubtitle(time: number, cues = trailerSubtitleCues) {
    const text = cues.find((cue) => time >= cue.start && time <= cue.end)?.text ?? '';
    if (text !== activeTrailerSubtitleRef.current) {
      activeTrailerSubtitleRef.current = text;
      setActiveTrailerSubtitle(text);
    }
  }

  function syncTrailerAudio(shouldPlay = false) {
    if (!trailerAudioUrl) return;
    const video = trailerVideoRef.current;
    const audio = trailerAudioRef.current;
    if (!video || !audio) return;
    if (Number.isFinite(video.currentTime) && Math.abs(audio.currentTime - video.currentTime) > 0.35) {
      audio.currentTime = video.currentTime;
    }
    audio.muted = trailerMuted;
    audio.volume = trailerMuted ? 0 : 1;
    if (trailerMuted || video.paused || video.ended) {
      audio.pause();
    } else if (shouldPlay || audio.paused) {
      audio.play().catch(() => {});
    }
  }

  useEffect(() => {
    if (!trailerStreamUrl) return;
    lastTrailerProgressAtRef.current = Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - lastTrailerProgressAtRef.current > STALL_TIMEOUT_MS) {
        setTrailerStreamUrl(null);
        setTrailerLoading(false);
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [trailerStreamUrl]);

  useEffect(() => {
    if (!trailerStreamUrl) return;
    const el = trailerVideoRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry?.isIntersecting && el.paused && !el.ended) {
        el.play().catch(() => {});
      }
    }, { threshold: 0.05 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [trailerStreamUrl]);

  useEffect(() => {
    const el = trailerVideoRef.current;
    if (!el) return;
    el.muted = trailerMuted;
    el.volume = trailerMuted ? 0 : 1;
    syncTrailerAudio(!trailerMuted);
  }, [trailerMuted, trailerAudioUrl]);

  useEffect(() => {
    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
    };
  }, []);

  function slideToIndex(next: number) {
    const clamped = ((next % items.length) + items.length) % items.length;
    if (pendingRef.current) clearTimeout(pendingRef.current);
    setVisible(false);
    pendingRef.current = setTimeout(() => {
      setActiveIndex(clamped);
      setVisible(true);
      pendingRef.current = null;
    }, 220);
  }

  useEffect(() => {
    if (!canSlide || !isActive || trailerPending) return;
    const id = window.setInterval(() => {
      slideToIndex(activeIndexRef.current + 1);
    }, slideIntervalMs);
    return () => window.clearInterval(id);
  }, [canSlide, items.length, isActive, trailerPending, slideIntervalMs]);

  useEffect(() => {
    if (!canSlide) return;
    const next = items[(activeIndex + 1) % items.length];
    if (!next) return;
    const nextBg = (preferSeasonPosters ? seasonPosterUrl(next) : undefined) ?? next.background ?? next.poster;
    if (nextBg) { const img = new Image(); img.src = nextBg; }
    if (next.logo) { const img = new Image(); img.src = next.logo; }
  }, [canSlide, items, activeIndex, preferSeasonPosters]);

  const goTo = (index: number) => {
    if (!canSlide) return;
    slideToIndex(index);
  };

  const contentStyle: React.CSSProperties = {
    opacity: visible ? 1 : 0,
    transition: 'opacity 0.25s ease',
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!canSlide) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(activeIndex - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); goTo(activeIndex + 1); }
  };

  const fullscreenTrailer = () => {
    const video = trailerVideoRef.current;
    if (!video) return;
    const fullscreenTarget = video as HTMLVideoElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    const request = fullscreenTarget.requestFullscreen?.bind(fullscreenTarget)
      ?? fullscreenTarget.webkitRequestFullscreen?.bind(fullscreenTarget);
    try {
      const result = request?.();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {}
  };

  return (
    <div
      style={styles.hero}
      tabIndex={canSlide ? 0 : -1}
      onKeyDown={handleKeyDown}
    >
      <style>{keyframes}</style>
      {bgUrl && (
        <img
          key={activeMeta.id || activeIndex}
          src={bgUrl}
          alt=""
          decoding="async"
          style={{
            ...styles.backdrop,
            ...contentStyle,
            opacity: visible ? (trailerActive ? 0 : 1) : 0,
            transition: 'opacity 0.6s ease',
            animation: prefersReducedMotion ? 'none' : `heroKenBurns ${slideIntervalMs + 400}ms ease-out forwards`,
            animationPlayState: trailerActive ? 'paused' : 'running',
          }}
          onError={() => setBgError(true)}
        />
      )}

      {trailerStreamUrl && (
        <video
          ref={trailerVideoRef}
          key={trailerStreamUrl}
          style={{ ...styles.trailerFrame, opacity: trailerReady ? 1 : 0, transition: 'opacity 0.6s ease' }}
          src={trailerStreamUrl}
          autoPlay
          playsInline
          onPlaying={() => {
            setTrailerReady(true);
            setTrailerLoading(false);
            lastTrailerProgressAtRef.current = Date.now();
            if (trailerVideoRef.current) {
              trailerVideoRef.current.muted = trailerMuted;
              trailerVideoRef.current.volume = trailerMuted ? 0 : 1;
            }
            syncTrailerAudio(true);
            updateActiveTrailerSubtitle(trailerVideoRef.current?.currentTime ?? 0);
          }}
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            lastTrailerProgressAtRef.current = Date.now();
            if (el.duration > 0) setTrailerProgress(el.currentTime / el.duration);
            syncTrailerAudio(false);
            updateActiveTrailerSubtitle(el.currentTime);
          }}
          onEnded={() => {
            trailerAudioRef.current?.pause();
            setTrailerStreamUrl(null);
            setTrailerAudioUrl(null);
            setTrailerLoading(false);
          }}
          onError={() => {
            trailerAudioRef.current?.pause();
            setTrailerStreamUrl(null);
            setTrailerAudioUrl(null);
            setTrailerLoading(false);
          }}
        />
      )}
      {trailerAudioUrl && (
        <audio ref={trailerAudioRef} key={trailerAudioUrl} src={trailerAudioUrl} preload="auto" />
      )}

      {trailerActive && activeTrailerSubtitle && (
        <div style={styles.trailerSubtitleOverlay}>
          {activeTrailerSubtitle}
        </div>
      )}

      {trailerActive && (
        <button
          onClick={fullscreenTrailer}
          style={styles.trailerFullscreenButton}
          aria-label="Fullscreen trailer"
          title="Fullscreen trailer"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(0,0,0,0.6)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(0,0,0,0.4)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
          }}
        >
          <Maximize2 size={20} />
        </button>
      )}

      {trailerActive && (
        <button
          onClick={() => {
            const newMutedState = !trailerMuted;
            setTrailerMuted(newMutedState);
            if (trailerVideoRef.current) {
              trailerVideoRef.current.muted = newMutedState;
              trailerVideoRef.current.volume = newMutedState ? 0 : 1;
              if (!newMutedState && trailerVideoRef.current.paused) {
                trailerVideoRef.current.play().catch(() => {});
              }
            }
            if (trailerAudioRef.current && trailerVideoRef.current) {
              trailerAudioRef.current.muted = newMutedState;
              trailerAudioRef.current.volume = newMutedState ? 0 : 1;
              if (newMutedState) {
                trailerAudioRef.current.pause();
              } else {
                trailerAudioRef.current.currentTime = trailerVideoRef.current.currentTime;
                trailerAudioRef.current.play().catch(() => {});
              }
            }
          }}
          style={styles.trailerMuteButton}
          aria-label={trailerMuted ? 'Unmute' : 'Mute'}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(0,0,0,0.6)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(0,0,0,0.4)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
          }}
        >
          {trailerMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>
      )}

      <div style={styles.gradientTop} />
      <div style={{ ...styles.gradientLeft, opacity: trailerActive ? 0.45 : 1, transition: 'opacity 0.6s ease' }} />
      <div style={styles.gradientBottom} />

      <div style={{ ...styles.panel, ...contentStyle }}>
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={activeMeta.name}
            decoding="async"
            style={{
              ...styles.logo,
              ...(trailerActive ? styles.logoTrailerActive : null),
            }}
            onError={() => setLogoError(true)}
          />
        ) : (
          <h1 style={styles.title}>{String(activeMeta.name ?? '')}</h1>
        )}

        <div
          style={{
            maxHeight: trailerActive ? 0 : 600,
            opacity: trailerActive ? 0 : 1,
            overflow: 'hidden',
            transition: 'max-height 0.5s ease, opacity 0.3s ease',
          }}
        >
          {tagline && <p style={styles.tagline}>{tagline}</p>}

          {metaParts.length > 0 && (
            <p style={styles.metaLine}>{metaParts.join(' · ')}</p>
          )}

          {(!isNaN(imdbNum) || certification || genreLine.length > 0) && (
            <div style={styles.metaRow}>
              {!isNaN(imdbNum) && (
                <span style={styles.imdbBadge}>
                  <img src="/imdb.svg" alt="IMDb" style={styles.imdbLogo} />
                  <span style={styles.imdbScore}>{imdbNum.toFixed(1)}</span>
                </span>
              )}
              {certification && (
                <span style={styles.certBadge}>{certification}</span>
              )}
              {genreLine.length > 0 && (
                <span style={styles.genreText}>{genreLine.join('  ·  ')}</span>
              )}
            </div>
          )}

          {activeMeta.description && (
            <p style={styles.description}>{activeMeta.description}</p>
          )}

          {awards && <p style={styles.awards}>{awards}</p>}
        </div>

        <div style={styles.actions}>
          <button style={styles.watchBtn} onClick={() => onPlay?.(activeMeta)}>
            <Play size={13} fill="currentColor" />
            {t('common.play')}
          </button>
          <HeroIconBtn onClick={() => onAddToWatchlist?.(activeMeta)} title={t('auto.my_list')} ariaLabel={t('auto.my_list')}>
            <Plus size={20} />
          </HeroIconBtn>
          <HeroIconBtn onClick={() => onDetails?.(activeMeta)} title={t('auto.info')} ariaLabel={t('auto.info')}>
            <Info size={20} />
          </HeroIconBtn>
        </div>
      </div>

      {canSlide && (
        <>
          <NavArrow direction="left" onClick={() => goTo(activeIndex - 1)} />
          <NavArrow direction="right" onClick={() => goTo(activeIndex + 1)} />
          {trailerActive ? (
            <div style={styles.trailerProgressTrack}>
              <span style={{ ...styles.trailerProgressFill, width: `${trailerProgress * 100}%` }} />
            </div>
          ) : (
            <div style={styles.indicators}>
              {items.map((item, i) => (
                <button
                  key={item.id || item.name}
                  aria-label={`Show ${item.name}`}
                  style={styles.indicatorTrack}
                  onClick={() => goTo(i)}
                >
                  <span
                    key={i === activeIndex ? `${activeIndex}` : `${i}-static`}
                    style={{
                      ...styles.indicatorFill,
                      ...(i < activeIndex ? styles.indicatorFillDone : null),
                      ...(i === activeIndex
                        ? {
                            animation: `heroIndicatorFill ${slideIntervalMs}ms linear forwards`,
                            animationPlayState: trailerPending || !isActive ? 'paused' : 'running',
                          }
                        : null),
                    }}
                  />
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
});

function NavArrow({ direction, onClick }: { direction: 'left' | 'right'; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      aria-label={direction === 'left' ? 'Previous' : 'Next'}
      style={{
        position: 'absolute',
        top: 'calc(29vh - 2.5rem)',
        ...(direction === 'left' ? { left: '1.25rem' } : { right: '0.875rem' }),
        transform: 'translateY(-50%)',
        background: 'transparent',
        border: 'none',
        color: hovered ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)',
        fontSize: '3rem',
        fontWeight: 300,
        fontFamily: 'system-ui, sans-serif',
        width: '3.75rem',
        height: '4.375rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: 0,
        zIndex: 15,
        lineHeight: 1,
        transition: 'color 0.3s ease, transform 0.3s ease, text-shadow 0.3s ease',
        textShadow: hovered
          ? '0 0 0.9375rem rgba(255,255,255,0.8), 0 0 1.5625rem rgba(255,255,255,0.5), 0.125rem 0.125rem 0.1875rem rgba(0,0,0,0.9)'
          : '0.125rem 0.125rem 0.25rem rgba(0,0,0,0.8)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {direction === 'left' ? '‹' : '›'}
    </button>
  );
}

function HeroIconBtn({ onClick, title, ariaLabel, children }: { onClick?: () => void; title?: string; ariaLabel?: string; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      title={title}
      aria-label={ariaLabel ?? title}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '2.625rem',
        height: '2.625rem',
        borderRadius: '50%',
        background: hovered ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.10)',
        border: '0.125rem solid rgba(255,255,255,0.55)',
        color: '#FFFFFF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: 0,
        flexShrink: 0,
        transition: 'background 0.15s',
        boxShadow: '0 0.25rem 1rem rgba(0,0,0,0.35)',
      }}
    >
      {children}
    </button>
  );
}

function parseReleaseYear(releaseInfo?: string): number | null {
  const match = releaseInfo?.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function readOptionalString(meta: Meta, keys: string[]): string | null {
  const record = meta as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function normalizedLang(value: string | undefined | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed || trimmed === 'none') return null;
  return trimmed.split(/[-_]/)[0] || null;
}

function selectTrailerSubtitle(
  tracks: YoutubeTrailerSubtitleTrack[],
  preferred?: string,
  secondary?: string,
): YoutubeTrailerSubtitleTrack | null {
  if (tracks.length === 0) return null;
  const wanted = [
    normalizedLang(preferred),
    normalizedLang(secondary),
    normalizedLang(typeof navigator !== 'undefined' ? navigator.language : undefined),
    'en',
  ].filter((value, index, all): value is string => !!value && all.indexOf(value) === index);

  const scored = tracks.map((track, index) => {
    const language = normalizedLang(track.languageTag);
    const label = track.label.toLowerCase();
    const wantedIndex = language ? wanted.indexOf(language) : -1;
    const preferredScore = wantedIndex >= 0 ? 1000 - (wantedIndex * 100) : 0;
    const englishLabelScore = label.includes('english') ? 250 : 0;
    const humanScore = track.isAuto ? 0 : 25;
    return { track, index, score: preferredScore + englishLabelScore + humanScore };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0]?.track ?? null;
}

function normalizeTrailerSubtitleUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set('fmt', 'vtt');
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function parseTrailerSubtitleCues(input: string): TrailerCue[] {
  return input.trimStart().startsWith('<?xml') || input.trimStart().startsWith('<timedtext')
    ? parseYoutubeTimedText(input)
    : parseWebVtt(input);
}

function parseWebVtt(input: string): TrailerCue[] {
  return input
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .flatMap((block): TrailerCue[] => {
      const lines = block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length === 0) return [];
      if (/^(WEBVTT|NOTE|STYLE|REGION)\b/i.test(lines[0])) return [];
      const timingIndex = lines.findIndex((line) => line.includes('-->'));
      if (timingIndex < 0) return [];
      const [startRaw, endAndSettings] = lines[timingIndex].split('-->');
      const start = parseVttTime(startRaw);
      const end = parseVttTime((endAndSettings ?? '').trim().split(/\s+/)[0]);
      const text = lines
        .slice(timingIndex + 1)
        .join('\n')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (!Number.isFinite(start) || !Number.isFinite(end) || !text) return [];
      return [{ start, end, text: decodeHtmlEntities(text) }];
    });
}

function parseYoutubeTimedText(input: string): TrailerCue[] {
  if (typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(input, 'text/xml');
  return Array.from(doc.querySelectorAll('p')).flatMap((node): TrailerCue[] => {
    const startMs = Number(node.getAttribute('t'));
    const durationMs = Number(node.getAttribute('d'));
    const text = node.textContent?.trim() ?? '';
    if (!Number.isFinite(startMs) || !Number.isFinite(durationMs) || !text) return [];
    return [{
      start: startMs / 1000,
      end: (startMs + durationMs) / 1000,
      text,
    }];
  });
}

function parseVttTime(raw: string | undefined): number {
  if (!raw) return NaN;
  const parts = raw.trim().replace(',', '.').split(':');
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop() ?? 0);
  const hours = Number(parts.pop() ?? 0);
  if (![hours, minutes, seconds].every(Number.isFinite)) return NaN;
  return (hours * 3600) + (minutes * 60) + seconds;
}

function decodeHtmlEntities(value: string): string {
  if (typeof document === 'undefined') return value;
  const el = document.createElement('textarea');
  el.innerHTML = value;
  return el.value;
}

const styles: Record<string, React.CSSProperties> = {
  hero: {
    position: 'relative',
    width: '100%',
    height: 'var(--hero-height, clamp(38rem, 66vh, 54rem))' as unknown as number,
    overflow: 'hidden',
    flexShrink: 0,
    background: '#040508',
    willChange: 'transform',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: 'center 20%',
    display: 'block',
    userSelect: 'none',
    pointerEvents: 'none',
    transformOrigin: 'center 30%',
  },
  trailerFrame: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    border: 'none',
    pointerEvents: 'none',
  },
  trailerSubtitleOverlay: {
    position: 'absolute',
    left: '50%',
    bottom: 'clamp(3.25rem, 8vh, 5.75rem)' as unknown as number,
    transform: 'translateX(-50%)',
    zIndex: 18,
    maxWidth: 'min(64rem, calc(100% - 12rem))',
    padding: '0.28rem 0.65rem',
    borderRadius: '0.25rem',
    background: 'rgba(0,0,0,0.58)',
    color: '#FFFFFF',
    fontSize: 'clamp(1.1rem, 2.05vw, 1.8rem)' as unknown as number,
    fontWeight: 700,
    lineHeight: 1.28,
    textAlign: 'center',
    textShadow: '0 0.125rem 0.25rem rgba(0,0,0,0.9)',
    whiteSpace: 'pre-line',
    pointerEvents: 'none',
  },
  gradientTop: {
    position: 'absolute',
    inset: 0,
    background: 'linear-gradient(to bottom, rgba(4,5,8,0.55) 0%, rgba(4,5,8,0.20) 12%, rgba(4,5,8,0.00) 28%)',
    pointerEvents: 'none',
    zIndex: 1,
  },
  gradientLeft: {
    position: 'absolute',
    inset: 0,
    background: [
      'linear-gradient(to right,',
      'rgba(4,5,8,1.00) 0%,',
      'rgba(4,5,8,0.99) 22%,',
      'rgba(4,5,8,0.96) 34%,',
      'rgba(4,5,8,0.88) 46%,',
      'rgba(4,5,8,0.72) 56%,',
      'rgba(4,5,8,0.40) 68%,',
      'rgba(4,5,8,0.10) 80%,',
      'rgba(4,5,8,0.00) 90%)',
    ].join(' '),
    maskImage: 'linear-gradient(to bottom, black 0%, black 72%, rgba(0,0,0,0.65) 86%, transparent 100%)',
    WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 72%, rgba(0,0,0,0.65) 86%, transparent 100%)',
    pointerEvents: 'none',
    zIndex: 1,
  },
  gradientBottom: {
    position: 'absolute',
    inset: 0,
    background: [
      'linear-gradient(to bottom,',
      'rgba(4,5,8,0.00) 0%,',
      'rgba(4,5,8,0.00) 52%,',
      'rgba(4,5,8,0.30) 70%,',
      'rgba(4,5,8,0.76) 88%,',
      '#040508 100%)',
    ].join(' '),
    pointerEvents: 'none',
    zIndex: 1,
  },
  panel: {
    position: 'absolute',
    bottom: 'clamp(3rem, 7vh, 5rem)' as unknown as number,
    left: PANEL_LEFT,
    maxWidth: '36.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    zIndex: 10,
  },
  logo: {
    height: 'clamp(5rem, 13vh, 12.5rem)' as unknown as number,
    maxWidth: '33.75rem',
    objectFit: 'contain',
    objectPosition: 'left center',
    filter: 'drop-shadow(0 0.25rem 0.75rem rgba(0,0,0,0.65)) drop-shadow(0 0 1px rgba(255,255,255,0.25))',
    userSelect: 'none',
    marginBottom: '1.375rem',
    transition: 'height 0.35s ease, max-width 0.35s ease, margin-bottom 0.35s ease',
  },
  logoTrailerActive: {
    height: 'clamp(3rem, 8vh, 6.5rem)' as unknown as number,
    maxWidth: '24rem',
    marginBottom: '0.75rem',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 'clamp(2.4rem, 5vw, 5rem)' as unknown as number,
    fontWeight: 900,
    lineHeight: 1.0,
    margin: '0 0 1.375rem 0',
    fontFamily: "'Montserrat', sans-serif",
    textShadow: '0 0.25rem 0.5rem rgba(0,0,0,0.6)',
    letterSpacing: '-0.01em',
  },
  tagline: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: '1.1rem',
    fontWeight: 700,
    fontStyle: 'italic',
    margin: '0 0 1.25rem 0',
    textShadow: '0 0.125rem 0.5rem rgba(0,0,0,0.7)',
    lineHeight: 1.3,
  },
  metaLine: {
    color: 'rgb(170, 170, 170)',
    fontSize: '0.875rem',
    margin: '0 0 1rem 0',
    fontWeight: 400,
    textShadow: '0 0.125rem 0.25rem rgba(0,0,0,0.8)',
    lineHeight: 1.4,
  },
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    marginBottom: '1.125rem',
    flexWrap: 'wrap' as const,
  },
  imdbBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.375rem',
    flexShrink: 0,
  },
  imdbLogo: {
    height: '1rem',
    width: 'auto',
    display: 'block',
    borderRadius: '0.1875rem',
    userSelect: 'none',
  },
  imdbScore: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: '0.9rem',
    fontWeight: 700,
    lineHeight: 1,
    textShadow: '0 1px 0.1875rem rgba(0,0,0,0.8)',
  },
  certBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '1px 0.3125rem 0.125rem',
    border: '1px solid rgba(255,255,255,0.50)',
    color: 'rgba(255,255,255,0.75)',
    borderRadius: '0.125rem',
    fontSize: '0.72rem',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.02em',
    flexShrink: 0,
  },
  genreText: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: '0.85rem',
    fontWeight: 500,
    lineHeight: 1,
    textShadow: '0 1px 0.1875rem rgba(0,0,0,0.8)',
  },
  description: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: '0.95rem',
    lineHeight: 1.6,
    margin: '0 0 0 0',
    maxWidth: '30rem',
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical' as const,
    overflow: 'hidden',
    textShadow: '0 1px 0.1875rem rgba(0,0,0,0.8)',
  },
  awards: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: '0.82rem',
    lineHeight: 1.45,
    margin: '0.75rem 0 0',
    maxWidth: '30rem',
    fontWeight: 500,
    textShadow: '0 1px 0.1875rem rgba(0,0,0,0.8)',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.625rem',
    marginTop: '1.5rem',
    alignSelf: 'flex-start',
  },
  watchBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5625rem',
    background: '#FFFFFF',
    color: '#000000',
    border: '1px solid transparent',
    borderRadius: '0.4375rem',
    padding: '0.5625rem 1.375rem',
    fontSize: '0.925rem',
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: "'Montserrat', sans-serif",
    transition: 'all 0.25s ease-in-out',
    boxShadow: '0 0.5rem 2rem rgba(0,0,0,0.3), 0 0.25rem 1rem rgba(0,0,0,0.1)',
  },
  indicators: {
    position: 'absolute',
    bottom: '1.5rem',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '0.375rem',
    zIndex: 10,
    padding: '0.625rem 1rem',
  },
  indicatorTrack: {
    width: '1.75rem',
    height: '0.1875rem',
    borderRadius: '62.4375rem',
    background: 'rgba(255,255,255,0.25)',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    overflow: 'hidden',
  },
  indicatorFill: {
    display: 'block',
    height: '100%',
    width: '0%',
    background: 'rgba(255,255,255,0.90)',
    borderRadius: '62.4375rem',
  },
  indicatorFillDone: {
    width: '100%',
  },
  trailerProgressTrack: {
    position: 'absolute',
    bottom: '1.5rem',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '13.75rem',
    height: '0.1875rem',
    borderRadius: '62.4375rem',
    background: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
    zIndex: 10,
  },
  trailerProgressFill: {
    display: 'block',
    height: '100%',
    background: 'rgba(255,255,255,0.90)',
    borderRadius: '62.4375rem',
  },
  trailerMuteButton: {
    position: 'absolute',
    bottom: '1.5rem',
    right: '1.5rem',
    width: '2.5rem',
    height: '2.5rem',
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.4)',
    border: '1px solid rgba(255,255,255,0.2)',
    color: '#FFFFFF',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
    zIndex: 20,
    transition: 'background 0.2s ease, border-color 0.2s ease',
  },
  trailerFullscreenButton: {
    position: 'absolute',
    top: '1.5rem',
    left: '1.5rem',
    width: '2.5rem',
    height: '2.5rem',
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.4)',
    border: '1px solid rgba(255,255,255,0.2)',
    color: '#FFFFFF',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
    zIndex: 20,
    transition: 'background 0.2s ease, border-color 0.2s ease',
  },
};

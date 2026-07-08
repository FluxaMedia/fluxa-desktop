import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Info, Play, Plus } from 'lucide-react';
import { seasonPosterUrl } from '../core/seasonPosters';
import { youtubeVideoId } from './detail/TrailerCarousel';
import { resolveYoutubeTrailerUrl } from '../core/engine';
import type { Meta } from '../core/types';
import { t } from '../i18n';

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
}

const SLIDE_INTERVAL_MS = 6500;
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

export const HeroSection = React.memo(function HeroSection({ meta, slides, onPlay, onDetails, onAddToWatchlist, preferSeasonPosters = false, isActive = true, autoplayTrailer = false, autoplayTrailerDelaySecs = 4 }: Props) {
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
  const [trailerReady, setTrailerReady] = useState(false);
  const [trailerLoading, setTrailerLoading] = useState(false);
  const [trailerProgress, setTrailerProgress] = useState(0);
  const lastTrailerProgressAtRef = useRef(0);
  const trailerActive = !!trailerStreamUrl && trailerReady;
  const trailerPending = trailerLoading || trailerActive;

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

  const genreLine = (activeMeta.genres ?? [])
    .filter((g): g is string => typeof g === 'string' && g.length > 0)
    .slice(0, 5);

  useEffect(() => {
    setBgError(false);
    setLogoError(false);
  }, [activeMeta.id, imageUrl, activeMeta.logo]);

  useEffect(() => {
    setTrailerStreamUrl(null);
    setTrailerReady(false);
    setTrailerProgress(0);
    setTrailerLoading(false);
    if (!autoplayTrailer || !isActive || !trailerVideoId) return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      setTrailerLoading(true);
      resolveYoutubeTrailerUrl(trailerVideoId).then((url) => {
        if (cancelled) return;
        if (url) {
          setTrailerStreamUrl(url);
        } else {
          setTrailerLoading(false);
        }
      }).catch((err) => {
        console.error('resolveYoutubeTrailerUrl failed', err);
        if (!cancelled) setTrailerLoading(false);
      });
    }, autoplayTrailerDelaySecs * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [activeMeta.id, trailerVideoId, autoplayTrailer, autoplayTrailerDelaySecs, isActive]);

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
    }, SLIDE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [canSlide, items.length, isActive, trailerPending]);

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
            animationPlayState: trailerActive ? 'paused' : 'running',
          }}
          onError={() => setBgError(true)}
        />
      )}

      {trailerStreamUrl && (
        <video
          key={trailerStreamUrl}
          style={{ ...styles.trailerFrame, opacity: trailerReady ? 1 : 0, transition: 'opacity 0.6s ease' }}
          src={trailerStreamUrl}
          autoPlay
          muted
          playsInline
          onPlaying={() => {
            setTrailerReady(true);
            lastTrailerProgressAtRef.current = Date.now();
          }}
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            lastTrailerProgressAtRef.current = Date.now();
            if (el.duration > 0) setTrailerProgress(el.currentTime / el.duration);
          }}
          onEnded={() => { setTrailerStreamUrl(null); setTrailerLoading(false); }}
          onError={() => { setTrailerStreamUrl(null); setTrailerLoading(false); }}
        />
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
            style={styles.logo}
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
                            animation: `heroIndicatorFill ${SLIDE_INTERVAL_MS}ms linear forwards`,
                            animationPlayState: trailerPending ? 'paused' : 'running',
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

const styles: Record<string, React.CSSProperties> = {
  hero: {
    position: 'relative',
    width: '100%',
    height: 'var(--hero-height, clamp(33.75rem, 58vh, 47.5rem))' as unknown as number,
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
    animation: prefersReducedMotion ? 'none' : `heroKenBurns ${SLIDE_INTERVAL_MS + 400}ms ease-out forwards`,
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
};

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Info, Play, Plus } from 'lucide-react';
import { seasonPosterUrl } from '../core/seasonPosters';
import { youtubeVideoId } from './detail/TrailerCarousel';
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
const PANEL_LEFT = 120;

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
  const [paused, setPaused] = useState(false);
  const [cycle, setCycle] = useState(0);
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
  const [showTrailer, setShowTrailer] = useState(false);

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
    setShowTrailer(false);
    if (!autoplayTrailer || !isActive || paused || !trailerVideoId) return;
    const id = window.setTimeout(() => setShowTrailer(true), autoplayTrailerDelaySecs * 1000);
    return () => window.clearTimeout(id);
  }, [activeMeta.id, trailerVideoId, autoplayTrailer, autoplayTrailerDelaySecs, isActive, paused]);

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
    if (!canSlide || !isActive || paused) return;
    const id = window.setInterval(() => {
      slideToIndex(activeIndexRef.current + 1);
    }, SLIDE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [canSlide, items.length, isActive, paused]);

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
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => { setPaused(false); setCycle((c) => c + 1); }}
    >
      <style>{keyframes}</style>
      {bgUrl && (
        <img
          key={activeMeta.id || activeIndex}
          src={bgUrl}
          alt=""
          decoding="async"
          style={{ ...styles.backdrop, ...contentStyle, animationPlayState: paused ? 'paused' : 'running' }}
          onError={() => setBgError(true)}
        />
      )}

      {showTrailer && trailerVideoId && (
        <iframe
          key={trailerVideoId}
          style={styles.trailerFrame}
          src={`https://www.youtube.com/embed/${trailerVideoId}?autoplay=1&mute=1&controls=0&playsinline=1&rel=0&modestbranding=1&loop=1&playlist=${trailerVideoId}`}
          title="trailer"
          allow="autoplay; encrypted-media"
          frameBorder={0}
        />
      )}

      <div style={styles.gradientTop} />
      <div style={styles.gradientLeft} />
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
          <div style={styles.indicators}>
            {items.map((item, i) => (
              <button
                key={item.id || item.name}
                aria-label={`Show ${item.name}`}
                style={styles.indicatorTrack}
                onClick={() => goTo(i)}
              >
                <span
                  key={i === activeIndex ? `${activeIndex}-${cycle}` : `${i}-static`}
                  style={{
                    ...styles.indicatorFill,
                    ...(i < activeIndex ? styles.indicatorFillDone : null),
                    ...(i === activeIndex
                      ? {
                          animation: `heroIndicatorFill ${SLIDE_INTERVAL_MS}ms linear forwards`,
                          animationPlayState: paused ? 'paused' : 'running',
                        }
                      : null),
                  }}
                />
              </button>
            ))}
          </div>
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
        top: 'calc(29vh - 40px)',
        ...(direction === 'left' ? { left: 20 } : { right: 14 }),
        transform: 'translateY(-50%)',
        background: 'transparent',
        border: 'none',
        color: hovered ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)',
        fontSize: 48,
        fontWeight: 300,
        fontFamily: 'system-ui, sans-serif',
        width: 60,
        height: 70,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: 0,
        zIndex: 15,
        lineHeight: 1,
        transition: 'color 0.3s ease, transform 0.3s ease, text-shadow 0.3s ease',
        textShadow: hovered
          ? '0 0 15px rgba(255,255,255,0.8), 0 0 25px rgba(255,255,255,0.5), 2px 2px 3px rgba(0,0,0,0.9)'
          : '2px 2px 4px rgba(0,0,0,0.8)',
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
        width: 42,
        height: 42,
        borderRadius: '50%',
        background: hovered ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.10)',
        border: '2px solid rgba(255,255,255,0.55)',
        color: '#FFFFFF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: 0,
        flexShrink: 0,
        transition: 'background 0.15s',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
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
    height: 'var(--hero-height, clamp(540px, 58vh, 760px))' as unknown as number,
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
    bottom: 'clamp(48px, 7vh, 80px)' as unknown as number,
    left: PANEL_LEFT,
    maxWidth: 580,
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    zIndex: 10,
  },
  logo: {
    height: 'clamp(80px, 13vh, 200px)' as unknown as number,
    maxWidth: 540,
    objectFit: 'contain',
    objectPosition: 'left center',
    filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.65)) drop-shadow(0 0 1px rgba(255,255,255,0.25))',
    userSelect: 'none',
    marginBottom: 22,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 'clamp(2.4rem, 5vw, 5rem)' as unknown as number,
    fontWeight: 900,
    lineHeight: 1.0,
    margin: '0 0 22px 0',
    fontFamily: "'Montserrat', sans-serif",
    textShadow: '0 4px 8px rgba(0,0,0,0.6)',
    letterSpacing: '-0.01em',
  },
  tagline: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: '1.1rem',
    fontWeight: 700,
    fontStyle: 'italic',
    margin: '0 0 20px 0',
    textShadow: '0 2px 8px rgba(0,0,0,0.7)',
    lineHeight: 1.3,
  },
  metaLine: {
    color: 'rgb(170, 170, 170)',
    fontSize: '0.875rem',
    margin: '0 0 16px 0',
    fontWeight: 400,
    textShadow: '0 2px 4px rgba(0,0,0,0.8)',
    lineHeight: 1.4,
  },
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
    flexWrap: 'wrap' as const,
  },
  imdbBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  imdbLogo: {
    height: 16,
    width: 'auto',
    display: 'block',
    borderRadius: 3,
    userSelect: 'none',
  },
  imdbScore: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: '0.9rem',
    fontWeight: 700,
    lineHeight: 1,
    textShadow: '0 1px 3px rgba(0,0,0,0.8)',
  },
  certBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '1px 5px 2px',
    border: '1px solid rgba(255,255,255,0.50)',
    color: 'rgba(255,255,255,0.75)',
    borderRadius: 2,
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
    textShadow: '0 1px 3px rgba(0,0,0,0.8)',
  },
  description: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: '0.95rem',
    lineHeight: 1.6,
    margin: '0 0 0 0',
    maxWidth: 480,
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical' as const,
    overflow: 'hidden',
    textShadow: '0 1px 3px rgba(0,0,0,0.8)',
  },
  awards: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: '0.82rem',
    lineHeight: 1.45,
    margin: '12px 0 0',
    maxWidth: 480,
    fontWeight: 500,
    textShadow: '0 1px 3px rgba(0,0,0,0.8)',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginTop: 24,
    alignSelf: 'flex-start',
  },
  watchBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 9,
    background: '#FFFFFF',
    color: '#000000',
    border: '1px solid transparent',
    borderRadius: 7,
    padding: '9px 22px',
    fontSize: '0.925rem',
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: "'Montserrat', sans-serif",
    transition: 'all 0.25s ease-in-out',
    boxShadow: '0 8px 32px rgba(0,0,0,0.3), 0 4px 16px rgba(0,0,0,0.1)',
  },
  indicators: {
    position: 'absolute',
    bottom: 24,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: 6,
    zIndex: 10,
    padding: '10px 16px',
  },
  indicatorTrack: {
    width: 28,
    height: 3,
    borderRadius: 999,
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
    borderRadius: 999,
  },
  indicatorFillDone: {
    width: '100%',
  },
};

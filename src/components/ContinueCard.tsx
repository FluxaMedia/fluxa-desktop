import React from 'react';
import { Check, X } from 'lucide-react';
import type { LibraryItem, Meta } from '../core/types';
import {
  formatRemaining,
  formatWatched,
  formatReleaseCountdown,
  formatAirDay,
} from '../core/continueWatchingUtils';
import { t } from '../i18n';

const MAX_ARTWORK_RETRIES = 2;

function retryImageUrl(url: string, retryKey: number): string {
  if (retryKey <= 0 || url.startsWith('data:') || url.startsWith('blob:')) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('__fluxa_img_retry', String(retryKey));
    return parsed.toString();
  } catch {
    const joiner = url.includes('?') ? '&' : '?';
    return `${url}${joiner}__fluxa_img_retry=${retryKey}`;
  }
}

function resolveBadge(
  badge: string | undefined,
  type: string,
  isUpNext: boolean,
  remainingText: string | null,
  scheduledText: string | null,
): { text: string; variant: 'new' | 'default' } | null {
  if (badge === 'newEpisode' && type === 'series') return { text: t('auto.new_episode'), variant: 'new' };
  if (scheduledText && type === 'series') return { text: scheduledText, variant: 'default' };
  if (isUpNext && type === 'series') return { text: t('auto.up_next'), variant: 'default' };
  if (remainingText) return { text: remainingText, variant: 'default' };
  return null;
}

export function ContinueCard({
  meta,
  isHorizontal,
  artwork: artworkProp,
  episodeLine,
  remainingFormat,
  progressDirection,
  dismissing,
  pending,
  hideActions,
  onClick,
  onMarkWatched,
  onDrop,
  onDismissAnimationEnd,
}: {
  meta: Meta;
  isHorizontal: boolean;
  artwork: string | null;
  episodeLine: string | null;
  remainingFormat: string;
  progressDirection: string;
  dismissing: boolean;
  pending?: boolean;
  hideActions?: boolean;
  onClick: (m: Meta) => void;
  onMarkWatched: (m: Meta) => void;
  onDrop: (m: Meta) => void;
  onDismissAnimationEnd: (m: Meta) => void;
}) {
  const [hovered, setHovered] = React.useState(false);
  const [imgError, setImgError] = React.useState(false);
  const [imgLoaded, setImgLoaded] = React.useState(false);
  const [artworkOverride, setArtworkOverride] = React.useState<string | null>(null);
  const [artworkRetryKey, setArtworkRetryKey] = React.useState(0);
  const artworkRetriesRef = React.useRef(0);
  const artworkRetryTimersRef = React.useRef<number[]>([]);
  const artwork = artworkOverride ?? artworkProp;
  const artworkSrc = artwork ? retryImageUrl(artwork, artworkRetryKey) : null;

  const lib = meta as unknown as LibraryItem & {
    lastEpisodeName?: string;
    lastEpisodeSeason?: number;
    lastEpisodeNumber?: number;
    lastEpisodeThumbnail?: string;
    continueWatchingPoster?: string;
    continueWatchingBackground?: string;
    continueWatchingBadge?: string;
    newEpisodeReleasedAt?: string;
    unwatchedAhead?: number;
  };

  React.useEffect(() => {
    setArtworkOverride(null);
  }, [artworkProp]);

  React.useEffect(() => {
    setImgError(false);
    setImgLoaded(false);
    artworkRetriesRef.current = 0;
    setArtworkRetryKey(0);
    artworkRetryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    artworkRetryTimersRef.current = [];
  }, [artwork]);

  React.useEffect(() => {
    return () => {
      artworkRetryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      artworkRetryTimersRef.current = [];
    };
  }, []);

  const fallbackToSeriesArt = React.useCallback(() => {
    const m = meta as unknown as { poster?: string | null; background?: string | null };
    const fallback = m.poster || m.background || null;
    if (fallback && fallback !== artwork) setArtworkOverride(fallback);
    else setImgError(true);
  }, [artwork, meta]);

  const handleArtworkError = React.useCallback(() => {
    if (artworkRetriesRef.current < MAX_ARTWORK_RETRIES) {
      artworkRetriesRef.current += 1;
      const retry = artworkRetriesRef.current;
      const timer = window.setTimeout(() => {
        artworkRetryTimersRef.current = artworkRetryTimersRef.current.filter((id) => id !== timer);
        setArtworkRetryKey(retry);
      }, 400 * retry);
      artworkRetryTimersRef.current.push(timer);
    } else {
      fallbackToSeriesArt();
    }
  }, [fallbackToSeriesArt]);

  React.useEffect(() => {
    if (!artwork || imgLoaded || imgError) return;
    const timer = setTimeout(fallbackToSeriesArt, 12000);
    return () => clearTimeout(timer);
  }, [artwork, imgLoaded, imgError, fallbackToSeriesArt]);

  const progress = lib.timeOffset && lib.duration ? lib.timeOffset / lib.duration : 0;
  const isUpNext = meta.type === 'series' && (progress < 0.005 || progress >= 0.995);
  const remainingText = !isUpNext && lib.timeOffset && lib.duration
    ? progressDirection === 'watched'
      ? remainingFormat === 'percent'
        ? t('format.watched_percent', Math.round(progress * 100))
        : formatWatched(lib.timeOffset)
      : remainingFormat === 'percent'
      ? t('format.remaining_percent', Math.round((1 - progress) * 100))
      : formatRemaining(lib.timeOffset, lib.duration)
    : null;
  const scheduledText = lib.continueWatchingBadge === 'scheduledEpisode'
    ? formatReleaseCountdown(lib.newEpisodeReleasedAt)
    : null;
  const badge = resolveBadge(lib.continueWatchingBadge, meta.type, isUpNext, remainingText, scheduledText);
  const isScheduled = lib.continueWatchingBadge === 'scheduledEpisode';
  const cornerText = isScheduled
    ? formatAirDay(lib.newEpisodeReleasedAt)
    : lib.unwatchedAhead && lib.unwatchedAhead > 0
      ? `+${lib.unwatchedAhead}`
      : null;
  return (
    <div
      role="button"
      tabIndex={0}
      style={{
        ...(isHorizontal ? cwStyles.landscapeCard : cwStyles.posterCard),
        opacity: (dismissing || pending) ? 0 : 1,
        transform: dismissing ? 'translateX(-0.75rem)' : hovered ? 'translateY(-0.125rem)' : 'translateY(0)',
        transition: dismissing ? 'opacity 0.22s ease, transform 0.22s ease' : 'opacity 0.22s ease, transform 0.16s ease',
        boxShadow: hovered && !dismissing && !pending ? '0 0 0 0.125rem rgba(255,255,255,0.44)' : 'none',
        pointerEvents: (dismissing || pending) ? 'none' : undefined,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onClick={() => !dismissing && !pending && onClick(meta)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!dismissing && !pending) onClick(meta); }
      }}
      onTransitionEnd={(e) => {
        if (dismissing && e.propertyName === 'opacity') onDismissAnimationEnd(meta);
      }}
    >
      <div style={cwStyles.imageArea}>
        {artwork && !imgError ? (
          <img key={artworkRetryKey} src={artworkSrc ?? undefined} alt={meta.name} loading="lazy" decoding="async" style={{ ...cwStyles.artwork, opacity: imgLoaded ? 1 : 0, transition: 'opacity 0.22s ease' }} onLoad={() => setImgLoaded(true)} onError={handleArtworkError} />
        ) : (
          <div style={cwStyles.thumbPlaceholder}>
            <span style={cwStyles.placeholderText}>{meta.name.slice(0, 1).toUpperCase()}</span>
          </div>
        )}
        {!isUpNext && progress > 0 && (
          <div style={cwStyles.imageProgressBg}>
            <div style={{ ...cwStyles.progressBar, width: `${Math.min(progress, 1) * 100}%` }} />
          </div>
        )}
        {badge && (
          <div style={badge.variant === 'new' ? { ...cwStyles.remainingBadge, ...cwStyles.newEpisodeBadge } : cwStyles.remainingBadge}>
            {badge.text}
          </div>
        )}
        {cornerText && (
          <div style={cwStyles.cornerBadge}>{cornerText}</div>
        )}

        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', opacity: hovered && !dismissing && !pending ? 1 : 0, transition: 'opacity 0.16s ease' }}>
          <div style={{ width: '3.5rem', height: '3.5rem', borderRadius: '50%', background: 'rgba(255,255,255,0.14)', backdropFilter: 'blur(0.375rem)', border: '1px solid rgba(255,255,255,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="white" style={{ marginLeft: '0.1875rem' }}><path d="M8 5v14l11-7z" /></svg>
          </div>
        </div>
      </div>

      <div style={cwStyles.footer}>
        <div style={cwStyles.metaStack}>
          <p style={cwStyles.name}>{meta.name}</p>
          <p style={cwStyles.episodeName}>{episodeLine ?? (meta.type === 'series' ? t('auto.up_next') : '')}</p>
        </div>
        {!hideActions && (
        <div style={{ ...cwStyles.hoverActions, opacity: hovered && !dismissing && !pending ? 1 : 0, pointerEvents: hovered && !dismissing && !pending ? 'auto' : 'none', transition: 'opacity 0.16s ease' }} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            title={t('detail.mark_watched')}
            style={cwStyles.actionBtn}
            onClick={() => onMarkWatched(meta)}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            title={t('home.drop_continue_watching')}
            style={cwStyles.actionBtn}
            onClick={() => onDrop(meta)}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <X size={14} />
          </button>
        </div>
        )}
      </div>
    </div>
  );
}

const cwStyles: Record<string, React.CSSProperties> = {
  landscapeCard: { position: 'relative', width: '19.875rem', minWidth: '19.875rem', height: '13.625rem', borderRadius: '0.125rem', overflow: 'hidden', background: '#050506', cursor: 'pointer', outline: 'none' },
  posterCard: { position: 'relative', width: '8rem', minWidth: '8rem', height: '13.625rem', borderRadius: '0.1875rem', overflow: 'hidden', background: '#141922', cursor: 'pointer', outline: 'none' },
  imageArea: { position: 'relative', width: '100%', height: '10.0625rem', overflow: 'hidden', background: '#141922' },
  artwork: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  thumbPlaceholder: { width: '100%', height: '100%', background: '#1B212B', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  placeholderText: { color: 'rgba(255,255,255,0.22)', fontSize: '3rem', fontWeight: 900 },
  footer: { height: '3.5625rem', padding: '0.5625rem 0.625rem 0.625rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', background: '#050506' },
  metaStack: { flex: 1, minWidth: 0 },
  imageProgressBg: { position: 'absolute', left: '0.625rem', right: '0.625rem', bottom: '0.5rem', height: '0.25rem', borderRadius: '62.4375rem', background: 'rgba(255,255,255,0.25)' },
  progressBar: { height: '100%', borderRadius: '62.4375rem', background: 'var(--primary-accent-color)' },
  remainingBadge: { position: 'absolute', top: '0.5rem', right: '0.5625rem', color: '#FFFFFF', fontSize: '0.75rem', fontWeight: 800, textShadow: '0 1px 0.3125rem rgba(0,0,0,0.88)', background: 'rgba(0,0,0,0.42)', borderRadius: '0.25rem', padding: '0.1875rem 0.375rem' },
  newEpisodeBadge: { background: 'var(--primary-accent-color)', color: 'var(--primary-accent-foreground-color)', textShadow: 'none' },
  cornerBadge: { position: 'absolute', top: '0.5rem', left: '0.5625rem', color: '#FFFFFF', fontSize: '0.75rem', fontWeight: 800, textShadow: '0 1px 0.3125rem rgba(0,0,0,0.88)', background: 'rgba(0,0,0,0.42)', borderRadius: '0.25rem', padding: '0.1875rem 0.375rem' },

  episodeName: { color: 'rgba(255,255,255,0.68)', fontSize: '0.8125rem', fontWeight: 600, margin: '0.25rem 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  name: { color: '#FFFFFF', fontSize: '0.9375rem', fontWeight: 800, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.12 },
  hoverActions: { display: 'flex', alignItems: 'center', gap: '0.375rem', flexShrink: 0 },
  actionBtn: { width: '1.6875rem', height: '1.6875rem', borderRadius: '62.4375rem', border: '0.0938rem solid rgba(255,255,255,0.5)', background: 'transparent', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 },
};

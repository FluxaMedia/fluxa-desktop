import React from 'react';
import { Check, X } from 'lucide-react';
import type { LibraryItem, Meta } from '../core/types';
import {
  formatRemaining,
  formatWatched,
  formatReleaseCountdown,
} from '../core/continueWatchingUtils';
import { t } from '../i18n';

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
  onClick: (m: Meta) => void;
  onMarkWatched: (m: Meta) => void;
  onDrop: (m: Meta) => void;
  onDismissAnimationEnd: (m: Meta) => void;
}) {
  const [hovered, setHovered] = React.useState(false);
  const [imgError, setImgError] = React.useState(false);
  const [imgLoaded, setImgLoaded] = React.useState(false);
  const [artworkOverride, setArtworkOverride] = React.useState<string | null>(null);
  const artwork = artworkOverride ?? artworkProp;

  const lib = meta as unknown as LibraryItem & {
    lastEpisodeName?: string;
    lastEpisodeSeason?: number;
    lastEpisodeNumber?: number;
    lastEpisodeThumbnail?: string;
    continueWatchingPoster?: string;
    continueWatchingBackground?: string;
    continueWatchingBadge?: string;
    newEpisodeReleasedAt?: string;
  };

  React.useEffect(() => {
    setImgError(false);
    setImgLoaded(false);
    setArtworkOverride(null);
  }, [artworkProp]);

  const progress = lib.timeOffset && lib.duration ? lib.timeOffset / lib.duration : 0;
  const isUpNext = progress < 0.005 || progress >= 0.995;
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
  return (
    <div
      role="button"
      tabIndex={0}
      style={{
        ...(isHorizontal ? cwStyles.landscapeCard : cwStyles.posterCard),
        opacity: (dismissing || pending) ? 0 : 1,
        transform: dismissing ? 'translateX(-12px)' : hovered ? 'translateY(-2px)' : 'translateY(0)',
        transition: dismissing ? 'opacity 0.22s ease, transform 0.22s ease' : 'opacity 0.22s ease, transform 0.16s ease',
        boxShadow: hovered && !dismissing && !pending ? '0 0 0 2px rgba(255,255,255,0.44)' : 'none',
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
          <img src={artwork} alt={meta.name} loading="lazy" decoding="async" style={{ ...cwStyles.artwork, opacity: imgLoaded ? 1 : 0, transition: 'opacity 0.22s ease' }} onLoad={() => setImgLoaded(true)} onError={() => {
            const m = meta as unknown as { poster?: string | null; background?: string | null };
            const fallback = m.poster || m.background || null;
            if (fallback && fallback !== artwork) { setArtworkOverride(fallback); } else { setImgError(true); }
          }} />
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

        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', opacity: hovered && !dismissing && !pending ? 1 : 0, transition: 'opacity 0.16s ease' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.14)', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="white" style={{ marginLeft: 3 }}><path d="M8 5v14l11-7z" /></svg>
          </div>
        </div>
      </div>

      <div style={cwStyles.footer}>
        <div style={cwStyles.metaStack}>
          <p style={cwStyles.name}>{meta.name}</p>
          <p style={cwStyles.episodeName}>{episodeLine ?? (meta.type === 'series' ? t('auto.up_next') : '')}</p>
        </div>
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
      </div>
    </div>
  );
}

const cwStyles: Record<string, React.CSSProperties> = {
  landscapeCard: { position: 'relative', width: 318, minWidth: 318, height: 218, borderRadius: 2, overflow: 'hidden', background: '#050506', cursor: 'pointer', outline: 'none' },
  posterCard: { position: 'relative', width: 128, minWidth: 128, height: 218, borderRadius: 3, overflow: 'hidden', background: '#141922', cursor: 'pointer', outline: 'none' },
  imageArea: { position: 'relative', width: '100%', height: 161, overflow: 'hidden', background: '#141922' },
  artwork: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  thumbPlaceholder: { width: '100%', height: '100%', background: '#1B212B', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  placeholderText: { color: 'rgba(255,255,255,0.22)', fontSize: 48, fontWeight: 900 },
  footer: { height: 57, padding: '9px 10px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: '#050506' },
  metaStack: { flex: 1, minWidth: 0 },
  imageProgressBg: { position: 'absolute', left: 10, right: 10, bottom: 8, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.25)' },
  progressBar: { height: '100%', borderRadius: 999, background: 'var(--primary-accent-color)' },
  remainingBadge: { position: 'absolute', top: 8, right: 9, color: '#FFFFFF', fontSize: 12, fontWeight: 800, textShadow: '0 1px 5px rgba(0,0,0,0.88)', background: 'rgba(0,0,0,0.42)', borderRadius: 4, padding: '3px 6px' },
  newEpisodeBadge: { background: 'var(--primary-accent-color)', color: 'var(--primary-accent-foreground-color)', textShadow: 'none' },

  episodeName: { color: 'rgba(255,255,255,0.68)', fontSize: 13, fontWeight: 600, margin: '4px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  name: { color: '#FFFFFF', fontSize: 15, fontWeight: 800, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.12 },
  hoverActions: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
  actionBtn: { width: 27, height: 27, borderRadius: 999, border: '1.5px solid rgba(255,255,255,0.5)', background: 'transparent', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 },
};

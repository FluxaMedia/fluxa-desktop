import React, { useState } from 'react';
import { CheckCircle2, Circle, Play } from 'lucide-react';
import { t } from '../../i18n';
import type { Video } from '../../core/types';
import { MS } from './detailStyles';
import { formatEpDate } from './EpisodePanel';

export function epReleaseCountdown(date?: string): string {
  if (!date) return '';
  const diff = new Date(date).getTime() - Date.now();
  if (diff <= 0) return t('format.remaining_almost_done');
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return hours % 24 > 0 ? t('format.countdown_compact_dh', days, hours % 24) : t('format.countdown_compact_d', days);
  if (hours > 0) return mins % 60 > 0 ? t('format.countdown_compact_hm', hours, mins % 60) : t('format.countdown_compact_h', hours);
  return t('format.countdown_compact_m', mins);
}

function episodeContentRating(episode: Video): string | null {
  const record = episode as unknown as Record<string, unknown>;
  const cr = record.contentRating ?? record.certification ?? record.rated ?? record.ageRating;
  return typeof cr === 'string' && cr.trim() ? cr.trim() : null;
}

export function ModernEpisodeCard({ episode, number, isWatched, progressPct, minutesRemaining, cwBadge, cwScheduledDate, blurUnwatched, spoilerHide, onClick, onToggleWatched }: {
  episode: Video; number: number; isWatched: boolean; progressPct: number; minutesRemaining: number;
  cwBadge?: string | null; cwScheduledDate?: string; blurUnwatched?: boolean; spoilerHide?: boolean; onClick: () => void; onToggleWatched?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [thumbErr, setThumbErr] = useState(false);
  const [watchBtnHovered, setWatchBtnHovered] = useState(false);
  const title = episode.title?.trim() || episode.name?.trim() || t('format.episode_number', episode.episode ?? episode.number ?? number);
  const desc = (episode as unknown as { overview?: string }).overview;
  const dateStr = episode.released ? formatEpDate(episode.released) : null;
  const runtime = (episode as unknown as { runtime?: string }).runtime;
  const contentRating = episodeContentRating(episode);

  void watchBtnHovered;

  const dimmed = blurUnwatched && !isWatched;
  const hideInfo = spoilerHide && !isWatched && cwBadge !== 'scheduledEpisode';
  const displayTitle = hideInfo ? t('format.episode_number', episode.episode ?? episode.number ?? number) : title;

  return (
    <div
      style={{ ...MS.epCard, opacity: dimmed ? 0.45 : 1 }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={MS.epThumb}>
        {episode.thumbnail && !thumbErr ? (
          <img src={episode.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: isWatched ? 0.48 : 1, transition: 'opacity 0.2s', filter: hideInfo && !hovered ? 'blur(16px)' : undefined, transform: hideInfo && !hovered ? 'scale(1.1)' : undefined }} onError={() => setThumbErr(true)} />
        ) : (
          <div style={MS.epThumbPlaceholder}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="rgba(255,255,255,0.07)">
              <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z" />
            </svg>
          </div>
        )}
        {minutesRemaining > 0 && <div style={MS.epTimeRemaining}>{t('format.remaining_minutes', minutesRemaining)}</div>}
        {progressPct > 0 && (
          <div style={MS.epProgressTrack}>
            <div style={{ ...MS.epProgressFill, width: `${progressPct}%`, background: 'var(--primary-accent-color)' }} />
          </div>
        )}
        {cwBadge && !minutesRemaining && (
          <div style={{
            position: 'absolute', top: 7, left: 7, zIndex: 3,
            background: cwBadge === 'newEpisode' ? 'var(--primary-accent-color)' : 'rgba(0,0,0,0.68)',
            color: cwBadge === 'newEpisode' ? 'var(--primary-accent-foreground-color, #fff)' : '#fff',
            backdropFilter: cwBadge !== 'newEpisode' ? 'blur(4px)' : undefined,
            fontSize: 11, fontWeight: 800,
            padding: '3px 7px', borderRadius: 4,
            textShadow: cwBadge === 'newEpisode' ? 'none' : '0 1px 4px rgba(0,0,0,0.8)',
            letterSpacing: '0.2px',
          }}>
            {cwBadge === 'newEpisode' ? t('auto.new_episode')
              : cwBadge === 'upNext' ? t('auto.up_next')
              : cwBadge === 'scheduledEpisode' ? epReleaseCountdown(cwScheduledDate)
              : null}
          </div>
        )}
        {isWatched && !hovered && (
          <div style={{ position: 'absolute', top: 7, right: 7, zIndex: 3, pointerEvents: 'none' }}>
            <CheckCircle2 size={18} color="rgba(255,255,255,0.7)" />
          </div>
        )}
        {hovered && (
          <div style={MS.epHoverOverlay}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(255,255,255,0.14)', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Play size={22} fill="currentColor" strokeWidth={0} color="white" style={{ marginLeft: 2 }} />
            </div>
          </div>
        )}
        {onToggleWatched && hovered && (
          <button
            style={{ position: 'absolute', top: 5, right: 5, width: 32, height: 32, borderRadius: '50%', border: 'none', padding: 0, background: 'rgba(0,0,0,0.52)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 4, flexShrink: 0 }}
            onClick={(e) => { e.stopPropagation(); onToggleWatched(); }}
            onMouseEnter={(e) => { e.stopPropagation(); setWatchBtnHovered(true); }}
            onMouseLeave={(e) => { e.stopPropagation(); setWatchBtnHovered(false); }}
            title={isWatched ? t('detail.mark_unwatched') : t('detail.mark_watched')}
          >
            {isWatched ? (
              <CheckCircle2 size={18} color="rgba(255,255,255,0.9)" />
            ) : (
              <Circle size={18} color="rgba(255,255,255,0.55)" />
            )}
          </button>
        )}
      </div>
      <h3 style={{ ...MS.epTitle, color: hovered ? 'rgba(255,255,255,0.82)' : '#FFFFFF' }}>{number}. {displayTitle}</h3>
      {desc && !hideInfo && <p style={MS.epDesc}>{desc}</p>}
      <div style={MS.epMetaRow}>
        {contentRating && <span style={MS.epRatingBadge}>{contentRating}</span>}
        {(runtime || dateStr) && <span style={MS.epMetaText}>{[runtime, dateStr].filter(Boolean).join('  ')}</span>}
      </div>
    </div>
  );
}

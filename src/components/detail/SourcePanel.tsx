import React, { useMemo, useState } from 'react';
import { t } from '../../i18n';
import { EP, MS, SS, spinnerStyle } from './detailStyles';
import type { Meta, Stream, Video } from '../../core/types';

export function streamDisplayText(value: string | undefined): string | undefined {
  const text = value?.replace(/\\r\\n|\\n|\\r/g, '\n').replace(/\r\n|\r/g, '\n').trim();
  return text || undefined;
}

export const SourceRow = React.memo(function SourceRow({ stream, onClick }: { stream: Stream; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const heading = streamDisplayText(stream.name) || streamDisplayText(stream.title) || streamDisplayText(stream.description) || t('player.source');
  const seenLines = new Set<string>();
  const lines = [stream.title, stream.description]
    .map(streamDisplayText)
    .filter((value): value is string => {
      if (!value || value === heading || seenLines.has(value)) return false;
      seenLines.add(value);
      return true;
    });
  return (
    <button
      style={{ ...SS.streamRow, background: hovered ? '#181818' : '#101010', color: '#FFF', boxShadow: hovered ? '0 0 0 0.125rem rgba(255,255,255,0.22)' : 'none' }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', width: '100%' }}>
        <span style={SS.streamName}>{heading}</span>
        {stream.addonName && <span style={{ ...SS.streamAddon, color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>{stream.addonName}</span>}
      </div>
      {lines.map((line, index) => (
        <span key={`${line}:${index}`} style={SS.streamDesc}>{line}</span>
      ))}
    </button>
  );
});

export function MovieSourcePanel({
  meta,
  streams,
  isLoading,
  availableAddons,
  onPlay,
  onClose,
}: {
  meta: Meta;
  streams: Stream[];
  isLoading: boolean;
  availableAddons: string[];
  onPlay: (stream: Stream) => void;
  onClose?: () => void;
}) {
  const [selectedAddon, setSelectedAddon] = useState<string | null>(null);

  const addonNames = useMemo(
    () => [...new Set(streams.map((s) => s.addonName).filter((n): n is string => !!n))],
    [streams],
  );

  const visibleStreams = selectedAddon ? streams.filter((s) => s.addonName === selectedAddon) : streams;
  const rootStyle: React.CSSProperties = onClose ? { display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 } : EP.panel;

  return (
    <div style={rootStyle}>
      <div style={{ padding: '0.875rem 1rem 0.75rem', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
        <div>
          {meta.logo
            ? <img src={meta.logo} alt="" style={{ display: 'block', maxWidth: '8.75rem', maxHeight: '2.75rem', objectFit: 'contain', objectPosition: 'left', marginBottom: '0.125rem' }} />
            : <h3 style={{ ...EP.sourceTitle, margin: '0 0 0.125rem' }}>{meta.name ?? meta.id}</h3>
          }
        </div>
        {onClose && (
          <button style={MS.overlayCloseBtn} onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        )}
      </div>

      {(isLoading || addonNames.length > 0) && (
        <div style={{ ...EP.sourcePills, padding: '0.625rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <button style={{ ...(selectedAddon === null ? SS.pill : SS.pillMuted), cursor: 'pointer', border: 'none' }} onClick={() => setSelectedAddon(null)}>{t('auto.all')}</button>
          {addonNames.map((addon) => (
            <button
              key={addon}
              style={{ ...(selectedAddon === addon ? SS.pill : SS.pillMuted), cursor: 'pointer', border: 'none' }}
              onClick={() => setSelectedAddon(selectedAddon === addon ? null : addon)}
            >{addon}</button>
          ))}
        </div>
      )}

      <div style={EP.inlineSources}>
        {isLoading && visibleStreams.length === 0 && <div style={SS.center}><div style={spinnerStyle} /></div>}
        {!isLoading && visibleStreams.length === 0 && (
          <div style={SS.center}>
            <p style={SS.emptyText}>{availableAddons.length === 0 ? t('sources.no_stream_addons') : t('auto.no_sources_found_3019f12c')}</p>
          </div>
        )}
        {visibleStreams.length > 0 && (
          <div style={EP.inlineStreamList}>
            {visibleStreams.map((stream, i) => (
              <SourceRow key={`${stream.url ?? stream.infoHash ?? i}`} stream={stream} onClick={() => onPlay(stream)} />
            ))}
            {isLoading && <div style={{ ...SS.center, padding: '1rem 0' }}><div style={{ ...spinnerStyle, width: '1.25rem', height: '1.25rem' }} /></div>}
          </div>
        )}
      </div>
    </div>
  );
}

export function InlineSourceList({
  episode,
  meta,
  streams,
  isLoading,
  availableAddons,
  onBack,
  onPlay,
}: {
  episode: Video;
  meta: Meta;
  streams: Stream[];
  isLoading: boolean;
  availableAddons: string[];
  onBack: () => void;
  onPlay: (stream: Stream) => void;
}) {
  const [selectedAddon, setSelectedAddon] = useState<string | null>(null);

  const addonNames = useMemo(
    () => [...new Set(streams.map((s) => s.addonName).filter((n): n is string => !!n))],
    [streams],
  );

  const visibleStreams = selectedAddon ? streams.filter((s) => s.addonName === selectedAddon) : streams;
  const epNum = episode.episode ?? episode.number ?? '';
  const seasonNum = episode.season ?? 1;
  const epTitle = episode.title?.trim() || episode.name?.trim() || t('format.episode_number', epNum);
  const episodeLabel = `S${seasonNum}, E${epNum}: ${epTitle}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ padding: '0.8125rem 1rem 0', flexShrink: 0 }}>
        <button style={EP.backToEpisodesBtn} onClick={onBack}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
          </svg>
          <span>{t('auto.episodes')}</span>
        </button>
        <div style={{ ...EP.sourceHeader, padding: '0.625rem 0 0.875rem' }}>
          {meta.logo
            ? <img src={meta.logo} alt="" style={{ display: 'block', maxWidth: '8.75rem', maxHeight: '2.75rem', objectFit: 'contain', objectPosition: 'left', marginBottom: '0.375rem' }} />
            : <h3 style={{ ...EP.sourceTitle, margin: '0 0 0.375rem' }}>{meta.name ?? meta.id}</h3>
          }
          <p style={EP.sourceSubtitle}>{episodeLabel}</p>
          {episode.overview && (
            <p style={{ color: 'rgba(255,255,255,0.42)', fontSize: '0.75rem', fontWeight: 400, margin: '0.3125rem 0 0', lineHeight: '1.0625rem', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{episode.overview}</p>
          )}
        </div>
      </div>

      {(isLoading || addonNames.length > 0) && (
        <div style={{ ...EP.sourcePills, padding: '0 1rem 0.625rem', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <button style={{ ...(selectedAddon === null ? SS.pill : SS.pillMuted), cursor: 'pointer', border: 'none' }} onClick={() => setSelectedAddon(null)}>{t('auto.all')}</button>
          {addonNames.map((addon) => (
            <button
              key={addon}
              style={{ ...(selectedAddon === addon ? SS.pill : SS.pillMuted), cursor: 'pointer', border: 'none' }}
              onClick={() => setSelectedAddon(selectedAddon === addon ? null : addon)}
            >{addon}</button>
          ))}
        </div>
      )}

      <div style={EP.inlineSources}>
        {isLoading && visibleStreams.length === 0 && <div style={SS.center}><div style={spinnerStyle} /></div>}
        {!isLoading && visibleStreams.length === 0 && (
          <div style={SS.center}>
            <p style={SS.emptyText}>{availableAddons.length === 0 ? t('sources.no_stream_addons') : t('auto.no_sources_found_3019f12c')}</p>
          </div>
        )}
        {visibleStreams.length > 0 && (
          <div style={EP.inlineStreamList}>
            {visibleStreams.map((stream, i) => (
              <SourceRow key={`${stream.url ?? stream.infoHash ?? i}`} stream={stream} onClick={() => onPlay(stream)} />
            ))}
            {isLoading && <div style={{ ...SS.center, padding: '1rem 0' }}><div style={{ ...spinnerStyle, width: '1.25rem', height: '1.25rem' }} /></div>}
          </div>
        )}
      </div>
    </div>
  );
}

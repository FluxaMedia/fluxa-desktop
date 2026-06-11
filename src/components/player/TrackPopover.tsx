import { Check } from 'lucide-react';
import { t } from '../../i18n';
import type { PlayerTrackOption } from '../../core/mpvPlayer';

interface TrackPopoverProps {
  type: 'audio' | 'sub' | 'speed';
  audioTracks: PlayerTrackOption[];
  subTracks: PlayerTrackOption[];
  playbackSpeed: number;
  showEpisodePanel: boolean;
  onSetSpeed: (speed: number) => void;
  onSelectTrack: (type: 'audio' | 'sub', id: string) => void;
  onDisableSubs: () => void;
}

export function TrackPopover({
  type, audioTracks, subTracks, playbackSpeed, showEpisodePanel,
  onSetSpeed, onSelectTrack, onDisableSubs,
}: TrackPopoverProps) {
  const tracks = type === 'audio' ? audioTracks : subTracks;
  const noSubSelected = !subTracks.some((tr) => tr.selected);

  return (
    <div
      style={{ position: 'absolute', bottom: 92, right: showEpisodePanel ? 396 : 14, background: 'rgba(18,22,30,0.97)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '6px 0', minWidth: type === 'speed' ? 140 : 200, maxHeight: 300, overflowY: 'auto', zIndex: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 700, letterSpacing: 0.8, padding: '4px 14px 8px', textTransform: 'uppercase' }}>
        {type === 'audio' ? 'Audio' : type === 'sub' ? 'Subtitles' : 'Speed'}
      </div>
      {type === 'speed' ? (
        [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0].map((s) => (
          <button
            key={s}
            onClick={() => onSetSpeed(s)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', color: playbackSpeed === s ? '#fff' : 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: playbackSpeed === s ? 700 : 400, padding: '8px 14px', cursor: 'pointer', textAlign: 'left' }}
          >
            <span style={{ width: 14, color: 'var(--primary-accent-color)' }}>{playbackSpeed === s && <Check size={14} />}</span>
            {s === 1.0 ? 'Normal' : `${s}×`}
          </button>
        ))
      ) : (
        <>
          {type === 'sub' && (
            <button
              onClick={onDisableSubs}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.07)', color: noSubSelected ? '#fff' : 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: noSubSelected ? 600 : 400, padding: '8px 14px', cursor: 'pointer', textAlign: 'left', marginBottom: 4 }}
            >
              <span style={{ width: 14, color: 'var(--primary-accent-color)' }}>
                {noSubSelected && <Check size={14} />}
              </span>
              {t('player.subtitles_off')}
            </button>
          )}
          {tracks.map((track) => (
            <button
              key={track.id}
              onClick={() => onSelectTrack(type as 'audio' | 'sub', track.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', color: track.selected ? '#fff' : 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: track.selected ? 600 : 400, padding: '8px 14px', cursor: 'pointer', textAlign: 'left' }}
            >
              <span style={{ width: 14, color: 'var(--primary-accent-color)' }}>{track.selected && <Check size={14} />}</span>
              {track.label}
            </button>
          ))}
          {tracks.length === 0 && (
            <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, padding: '8px 14px' }}>None available</div>
          )}
        </>
      )}
    </div>
  );
}

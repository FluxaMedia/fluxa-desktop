import { useState } from 'react';
import { t } from '../../i18n';

interface NextEpCardProps {
  subtitle: string;
  posterUrl?: string;
  countdown: number | null;
  countdownTotal: number;
  bottom: number;
  onPlay: () => void;
  onDismiss: () => void;
}

export function NextEpCard({ subtitle, posterUrl: _posterUrl, countdown, countdownTotal, bottom, onPlay, onDismiss }: NextEpCardProps) {
  const [hovered, setHovered] = useState(false);
  const epCodeMatch = subtitle.match(/^(S\d+:E\d+)\s+(.+)/i);
  const epCode = epCodeMatch ? epCodeMatch[1] : null;
  const epTitle = epCodeMatch ? epCodeMatch[2] : subtitle;
  const progress = countdown !== null ? (countdown / countdownTotal) * 100 : null;

  return (
    <div style={{ position: 'absolute', bottom, right: 22, zIndex: 4, minWidth: 220, maxWidth: 310 }}>
      <div
        style={{
          background: hovered ? 'rgba(28,33,44,0.97)' : 'rgba(18,22,30,0.93)',
          backdropFilter: 'blur(12px)',
          border: `1px solid ${hovered ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.14)'}`,
          borderRadius: 10,
          color: '#fff',
          overflow: 'hidden',
          transition: 'background 0.15s, border-color 0.15s',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(); }}
            style={{ flex: 1, background: 'none', border: 'none', color: '#fff', cursor: 'pointer', textAlign: 'left', padding: 0, minWidth: 0 }}
          >
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {countdown !== null ? t('player.playing_in_seconds', countdown) : t('auto.up_next')}
            </span>
            {epCode && (
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 2 }}>{epCode}</span>
            )}
            <span style={{ fontSize: 13, fontWeight: 700, display: 'block', lineHeight: 1.3 }}>{epTitle}</span>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: '2px 0 0 0', fontSize: 16, lineHeight: 1, flexShrink: 0, transition: 'color 0.15s' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.9)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.4)'; }}
            aria-label={t('player.dismiss')}
          >
            ×
          </button>
        </div>
        {progress !== null && (
          <div style={{ height: 2, background: 'rgba(255,255,255,0.10)' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'rgba(255,255,255,0.75)', transition: 'width 1s linear' }} />
          </div>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Play, X } from 'lucide-react';
import { t } from '../../i18n';

interface NextEpCardProps {
  subtitle: string;
  thumbnail: string | null;
  countdown: number | null;
  countdownTotal: number;
  bottom: number;
  onPlay: () => void;
  onDismiss: () => void;
}

const RING_SIZE = 44;
const RING_STROKE = 2.5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

export function NextEpCard({ subtitle, thumbnail, countdown, countdownTotal, bottom, onPlay, onDismiss }: NextEpCardProps) {
  const [hovered, setHovered] = useState(false);
  const [thumbErr, setThumbErr] = useState(false);
  const epCodeMatch = subtitle.match(/^(S\d+:E\d+)\s+(.+)/i);
  const epCode = epCodeMatch ? epCodeMatch[1] : null;
  const epTitle = epCodeMatch ? epCodeMatch[2] : subtitle;
  const progress = countdown !== null ? countdown / countdownTotal : null;
  const borderColor = hovered ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.35)';

  return (
    <div
      style={{
        position: 'absolute',
        bottom,
        right: 0,
        zIndex: 4,
        display: 'flex',
        flexDirection: 'column',
        maxWidth: '21.25rem',
        background: hovered ? 'rgba(28,33,44,0.97)' : 'rgba(18,22,30,0.93)',
        backdropFilter: 'blur(0.75rem)',
        border: `1px solid ${borderColor}`,
        borderRadius: '0.5rem 0 0 0.5rem',
        overflow: 'hidden',
        animation: 'fluxa-nextep-in 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {thumbnail && !thumbErr && (
        <button
          onClick={(e) => { e.stopPropagation(); onPlay(); }}
          aria-label={t('player.next_label', epTitle)}
          style={{ display: 'block', width: '100%', height: '11.875rem', border: 'none', borderBottom: `1px solid ${borderColor}`, padding: 0, cursor: 'pointer', background: '#0d0f16', transition: 'border-color 0.15s' }}
        >
          <img
            src={thumbnail}
            alt=""
            onError={() => setThumbErr(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </button>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6875rem', padding: '0.5rem 1.1875rem 0.5rem 0.5rem' }}>
        <button
          onClick={(e) => { e.stopPropagation(); onPlay(); }}
          aria-label={t('player.next_label', epTitle)}
          style={{
            position: 'relative',
            width: `${RING_SIZE}px`,
            height: `${RING_SIZE}px`,
            flexShrink: 0,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width={RING_SIZE} height={RING_SIZE} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="rgba(255,255,255,0.14)"
              strokeWidth={RING_STROKE}
            />
            {progress !== null && (
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke="var(--primary-accent-color)"
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                strokeDasharray={RING_CIRC}
                strokeDashoffset={RING_CIRC * (1 - progress)}
                style={{ transition: 'stroke-dashoffset 1s linear' }}
              />
            )}
          </svg>
          <Play size={16} fill="#fff" strokeWidth={0} style={{ marginLeft: '0.0625rem' }} />
        </button>

        <button
          onClick={(e) => { e.stopPropagation(); onPlay(); }}
          style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', textAlign: 'left', padding: 0, minWidth: 0 }}
        >
          <span style={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '0.0625rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {t('auto.up_next')}
          </span>
          <span style={{ fontSize: '0.9375rem', fontWeight: 700, display: 'block', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '14.375rem' }}>
            {epCode ? `${epCode} · ${epTitle}` : epTitle}
          </span>
        </button>

        <button
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.4)',
            cursor: 'pointer',
            padding: '0.25rem',
            marginLeft: '0.25rem',
            display: 'flex',
            flexShrink: 0,
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.9)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.4)'; }}
          aria-label={t('player.dismiss')}
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

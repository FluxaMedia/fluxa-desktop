import { ChevronLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { embeddedMpvStatus } from '../core/mpvPlayer';

interface Props {
  background?: string | null;
  logo?: string | null;
  title?: string;
  episodeLine?: string;
  onBack?: () => void;
}

const BUFFER_TARGET_SECS = 5;
const MIN_VISIBLE_PROGRESS = 0.045;

export function PlayerLoadingOverlay({ background, logo, title, episodeLine, onBack }: Props) {
  const [buffering, setBuffering] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const status = await embeddedMpvStatus().catch(() => null);
      if (cancelled || !status) return;
      const cached = parseFloat(status.demuxerCacheDuration ?? '0') || 0;
      const started = cached > 0.05 || status.coreIdle === 'no' || !!status.videoCodec;
      setBuffering(started);
      setProgress(started ? Math.max(MIN_VISIBLE_PROGRESS, Math.min(1, cached / BUFFER_TARGET_SECS)) : 0);
    };
    void poll();
    const interval = setInterval(poll, 750);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {onBack && (
        <button
          onClick={onBack}
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            zIndex: 1,
            background: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(6px)',
            border: 'none',
            borderRadius: 10,
            width: 42,
            height: 42,
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ChevronLeft size={22} />
        </button>
      )}
      {background && (
        <img
          src={background}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: 0.35,
            pointerEvents: 'none',
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.65) 100%)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', padding: '0 40px' }}>
        {logo ? (
          <div style={{ position: 'relative', width: 480, maxWidth: '100%', height: 160, margin: '0 auto' }}>
            <img
              src={logo}
              alt={title ?? ''}
              className={buffering ? undefined : 'fluxa-loading-logo-breathe'}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                opacity: buffering ? 0.18 : undefined,
                filter: 'drop-shadow(0 4px 24px rgba(0,0,0,0.8))',
              }}
            />
            {buffering && (
              <img
                src={logo}
                alt=""
                className="fluxa-loading-logo-reveal"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  filter: 'drop-shadow(0 4px 24px rgba(0,0,0,0.8))',
                  clipPath: `inset(0 ${(100 - progress * 100).toFixed(2)}% 0 0)`,
                }}
              />
            )}
          </div>
        ) : (
          <span
            className="fluxa-loading-logo-breathe"
            style={{
              color: '#fff',
              fontSize: 36,
              fontWeight: 900,
              fontFamily: "'Montserrat', sans-serif",
              letterSpacing: '-0.5px',
              textShadow: '0 2px 16px rgba(0,0,0,0.8)',
            }}
          >
            {title ?? 'Fluxa'}
          </span>
        )}
        {episodeLine && (
          <p
            style={{
              color: 'rgba(255,255,255,0.65)',
              fontSize: 15,
              marginTop: 12,
              fontFamily: 'sans-serif',
              textShadow: '0 1px 8px rgba(0,0,0,0.8)',
            }}
          >
            {episodeLine}
          </p>
        )}
      </div>
      <style>{`
        @keyframes fluxa-loading-logo-breathe { from { opacity: 0.42; } to { opacity: 0.66; } }
        .fluxa-loading-logo-breathe { animation: fluxa-loading-logo-breathe 1.12s cubic-bezier(0.4,0,0.2,1) infinite alternate; }
        .fluxa-loading-logo-reveal { transition: clip-path 0.52s cubic-bezier(0.4,0,0.2,1); }
      `}</style>
    </div>
  );
}

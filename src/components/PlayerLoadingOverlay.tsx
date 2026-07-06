import { ChevronLeft, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { embeddedMpvStatus } from '../core/mpvPlayer';
import { t } from '../i18n';

interface Props {
  background?: string | null;
  logo?: string | null;
  title?: string;
  episodeLine?: string;
  error?: string | null;
  onBack?: () => void;
}

const BUFFER_TARGET_SECS = 5;
const MIN_VISIBLE_PROGRESS = 0.045;

export function PlayerLoadingOverlay({ background, logo, title, episodeLine, error, onBack }: Props) {
  const [hasMeasuredProgress, setHasMeasuredProgress] = useState(false);
  const [progress, setProgress] = useState(0);
  const [motionMs, setMotionMs] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const failed = !!error;

  const errorLines = (error ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const errorSummary = errorLines[0] ? errorLines[0].charAt(0).toUpperCase() + errorLines[0].slice(1) : '';
  const errorDetails = errorLines.slice(1).join('\n');

  const copyErrorDetails = () => {
    void navigator.clipboard.writeText(error ?? '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  };

  useEffect(() => {
    if (failed) return;
    let cancelled = false;
    const poll = async () => {
      const status = await embeddedMpvStatus().catch(() => null);
      if (cancelled || !status) return;
      const bufferingPct = parseFloat(status.cacheBufferingState ?? '');
      const cached = parseFloat(status.demuxerCacheDuration ?? '0') || 0;
      let next = 0;
      if (status.pausedForCache === 'yes' && Number.isFinite(bufferingPct) && bufferingPct > 0) {
        next = bufferingPct / 100;
      } else if (cached > 0.05) {
        next = cached / BUFFER_TARGET_SECS;
      }
      if (next > 0) {
        setHasMeasuredProgress(true);
        setProgress((prev) => Math.max(prev, MIN_VISIBLE_PROGRESS, Math.min(1, next)));
      }
    };
    void poll();
    const interval = setInterval(poll, 400);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [failed]);

  useEffect(() => {
    if (failed) return;
    let cancelled = false;
    let frame = 0;
    const startedAt = performance.now();
    const animate = (now: number) => {
      if (cancelled) return;
      setMotionMs(now - startedAt);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [failed]);

  const breathe = (Math.sin((motionMs / 1080) * Math.PI * 2 - Math.PI / 2) + 1) / 2;
  const breatheOpacity = 0.42 + breathe * 0.42;
  const breatheScale = 0.992 + breathe * 0.02;

  return (
    <div
      className="fluxa-player-loading-overlay"
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
              className={failed || hasMeasuredProgress ? 'fluxa-loading-logo-dim fluxa-loading-motion' : 'fluxa-loading-logo-breathe fluxa-loading-motion'}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                opacity: failed ? 0.55 : hasMeasuredProgress ? 0.35 : breatheOpacity,
                transform: failed || hasMeasuredProgress ? undefined : `scale(${breatheScale.toFixed(4)})`,
                filter: failed || hasMeasuredProgress
                  ? 'drop-shadow(0 4px 24px rgba(0,0,0,0.8)) brightness(0.72)'
                  : 'drop-shadow(0 4px 24px rgba(0,0,0,0.8))',
              }}
            />
            {!failed && hasMeasuredProgress && (
              <div
                className="fluxa-loading-logo-reveal"
                style={{
                  position: 'absolute',
                  inset: 0,
                  clipPath: `inset(0 ${(100 - progress * 100).toFixed(2)}% 0 0)`,
                }}
              >
                <img
                  src={logo}
                  alt=""
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    filter: 'drop-shadow(0 4px 24px rgba(0,0,0,0.8))',
                  }}
                />
              </div>
            )}
          </div>
        ) : (
          <span
            className={failed ? undefined : 'fluxa-loading-logo-breathe fluxa-loading-motion'}
            style={{
              color: '#fff',
              fontSize: 36,
              fontWeight: 900,
              fontFamily: "'Montserrat', sans-serif",
              letterSpacing: '-0.5px',
              textShadow: '0 2px 16px rgba(0,0,0,0.8)',
              opacity: failed ? 0.75 : breatheOpacity,
              transform: failed ? undefined : `scale(${breatheScale.toFixed(4)})`,
              display: 'inline-block',
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
              textShadow: '0 1px 8px rgba(0,0,0,0.8)',
            }}
          >
            {episodeLine}
          </p>
        )}
        {failed && (
          <div
            style={{
              marginTop: 26,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
              width: 'min(520px, 100%)',
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            <div
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: 'rgba(18,18,22,0.72)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 14,
                backdropFilter: 'blur(16px)',
                boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
                padding: '16px 18px',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: 'rgba(255,90,90,0.13)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <TriangleAlert size={18} color="#ff7b7b" />
                </span>
                <div style={{ minWidth: 0 }}>
                  <p style={{ color: '#fff', fontSize: 15, fontWeight: 700, margin: 0, letterSpacing: 0.1 }}>
                    {t('player.playback_error') || 'Playback failed'}
                  </p>
                  <p
                    style={{
                      color: 'rgba(255,255,255,0.6)',
                      fontSize: 13,
                      margin: '3px 0 0',
                      lineHeight: 1.4,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {errorSummary}
                  </p>
                </div>
              </div>
              {errorDetails && (
                <>
                  <button
                    onClick={() => setDetailsOpen((v) => !v)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      marginTop: 12,
                      color: 'rgba(255,255,255,0.45)',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      letterSpacing: 0.2,
                    }}
                  >
                    {detailsOpen ? t('player.error_hide_details') : t('player.error_show_details')}
                  </button>
                  {detailsOpen && (
                    <pre
                      style={{
                        margin: '10px 0 0',
                        padding: '10px 12px',
                        background: 'rgba(0,0,0,0.4)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        borderRadius: 8,
                        color: 'rgba(255,255,255,0.55)',
                        fontSize: 11.5,
                        fontFamily: "'Cascadia Mono', 'Consolas', monospace",
                        lineHeight: 1.55,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        maxHeight: 140,
                        overflowY: 'auto',
                      }}
                    >
                      {errorDetails}
                    </pre>
                  )}
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {onBack && (
                <button
                  onClick={onBack}
                  style={{
                    background: '#fff',
                    border: 'none',
                    borderRadius: 10,
                    padding: '10px 28px',
                    color: '#000',
                    fontSize: 13.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {t('common.back') || 'Go Back'}
                </button>
              )}
              <button
                onClick={copyErrorDetails}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.14)',
                  borderRadius: 10,
                  padding: '10px 20px',
                  color: 'rgba(255,255,255,0.85)',
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  backdropFilter: 'blur(6px)',
                }}
              >
                {copied ? t('player.error_copied') : t('player.error_copy')}
              </button>
            </div>
          </div>
        )}
      </div>
      <style>{`
        @keyframes fluxa-loading-logo-breathe {
          from { opacity: 0.38; transform: scale(0.992); }
          to { opacity: 0.86; transform: scale(1.012); }
        }
        .fluxa-player-loading-overlay .fluxa-loading-logo-breathe {
          animation: fluxa-loading-logo-breathe 1.08s cubic-bezier(0.4,0,0.2,1) infinite alternate !important;
          transform-origin: center;
          will-change: opacity, transform;
        }
        .fluxa-player-loading-overlay .fluxa-loading-logo-dim {
          opacity: 0.35;
          filter: drop-shadow(0 4px 24px rgba(0,0,0,0.8)) brightness(0.72) !important;
          transition: opacity 0.2s ease, filter 0.2s ease !important;
        }
        .fluxa-player-loading-overlay .fluxa-loading-logo-reveal {
          transition: clip-path 0.42s cubic-bezier(0.4,0,0.2,1) !important;
          will-change: clip-path;
        }
      `}</style>
    </div>
  );
}

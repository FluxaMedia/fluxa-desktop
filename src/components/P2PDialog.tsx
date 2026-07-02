import React from 'react';
import { t } from '../i18n';

const FONT = "'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

interface Props {
  mode: 'first-time' | 'disabled';
  onConfirm: () => void;
  onCancel: () => void;
  onEnableP2P?: () => void;
}

export function P2PDialog({ mode, onConfirm, onCancel, onEnableP2P }: Props) {
  return (
    <div style={S.backdrop} onClick={onCancel}>
      <div style={S.dialog} onClick={(e) => e.stopPropagation()}>
        <p style={S.title}>
          {mode === 'disabled' ? t('p2p.dialog.disabled_title') : t('p2p.dialog.first_time_title')}
        </p>
        <p style={S.body}>
          {mode === 'disabled' ? t('p2p.dialog.disabled_body') : t('p2p.dialog.first_time_body')}
        </p>
        <div style={S.actions}>
          <button style={S.cancelBtn} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          {mode === 'disabled' ? (
            <button style={S.confirmBtn} onClick={() => { onEnableP2P?.(); onConfirm(); }}>
              {t('p2p.dialog.enable_and_play')}
            </button>
          ) : (
            <button style={S.confirmBtn} onClick={onConfirm}>
              {t('p2p.dialog.understood')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 99998,
    background: 'rgba(0,0,0,0.72)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    backdropFilter: 'blur(4px)',
  },
  dialog: {
    background: '#18191f', border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: 12, padding: '28px 28px 24px', maxWidth: 400, width: '90%',
    fontFamily: FONT,
  },
  title: {
    margin: '0 0 12px', fontSize: 16, fontWeight: 600, color: '#fff',
  },
  body: {
    margin: '0 0 24px', fontSize: 13, color: 'rgba(255,255,255,0.55)',
    lineHeight: 1.6,
  },
  actions: {
    display: 'flex', gap: 10, justifyContent: 'flex-end',
  },
  cancelBtn: {
    padding: '9px 18px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)',
    background: 'transparent', color: 'rgba(255,255,255,0.60)',
    fontSize: 13, fontFamily: FONT, cursor: 'pointer',
  },
  confirmBtn: {
    padding: '9px 18px', borderRadius: 8, border: 'none',
    background: '#fff', color: '#000',
    fontSize: 13, fontWeight: 600, fontFamily: FONT, cursor: 'pointer',
  },
};

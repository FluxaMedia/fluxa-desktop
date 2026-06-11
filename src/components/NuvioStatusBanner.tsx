import React from 'react';
import { X } from 'lucide-react';
import { t } from '../i18n';

interface Props {
  serverDown: boolean;
  justRecovered: boolean;
  dismissed: boolean;
  onDismiss: () => void;
}

export function NuvioStatusBanner({ serverDown, justRecovered, dismissed, onDismiss }: Props) {
  const visible = (serverDown && !dismissed) || justRecovered;
  if (!visible) return null;

  const isGreen = justRecovered && !serverDown;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 99999,
      height: 36,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      background: isGreen ? 'rgba(22, 163, 74, 0.94)' : 'rgba(185, 28, 28, 0.94)',
      backdropFilter: 'blur(8px)',
      transition: 'background 0.3s',
      padding: '0 16px',
    }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: '#fff', letterSpacing: '0.01em' }}>
        {isGreen ? t('nuvio.status.online') : t('nuvio.status.offline')}
      </span>
      {!isGreen && (
        <button
          onClick={onDismiss}
          style={{
            position: 'absolute',
            right: 12,
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,0.7)',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
          }}
          aria-label={t('common.close')}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

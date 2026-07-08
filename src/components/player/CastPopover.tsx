import { Cast, Check, Tv } from 'lucide-react';
import { t } from '../../i18n';
import type { CastDevice } from '../../core/cast';

interface CastPopoverProps {
  devices: CastDevice[];
  discovering: boolean;
  activeDeviceId: string | null;
  showEpisodePanel: boolean;
  onSelectDevice: (device: CastDevice) => void;
  onDisconnect: () => void;
}

export function CastPopover({ devices, discovering, activeDeviceId, showEpisodePanel, onSelectDevice, onDisconnect }: CastPopoverProps) {
  return (
    <div
      className="player-popover"
      style={{ position: 'absolute', bottom: '5.75rem', right: showEpisodePanel ? 396 : 14, background: 'rgba(18,22,30,0.97)', backdropFilter: 'blur(1rem)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '0.625rem', padding: '0.375rem 0', minWidth: '13.75rem', maxHeight: '18.75rem', overflowY: 'auto', zIndex: 10, boxShadow: '0 0.5rem 2rem rgba(0,0,0,0.6)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.05rem', padding: '0.25rem 0.875rem 0.5rem', textTransform: 'uppercase' }}>
        {t('player.cast')}
      </div>
      {activeDeviceId && (
        <button
          className="player-popover-row"
          onClick={onDisconnect}
          style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', width: '100%', background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.07)', color: '#fff', fontSize: '0.8125rem', fontWeight: 600, padding: '0.5rem 0.875rem', cursor: 'pointer', textAlign: 'left', marginBottom: '0.25rem' }}
        >
          {t('player.stop_casting')}
        </button>
      )}
      {discovering && (
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8125rem', padding: '0.5rem 0.875rem' }}>{t('player.cast_searching')}</div>
      )}
      {!discovering && devices.length === 0 && (
        <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.8125rem', padding: '0.5rem 0.875rem' }}>{t('player.cast_no_devices')}</div>
      )}
      {devices.map((device) => (
        <button
          key={device.id}
          className="player-popover-row"
          onClick={() => onSelectDevice(device)}
          style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', width: '100%', background: 'none', border: 'none', color: activeDeviceId === device.id ? '#fff' : 'rgba(255,255,255,0.7)', fontSize: '0.8125rem', fontWeight: activeDeviceId === device.id ? 600 : 400, padding: '0.5rem 0.875rem', cursor: 'pointer', textAlign: 'left' }}
        >
          <span style={{ width: '0.875rem', flexShrink: 0, color: 'var(--primary-accent-color)' }}>
            {activeDeviceId === device.id ? <Check size={14} /> : device.kind === 'chromecast' ? <Cast size={14} /> : <Tv size={14} />}
          </span>
          {device.name}
        </button>
      ))}
    </div>
  );
}

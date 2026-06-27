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
      style={{ position: 'absolute', bottom: 92, right: showEpisodePanel ? 396 : 14, background: 'rgba(18,22,30,0.97)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '6px 0', minWidth: 220, maxHeight: 300, overflowY: 'auto', zIndex: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 700, letterSpacing: 0.8, padding: '4px 14px 8px', textTransform: 'uppercase' }}>
        {t('player.cast')}
      </div>
      {activeDeviceId && (
        <button
          onClick={onDisconnect}
          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.07)', color: '#fff', fontSize: 13, fontWeight: 600, padding: '8px 14px', cursor: 'pointer', textAlign: 'left', marginBottom: 4 }}
        >
          {t('player.stop_casting')}
        </button>
      )}
      {discovering && (
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, padding: '8px 14px' }}>{t('player.cast_searching')}</div>
      )}
      {!discovering && devices.length === 0 && (
        <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, padding: '8px 14px' }}>{t('player.cast_no_devices')}</div>
      )}
      {devices.map((device) => (
        <button
          key={device.id}
          onClick={() => onSelectDevice(device)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', color: activeDeviceId === device.id ? '#fff' : 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: activeDeviceId === device.id ? 600 : 400, padding: '8px 14px', cursor: 'pointer', textAlign: 'left' }}
        >
          <span style={{ width: 14, color: 'var(--primary-accent-color)' }}>
            {activeDeviceId === device.id ? <Check size={14} /> : device.kind === 'chromecast' ? <Cast size={14} /> : <Tv size={14} />}
          </span>
          {device.name}
        </button>
      ))}
    </div>
  );
}

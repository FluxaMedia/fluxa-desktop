import { type RefObject } from 'react';
import { t } from '../../i18n';
import { Popover } from '../ui/Popover';

interface PlayerSettingsPopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  anime4kEnabled: boolean;
  onToggleAnime4k: (enabled: boolean) => void;
}

export function PlayerSettingsPopover({ anchorRef, onClose, anime4kEnabled, onToggleAnime4k }: PlayerSettingsPopoverProps) {
  return (
    <Popover open onClose={onClose} anchorRef={anchorRef} placement="top" width="15rem">
      <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.05rem', padding: '0.25rem 0.875rem 0.5rem', textTransform: 'uppercase' }}>
        {t('player.settings')}
      </div>
      <div
        onClick={() => onToggleAnime4k(!anime4kEnabled)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', padding: '0.5rem 0.875rem', cursor: 'pointer' }}
      >
        <span style={{ color: '#fff', fontSize: '0.8125rem' }}>{t('player.anime4k')}</span>
        <div
          style={{ flexShrink: 0, width: '2.75rem', height: '1.625rem', borderRadius: '62.4375rem', background: anime4kEnabled ? 'var(--primary-accent-color)' : 'rgba(255,255,255,0.14)', position: 'relative', transition: 'background 0.18s' }}
        >
          <div style={{ position: 'absolute', top: '0.1875rem', left: anime4kEnabled ? 21 : 3, width: '1.25rem', height: '1.25rem', borderRadius: '50%', background: anime4kEnabled ? '#000000' : 'rgba(255,255,255,0.80)', transition: 'left 0.18s' }} />
        </div>
      </div>
    </Popover>
  );
}

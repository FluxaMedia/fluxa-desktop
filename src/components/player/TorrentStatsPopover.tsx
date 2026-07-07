import { t } from '../../i18n';
import type { TorrentStats } from '../../core/mpvPlayer';

interface TorrentStatsPopoverProps {
  stats: TorrentStats | null;
  showEpisodePanel: boolean;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
  return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, fontSize: 13 }}>
      <span style={{ color: 'rgba(255,255,255,0.55)' }}>{label}</span>
      <span style={{ color: '#fff', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

export function TorrentStatsPopover({ stats, showEpisodePanel }: TorrentStatsPopoverProps) {
  return (
    <div
      className="player-popover"
      style={{ position: 'absolute', bottom: 92, right: showEpisodePanel ? 396 : 14, background: 'rgba(18,22,30,0.97)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '12px 16px', minWidth: 240, zIndex: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 700, letterSpacing: 0.8, marginBottom: 10, textTransform: 'uppercase' }}>
        {t('player.torrent_stats_title')}
      </div>
      {!stats ? (
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>{t('player.status_starting_torrent')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Row label={t('player.torrent_seeders')} value={`${stats.active_peers} / ${stats.total_peers}`} />
          <Row label={t('player.torrent_download_speed')} value={formatSpeed(stats.download_speed)} />
          <Row label={t('player.torrent_buffered')} value={`${stats.preload}%`} />
          <Row label={t('player.torrent_progress')} value={`${stats.progress}%`} />
        </div>
      )}
    </div>
  );
}

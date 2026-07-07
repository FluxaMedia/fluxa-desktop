import { useState } from 'react';
import { emit } from '@tauri-apps/api/event';
import { ChevronDown } from 'lucide-react';
import { t } from '../../i18n';

export type EpisodeInfo = {
  id: string;
  name?: string;
  title?: string;
  season?: number;
  episode?: number;
  number?: number;
  thumbnail?: string;
  overview?: string;
};

export function epLabel(ep: EpisodeInfo): string {
  const s = ep.season != null ? `S${ep.season}` : '';
  const e = (ep.episode ?? ep.number) != null ? `E${ep.episode ?? ep.number}` : '';
  const se = s || e ? `${s}${e} — ` : '';
  return se + (ep.name ?? ep.title ?? '');
}

function epKey(ep: EpisodeInfo): string {
  return `${ep.season ?? 1}:${ep.episode ?? ep.number ?? 0}`;
}

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#fff', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 44, height: 44, borderRadius: 8, padding: 0, flexShrink: 0,
};

interface EpisodePanelProps {
  episodes: EpisodeInfo[];
  currentEpisode: EpisodeInfo | null;
  onClose: () => void;
}

export function EpisodePanel({ episodes, currentEpisode, onClose }: EpisodePanelProps) {
  const seasonGroups = episodes.reduce<Record<number, EpisodeInfo[]>>((acc, ep) => {
    const s = ep.season ?? 1;
    if (!acc[s]) acc[s] = [];
    acc[s].push(ep);
    return acc;
  }, {});
  const seasons = Object.keys(seasonGroups).map(Number).sort((a, b) => a - b);

  const currentEpisodeKey = currentEpisode ? epKey(currentEpisode) : null;

  const [activeSeason, setActiveSeason] = useState(() => currentEpisode?.season ?? seasons[0] ?? 1);
  const [showSeasonDropdown, setShowSeasonDropdown] = useState(false);

  return (
    <div
      style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 380, background: 'rgba(10,12,18,0.97)', backdropFilter: 'blur(20px)', borderLeft: '1px solid rgba(255,255,255,0.08)', zIndex: 6, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ padding: '16px 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{t('player.episodes')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {seasons.length > 1 && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowSeasonDropdown((p) => !p)}
                style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                {t('player.season_n', activeSeason)}
                <ChevronDown size={12} />
              </button>
              {showSeasonDropdown && (
                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, background: '#12161e', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, overflow: 'hidden', zIndex: 20, minWidth: 120, boxShadow: '0 8px 24px rgba(0,0,0,0.7)' }}>
                  {seasons.map((s) => (
                    <button
                      key={s}
                      onClick={() => { setActiveSeason(s); setShowSeasonDropdown(false); }}
                      style={{ display: 'block', width: '100%', background: s === activeSeason ? 'rgba(255,255,255,0.08)' : 'none', border: 'none', color: s === activeSeason ? '#fff' : 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: s === activeSeason ? 700 : 400, padding: '8px 12px', cursor: 'pointer', textAlign: 'left' }}
                    >
                      {t('player.season_n', s)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            onClick={onClose}
            style={{ ...iconBtn, width: 32, height: 32, opacity: 0.6 }}
          >
            ✕
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0 8px' }}>
        {(seasonGroups[activeSeason] ?? []).map((ep) => {
          const isCurrent = currentEpisodeKey === epKey(ep);
          return (
            <button
              key={ep.id}
              onClick={() => { void emit('native-player-play-episode', ep.id); onClose(); }}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%', background: isCurrent ? 'rgba(255,255,255,0.06)' : 'none', border: 'none', borderLeft: isCurrent ? '2px solid #fff' : '2px solid transparent', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#fff', padding: '12px 16px', cursor: 'pointer', textAlign: 'left' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = isCurrent ? 'rgba(255,255,255,0.06)' : 'none')}
            >
              <div style={{ flexShrink: 0, width: 142, height: 80, borderRadius: 6, overflow: 'hidden', background: '#1a1e28' }}>
                {ep.thumbnail
                  ? <img src={ep.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  : <div style={{ width: '100%', height: '100%', background: 'rgba(255,255,255,0.05)' }} />
                }
              </div>
              <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: isCurrent ? '#fff' : 'rgba(255,255,255,0.92)', lineHeight: 1.3, marginBottom: 5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {epLabel(ep)}{isCurrent ? ` · ${t('player.now_playing')}` : ''}
                </div>
                {ep.overview && (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.42)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {ep.overview}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

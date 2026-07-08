import { useEffect, useState, type CSSProperties } from 'react';
import { Check, ChevronLeft, Settings } from 'lucide-react';
import { t } from '../../i18n';
import type { PlayerTrackOption } from '../../core/mpvPlayer';

const SUBTITLE_FONTS = ['default', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'Comic Sans MS'];
const SUBTITLE_SIZES = [75, 100, 125, 150, 200];
const SUBTITLE_COLORS: { value: string; labelKey: string }[] = [
  { value: '#FFFFFF', labelKey: 'auto.white' },
  { value: '#FFE45C', labelKey: 'auto.yellow' },
  { value: '#FF5D5D', labelKey: 'auto.red' },
  { value: '#3F7CFF', labelKey: 'auto.blue' },
  { value: '#54D17A', labelKey: 'auto.green' },
  { value: '#FF8A3D', labelKey: 'auto.orange' },
];

const LANG_NAMES: Record<string, string> = {
  en: 'English', eng: 'English',
  tr: 'Turkish', tur: 'Turkish',
  ja: 'Japanese', jpn: 'Japanese',
  ko: 'Korean', kor: 'Korean',
  zh: 'Chinese', chi: 'Chinese', zho: 'Chinese',
  de: 'German', ger: 'German', deu: 'German',
  fr: 'French', fre: 'French', fra: 'French',
  es: 'Spanish', spa: 'Spanish',
  it: 'Italian', ita: 'Italian',
  pt: 'Portuguese', por: 'Portuguese',
  ru: 'Russian', rus: 'Russian',
  ar: 'Arabic', ara: 'Arabic',
  hi: 'Hindi', hin: 'Hindi',
  cs: 'Czech', cze: 'Czech', ces: 'Czech',
  da: 'Danish', dan: 'Danish',
  el: 'Greek', gre: 'Greek', ell: 'Greek',
  et: 'Estonian', est: 'Estonian',
  fi: 'Finnish', fin: 'Finnish',
  nl: 'Dutch', dut: 'Dutch', nld: 'Dutch',
  sv: 'Swedish', swe: 'Swedish',
  no: 'Norwegian', nor: 'Norwegian', nob: 'Norwegian', nno: 'Norwegian',
  pl: 'Polish', pol: 'Polish',
  ro: 'Romanian', rum: 'Romanian', ron: 'Romanian',
  sk: 'Slovak', slo: 'Slovak', slk: 'Slovak',
  sl: 'Slovenian', slv: 'Slovenian',
  hu: 'Hungarian', hun: 'Hungarian',
  uk: 'Ukrainian', ukr: 'Ukrainian',
  vi: 'Vietnamese', vie: 'Vietnamese',
  th: 'Thai', tha: 'Thai',
  id: 'Indonesian', ind: 'Indonesian',
  he: 'Hebrew', heb: 'Hebrew',
  ms: 'Malay', may: 'Malay', msa: 'Malay',
  bg: 'Bulgarian', bul: 'Bulgarian',
  ca: 'Catalan', cat: 'Catalan',
  lv: 'Latvian', lav: 'Latvian',
  lt: 'Lithuanian', lit: 'Lithuanian',
  is: 'Icelandic', ice: 'Icelandic', isl: 'Icelandic',
  fa: 'Persian', per: 'Persian', fas: 'Persian',
  ur: 'Urdu', urd: 'Urdu',
  bn: 'Bengali', ben: 'Bengali',
  ta: 'Tamil', tam: 'Tamil',
  te: 'Telugu', tel: 'Telugu',
  ml: 'Malayalam', mal: 'Malayalam',
  mr: 'Marathi', mar: 'Marathi',
  gu: 'Gujarati', guj: 'Gujarati',
  pa: 'Punjabi', pan: 'Punjabi',
  fil: 'Filipino', tgl: 'Filipino',
  sr: 'Serbian', srp: 'Serbian',
  hr: 'Croatian', hrv: 'Croatian',
  bs: 'Bosnian', bos: 'Bosnian',
  mk: 'Macedonian', mac: 'Macedonian', mkd: 'Macedonian',
  sq: 'Albanian', alb: 'Albanian', sqi: 'Albanian',
  ka: 'Georgian', geo: 'Georgian', kat: 'Georgian',
  hy: 'Armenian', arm: 'Armenian', hye: 'Armenian',
  az: 'Azerbaijani', aze: 'Azerbaijani',
  kk: 'Kazakh', kaz: 'Kazakh',
  uz: 'Uzbek', uzb: 'Uzbek',
  mn: 'Mongolian', mon: 'Mongolian',
  km: 'Khmer', khm: 'Khmer',
  lo: 'Lao', lao: 'Lao',
  my: 'Burmese', bur: 'Burmese', mya: 'Burmese',
  am: 'Amharic', amh: 'Amharic',
  sw: 'Swahili', swa: 'Swahili',
  af: 'Afrikaans', afr: 'Afrikaans',
  gl: 'Galician', glg: 'Galician',
  cy: 'Welsh', wel: 'Welsh', cym: 'Welsh',
};

function langDisplayName(code: string | null): string {
  if (!code) return t('player.unknown_language');
  return LANG_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}

function trackSourceLabel(track: PlayerTrackOption): string {
  if (track.source) return track.source;
  return track.external ? t('player.external_source') : t('player.embedded_source');
}

type TrackGroup = { key: string; label: string; tracks: PlayerTrackOption[] };

function groupTracks(tracks: PlayerTrackOption[]): TrackGroup[] {
  const groups = new Map<string, TrackGroup>();
  for (const track of tracks) {
    const key = track.lang?.toLowerCase() || 'und';
    let group = groups.get(key);
    if (!group) {
      group = { key, label: langDisplayName(track.lang), tracks: [] };
      groups.set(key, group);
    }
    group.tracks.push(track);
  }
  return Array.from(groups.values());
}

const styleBtn: CSSProperties = {
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: '0.375rem',
  color: 'rgba(255,255,255,0.85)',
  fontSize: '0.75rem',
  padding: '0.3125rem 0.5625rem',
  cursor: 'pointer',
};

const rowBtn: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '0.625rem', width: '100%', background: 'none', border: 'none',
  color: 'rgba(255,255,255,0.7)', fontSize: '0.8125rem', padding: '0.5rem 0.875rem', cursor: 'pointer', textAlign: 'left',
};

interface TrackPopoverProps {
  type: 'audio' | 'sub' | 'speed';
  audioTracks: PlayerTrackOption[];
  subTracks: PlayerTrackOption[];
  playbackSpeed: number;
  showEpisodePanel: boolean;
  onSetSpeed: (speed: number) => void;
  onSelectTrack: (type: 'audio' | 'sub', id: string) => void;
  onDisableSubs: () => void;
  subtitleDelay?: number;
  subtitleFont?: string;
  subtitleSize?: number;
  subtitleColor?: string;
  onAdjustSubtitleDelay?: (delta: number) => void;
  onResetSubtitleDelay?: () => void;
  onChooseSubtitleFont?: (font: string) => void;
  onChooseSubtitleSize?: (size: number) => void;
  onChooseSubtitleColor?: (color: string) => void;
}

export function TrackPopover({
  type, audioTracks, subTracks, playbackSpeed, showEpisodePanel,
  onSetSpeed, onSelectTrack, onDisableSubs,
  subtitleDelay = 0, subtitleFont = 'default', subtitleSize = 100, subtitleColor = '#FFFFFF',
  onAdjustSubtitleDelay, onResetSubtitleDelay, onChooseSubtitleFont, onChooseSubtitleSize, onChooseSubtitleColor,
}: TrackPopoverProps) {
  const [showStyle, setShowStyle] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  useEffect(() => { setShowStyle(false); setOpenGroup(null); }, [type]);

  const tracks = type === 'audio' ? audioTracks : subTracks;
  const noSubSelected = !subTracks.some((tr) => tr.selected);
  const groups = groupTracks(tracks);
  const activeGroup = groups.find((g) => g.key === openGroup) ?? null;

  const selectFromGroup = (group: TrackGroup, track: PlayerTrackOption) => {
    onSelectTrack(type as 'audio' | 'sub', track.id);
  };

  const openOrSelectGroup = (group: TrackGroup) => {
    if (group.tracks.length === 1) {
      selectFromGroup(group, group.tracks[0]);
    } else {
      setOpenGroup(group.key);
    }
  };

  return (
    <div
      className="player-popover"
      style={{ position: 'absolute', bottom: '5.75rem', right: showEpisodePanel ? 396 : 14, background: 'rgba(18,22,30,0.97)', backdropFilter: 'blur(1rem)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '0.625rem', padding: '0.375rem 0', width: type === 'speed' ? 150 : 260, maxHeight: '22.5rem', overflowY: 'auto', zIndex: 10, boxShadow: '0 0.5rem 2rem rgba(0,0,0,0.6)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', justifyContent: 'space-between', padding: '0.25rem 0.875rem 0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', minWidth: 0 }}>
          {activeGroup && !showStyle && (
            <button
              className="player-popover-icon"
              onClick={() => setOpenGroup(null)}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', padding: '0.1875rem', display: 'flex' }}
              title={t('player.back')}
            >
              <ChevronLeft size={14} />
            </button>
          )}
          <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.05rem', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {showStyle
              ? t('player.subtitle_settings')
              : activeGroup
                ? activeGroup.label
                : type === 'audio' ? t('player.audio_title') : type === 'sub' ? t('player.subtitles_title') : t('player.speed_title')}
          </span>
        </div>
        {type === 'sub' && !activeGroup && (
          <button
            className="player-popover-icon"
            onClick={() => setShowStyle((v) => !v)}
            style={{ background: 'none', border: 'none', color: showStyle ? 'var(--primary-accent-color)' : 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: '0.1875rem', display: 'flex', flexShrink: 0 }}
            title={t('player.subtitle_settings')}
          >
            <Settings size={14} />
          </button>
        )}
      </div>
      {type === 'sub' && showStyle ? (
        <div style={{ padding: '0 0.875rem 0.625rem' }}>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.6875rem', marginBottom: '0.375rem' }}>{t('player.subtitle_delay')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <button className="player-popover-chip" onClick={() => onAdjustSubtitleDelay?.(-0.1)} style={styleBtn}>−0.1s</button>
            <span style={{ color: '#fff', fontSize: '0.8125rem', minWidth: '3.25rem', textAlign: 'center' }}>{subtitleDelay > 0 ? '+' : ''}{subtitleDelay.toFixed(1)}s</span>
            <button className="player-popover-chip" onClick={() => onAdjustSubtitleDelay?.(0.1)} style={styleBtn}>+0.1s</button>
            <button className="player-popover-chip" onClick={() => onResetSubtitleDelay?.()} style={{ ...styleBtn, marginLeft: 'auto' }}>{t('player.subtitle_reset')}</button>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.6875rem', marginBottom: '0.375rem' }}>{t('player.subtitle_font')}</div>
          <select
            className="player-popover-select"
            value={subtitleFont}
            onChange={(e) => onChooseSubtitleFont?.(e.target.value)}
            style={{ width: '100%', marginBottom: '0.75rem', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '0.375rem', color: '#fff', fontSize: '0.8125rem', padding: '0.4375rem 0.5rem' }}
          >
            {SUBTITLE_FONTS.map((font) => (
              <option key={font} value={font} style={{ background: '#171b24', fontFamily: font === 'default' ? undefined : font }}>
                {font === 'default' ? t('settings.subtitle_font_default') : font}
              </option>
            ))}
          </select>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.6875rem', marginBottom: '0.375rem' }}>{t('player.subtitle_size')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '0.75rem' }}>
            {SUBTITLE_SIZES.map((size) => (
              <button
                key={size}
                className="player-popover-chip"
                onClick={() => onChooseSubtitleSize?.(size)}
                style={{ ...styleBtn, background: subtitleSize === size ? 'rgba(255,255,255,0.16)' : styleBtn.background }}
              >
                {size}%
              </button>
            ))}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.6875rem', marginBottom: '0.375rem' }}>{t('player.subtitle_color')}</div>
          <select
            className="player-popover-select"
            value={subtitleColor}
            onChange={(e) => onChooseSubtitleColor?.(e.target.value)}
            style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '0.375rem', color: '#fff', fontSize: '0.8125rem', padding: '0.4375rem 0.5rem' }}
          >
            {SUBTITLE_COLORS.map((color) => (
              <option key={color.value} value={color.value} style={{ background: '#171b24' }}>
                {t(color.labelKey)}
              </option>
            ))}
          </select>
        </div>
      ) : type === 'speed' ? (
        [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0].map((s) => (
          <button
            key={s}
            className="player-popover-row"
            onClick={() => onSetSpeed(s)}
            style={{ ...rowBtn, color: playbackSpeed === s ? '#fff' : rowBtn.color, fontWeight: playbackSpeed === s ? 700 : 400 }}
          >
            <span style={{ width: '0.875rem', color: 'var(--primary-accent-color)' }}>{playbackSpeed === s && <Check size={14} />}</span>
            {s === 1.0 ? t('player.normal') : `${s}×`}
          </button>
        ))
      ) : activeGroup ? (
        activeGroup.tracks.map((track) => (
          <button
            key={track.id}
            className="player-popover-row"
            onClick={() => selectFromGroup(activeGroup, track)}
            style={{ ...rowBtn, color: track.selected ? '#fff' : rowBtn.color, fontWeight: track.selected ? 600 : 400, justifyContent: 'space-between' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', minWidth: 0 }}>
              <span style={{ width: '0.875rem', flexShrink: 0, color: 'var(--primary-accent-color)' }}>{track.selected && <Check size={14} />}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trackSourceLabel(track)}</span>
            </span>
            {track.format && (
              <span style={{ flexShrink: 0, fontSize: '0.6875rem', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '0.25rem', padding: '1px 0.375rem' }}>
                {track.format}
              </span>
            )}
          </button>
        ))
      ) : (
        <>
          {type === 'sub' && (
            <button
              className="player-popover-row"
              onClick={onDisableSubs}
              style={{ ...rowBtn, borderBottom: '1px solid rgba(255,255,255,0.07)', color: noSubSelected ? '#fff' : rowBtn.color, fontWeight: noSubSelected ? 600 : 400, marginBottom: '0.25rem' }}
            >
              <span style={{ width: '0.875rem', color: 'var(--primary-accent-color)' }}>
                {noSubSelected && <Check size={14} />}
              </span>
              {t('player.subtitles_off')}
            </button>
          )}
          {groups.map((group) => {
            const groupSelected = group.tracks.some((tr) => tr.selected);
            return (
              <button
                key={group.key}
                className="player-popover-row"
                onClick={() => openOrSelectGroup(group)}
                style={{ ...rowBtn, color: groupSelected ? '#fff' : rowBtn.color, fontWeight: groupSelected ? 600 : 400, justifyContent: 'space-between' }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                  <span style={{ width: '0.875rem', color: 'var(--primary-accent-color)' }}>{groupSelected && <Check size={14} />}</span>
                  {group.label}
                </span>
                {group.tracks.length > 1 && (
                  <span style={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.35)' }}>{group.tracks.length}</span>
                )}
              </button>
            );
          })}
          {groups.length === 0 && (
            <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.8125rem', padding: '0.5rem 0.875rem' }}>{t('player.no_tracks_available')}</div>
          )}
        </>
      )}
    </div>
  );
}

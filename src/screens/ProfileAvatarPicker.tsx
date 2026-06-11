import React, { useEffect } from 'react';
import { Check, Upload, X } from 'lucide-react';
import { t } from '../i18n';

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Ubuntu", "Noto Sans", sans-serif';

export const AVATAR_CATEGORIES = [
  {
    name: 'The Boys',
    key: 'TheBoys',
    avatars: ['a-train', 'billybutcher', 'blacknoir', 'homelander', 'queenmaeve', 'starlight', 'stormfront', 'thedeep'],
  },
  {
    name: 'Breaking Bad',
    key: 'BreakingBad',
    avatars: ['jessepinkman', 'saulgoodman', 'walterwhite'],
  },
  {
    name: 'Peaky Blinders',
    key: 'PeakyBlinders',
    avatars: ['arthurshelby', 'finnshelby', 'johnshelby', 'thomasshelby'],
  },
  {
    name: 'Invincible',
    key: 'Invincible',
    avatars: ['allenthealien', 'atomeve', 'cecilsteadman', 'debbiegrayson', 'invincible', 'olivergrayson', 'omniman'],
  },
  {
    name: 'Avatar: The Last Airbender',
    key: 'ATLA',
    avatars: ['avataraang', 'azula', 'iroh', 'katara', 'sokka', 'tophbeifong', 'zuko'],
  },
];

export function avatarCategoryUrl(categoryKey: string, avatar: string) {
  return `/avatars/${categoryKey}/${avatar}.jpg`;
}

export function AvatarPickerModal({
  selected,
  onSelect,
  onUpload,
  onClear,
  onClose,
}: {
  selected: string | undefined;
  onSelect: (url: string) => void;
  onUpload: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.header}>
          <div>
            <p style={S.title}>{t('profiles.choose_image')}</p>
            <p style={S.subtitle}>{t('profiles.choose_image_desc')}</p>
          </div>
          <div style={S.headerActions}>
            {selected && (
              <button onClick={onClear} style={S.clearBtn}>
                {t('common.remove')}
              </button>
            )}
            <button onClick={onUpload} style={S.uploadBtn}>
              <Upload size={14} />
              {t('profiles.upload_image')}
            </button>
            <button onClick={onClose} style={S.closeBtn} aria-label={t('common.close')}>
              <X size={17} />
            </button>
          </div>
        </div>

        <div style={S.body}>
          {AVATAR_CATEGORIES.map((cat) => (
            <section key={cat.key}>
              <p style={S.categoryLabel}>{cat.name}</p>
              <div style={S.grid}>
                {cat.avatars.map((av) => {
                  const url = avatarCategoryUrl(cat.key, av);
                  const isSelected = selected === url;
                  return (
                    <button
                      key={av}
                      onClick={() => onSelect(url)}
                      style={{
                        ...S.avatarBtn,
                        outline: isSelected ? '2px solid rgba(255,255,255,0.9)' : '2px solid transparent',
                        outlineOffset: 2,
                      }}
                      aria-label={av}
                    >
                      <img src={url} alt={av} style={S.avatarImg} loading="lazy" />
                      {isSelected && (
                        <span style={S.checkBadge}>
                          <Check size={11} strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 10000,
    background: 'rgba(0,0,0,0.80)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  modal: {
    width: 'min(740px, calc(100vw - 48px))',
    maxHeight: 'min(720px, calc(100vh - 48px))',
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.10)',
    background: '#181818',
    boxShadow: '0 24px 80px rgba(0,0,0,0.75)',
    overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
    fontFamily: FONT,
  },
  header: {
    padding: '18px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
    flexShrink: 0,
  },
  title: { margin: 0, color: '#FFFFFF', fontSize: 16, fontWeight: 600, fontFamily: FONT, letterSpacing: '-0.02em' },
  subtitle: { margin: '4px 0 0', color: 'rgba(255,255,255,0.38)', fontSize: 12, fontWeight: 400, fontFamily: FONT },
  headerActions: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  clearBtn: {
    height: 34, borderRadius: 7, border: '1px solid rgba(255,80,80,0.20)',
    background: 'rgba(255,80,80,0.07)', color: 'rgba(255,120,120,0.85)',
    padding: '0 12px', fontSize: 12, fontWeight: 500, fontFamily: FONT, cursor: 'pointer', outline: 'none',
  },
  uploadBtn: {
    height: 34, borderRadius: 7, border: '1px solid rgba(255,255,255,0.10)',
    background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)',
    padding: '0 12px', display: 'flex', alignItems: 'center', gap: 7,
    fontSize: 12, fontWeight: 500, fontFamily: FONT, cursor: 'pointer', outline: 'none',
  },
  closeBtn: {
    width: 34, height: 34, borderRadius: 7,
    border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.05)',
    color: 'rgba(255,255,255,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', outline: 'none', flexShrink: 0,
  },
  body: {
    overflowY: 'auto', padding: '18px 20px 24px',
    display: 'flex', flexDirection: 'column', gap: 22,
    scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.10) transparent',
  },
  categoryLabel: {
    margin: '0 0 10px', color: 'rgba(255,255,255,0.35)',
    fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: FONT,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
    gap: 8,
  },
  avatarBtn: {
    position: 'relative', aspectRatio: '1 / 1',
    borderRadius: 10, border: 'none',
    background: 'rgba(255,255,255,0.04)',
    padding: 0, overflow: 'hidden',
    cursor: 'pointer', transition: 'opacity 0.12s',
  },
  avatarImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  checkBadge: {
    position: 'absolute', right: 5, bottom: 5,
    width: 20, height: 20, borderRadius: 5,
    background: '#FFFFFF', color: '#000000',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
};

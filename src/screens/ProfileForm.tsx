import React, { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus } from 'lucide-react';
import {
  PROFILE_COLORS,
  createProfileObject,
  saveProfile,
  setActiveProfileId,
} from '../core/profiles';
import { saveAddons } from '../core/libraryOps';
import type { AddonDescriptor, UserProfile } from '../core/types';
import { t } from '../i18n';
import { AvatarPickerModal } from './ProfileAvatarPicker';

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Ubuntu", "Noto Sans", sans-serif';

const CINEMETA_DEFAULT: AddonDescriptor = {
  transportUrl: 'https://v3-cinemeta.strem.io/manifest.json',
  manifest: {
    id: 'com.linvo.cinemeta',
    name: 'Cinemeta',
    description: 'The official add-on for movie and series catalogs',
    version: '3.0.14',
    resources: ['catalog', 'meta'],
    types: ['movie', 'series', 'channel'],
    catalogs: [
      { type: 'movie', id: 'top', name: 'Popular Movies', extra: [{ name: 'genre' }, { name: 'skip' }] },
      { type: 'series', id: 'top', name: 'Popular Series', extra: [{ name: 'genre' }, { name: 'skip' }] },
      { type: 'movie', id: 'imdbRating', name: 'Top Rated Movies', extra: [{ name: 'genre' }, { name: 'skip' }] },
      { type: 'series', id: 'imdbRating', name: 'Top Rated Series', extra: [{ name: 'genre' }, { name: 'skip' }] },
    ],
    logo: 'https://www.strem.io/s/addon-logo/cinemeta.png',
  },
};

const AVATAR_COLORS = ['#E03131', '#1971C2', '#2F9E44', '#E67700', '#7048E8', '#0C8599', '#C2255C', '#5C940D'];

function avatarColor(profile: UserProfile): string {
  let h = 0;
  const seed = profile.id ?? profile.name ?? '';
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function SmileFace({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <circle cx="30" cy="37" r="8.5" fill="white" />
      <circle cx="67" cy="34" r="7.5" fill="white" />
      <path
        d="M 22 62 C 20 54 26 57 30 65 C 42 75 66 68 74 57"
        stroke="white"
        strokeWidth="7.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function AvatarPreview({ profile, size, circular }: { profile: UserProfile; size: number; circular?: boolean }) {
  const color = avatarColor(profile);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: circular ? '50%' : Math.round(size * 0.13),
        background: profile.avatarUrl ? '#111' : color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {profile.avatarUrl ? (
        <img src={profile.avatarUrl} alt={profile.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <SmileFace size={Math.round(size * 0.72)} />
      )}
    </div>
  );
}

export function ProfileForm({
  existing,
  allProfiles,
  onSaved,
  onCancel,
}: {
  existing: UserProfile | null;
  allProfiles: UserProfile[];
  onSaved: (updated: UserProfile[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(existing?.avatarUrl);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => nameInputRef.current?.focus(), 60);
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setAvatarUrl(event.target?.result as string);
      setShowAvatarPicker(false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSave = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const color = existing?.color ?? PROFILE_COLORS[0];
      const base: UserProfile = existing
        ? { ...existing, name: name.trim(), color, avatarUrl }
        : createProfileObject(name, color);
      const profile: UserProfile = { ...base, name: name.trim(), color, avatarUrl };
      const updated = await saveProfile(profile);
      if (!existing) {
        await setActiveProfileId(profile.id);
        try { await saveAddons([CINEMETA_DEFAULT]); } catch {}
      }
      onSaved(updated);
    } finally {
      setBusy(false);
    }
  };

  const duplicateName = Boolean(
    name.trim() &&
    allProfiles.some((p) => p.id !== existing?.id && p.name?.trim().toLowerCase() === name.trim().toLowerCase()),
  );

  const previewProfile: UserProfile = {
    ...(existing ?? createProfileObject(name || 'Profile', PROFILE_COLORS[0])),
    name: name.trim() || t('auto.profile'),
    avatarUrl,
  };

  const canSave = Boolean(name.trim()) && !duplicateName && !busy;

  return (
    <section style={S.formShell}>
      <div style={S.previewPanel}>
        <button style={S.avatarEditButton} onClick={() => setShowAvatarPicker(true)} title={t('profiles.choose_image')}>
          <AvatarPreview profile={previewProfile} size={128} />
          <span style={S.cameraBadge}><Camera size={15} /></span>
        </button>
        <p style={S.previewName}>{name.trim() || t('auto.profile')}</p>
        {avatarUrl && (
          <button style={S.clearImageBtn} onClick={() => setAvatarUrl(undefined)}>
            {t('profiles.use_initials')}
          </button>
        )}
      </div>

      <div style={S.formPanel}>
        <div>
          <label style={S.fieldLabel} htmlFor="profile-name">{t('profiles.name')}</label>
          <input
            id="profile-name"
            ref={nameInputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); if (e.key === 'Escape') onCancel(); }}
            placeholder={t('profiles.name_placeholder')}
            style={S.input}
          />
          {duplicateName && <p style={S.fieldNote}>{t('profiles.duplicate_name')}</p>}
        </div>

        <button style={S.imageButton} onClick={() => setShowAvatarPicker(true)}>
          <ImagePlus size={16} />
          {t('profiles.choose_image')}
        </button>

        <div style={S.actions}>
          <button onClick={onCancel} style={S.btnSecondary}>{t('common.cancel')}</button>
          <button
            onClick={() => void handleSave()}
            disabled={!canSave}
            style={{
              ...S.btnPrimary,
              background: canSave ? '#FFFFFF' : 'rgba(255,255,255,0.10)',
              color: canSave ? '#000000' : 'rgba(255,255,255,0.30)',
              cursor: canSave ? 'pointer' : 'default',
            }}
          >
            {busy ? t('common.saving') : existing ? t('profiles.save') : t('profiles.create')}
          </button>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileUpload} />

      {showAvatarPicker && (
        <AvatarPickerModal
          selected={avatarUrl}
          onSelect={(url) => { setAvatarUrl(url); setShowAvatarPicker(false); }}
          onUpload={() => fileInputRef.current?.click()}
          onClear={() => { setAvatarUrl(undefined); setShowAvatarPicker(false); }}
          onClose={() => setShowAvatarPicker(false)}
        />
      )}
    </section>
  );
}

const S: Record<string, React.CSSProperties> = {
  formShell: { display: 'grid', gridTemplateColumns: 'minmax(220px, 0.75fr) minmax(320px, 1.25fr)', gap: 14, alignItems: 'stretch' },
  previewPanel: { borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: '#141414', padding: '32px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 0 },
  avatarEditButton: { position: 'relative', border: 'none', background: 'transparent', padding: 0, color: '#FFFFFF', cursor: 'pointer', outline: 'none' },
  cameraBadge: { position: 'absolute', right: -8, bottom: -8, width: 32, height: 32, borderRadius: 8, background: '#2C2C2C', border: '2px solid #141414', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.65)' },
  previewName: { margin: '20px 0 0', fontSize: 18, fontWeight: 600, fontFamily: FONT, letterSpacing: '-0.02em', color: '#FFFFFF' },
  clearImageBtn: { marginTop: 10, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.38)', fontSize: 12, fontWeight: 400, fontFamily: FONT, cursor: 'pointer', outline: 'none' },
  formPanel: { borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: '#141414', padding: '22px', display: 'flex', flexDirection: 'column', gap: 14 },
  fieldLabel: { display: 'block', color: 'rgba(255,255,255,0.38)', fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: FONT, marginBottom: 8 },
  input: { width: '100%', height: 44, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: '#FFFFFF', padding: '0 13px', fontSize: 14, fontWeight: 500, fontFamily: FONT, outline: 'none', boxSizing: 'border-box' },
  fieldNote: { margin: '6px 0 0', color: '#FFD280', fontSize: 12, fontWeight: 400, fontFamily: FONT },
  imageButton: { width: '100%', height: 42, borderRadius: 8, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.60)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 13, fontWeight: 500, fontFamily: FONT, cursor: 'pointer', outline: 'none' },
  actions: { marginTop: 'auto', display: 'flex', gap: 8 },
  btnSecondary: { flex: 1, height: 44, borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: 500, fontFamily: FONT, cursor: 'pointer', outline: 'none' },
  btnPrimary: { flex: 1, height: 44, borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, fontFamily: FONT, transition: 'background 0.15s, color 0.15s' },
};

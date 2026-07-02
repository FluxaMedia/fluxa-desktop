import React, { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, UserRound, X } from 'lucide-react';
import { deleteProfile, loadProfiles, profileColor, profileInitials, setActiveProfileId } from '../core/profiles';
import type { UserProfile } from '../core/types';
import { colors } from '../theme';
import { t } from '../i18n';
import { ProfileForm, AvatarPreview } from './ProfileForm';
import { PinPrompt } from '../components/PinPrompt';

interface Props {
  onProfileSelected: (profile: UserProfile) => void;
  onProfilesChanged?: (profiles: UserProfile[]) => void;
}

export function ProfileSelectionScreen({ onProfileSelected, onProfilesChanged }: Props) {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [mode, setMode] = useState<'select' | 'create' | 'edit'>('select');
  const [editingProfile, setEditingProfile] = useState<UserProfile | null>(null);
  const [pinProfile, setPinProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    loadProfiles().then(setProfiles);
  }, []);

  const handleSelect = async (profile: UserProfile) => {
    if (profile.pinHash) { setPinProfile(profile); return; }
    await setActiveProfileId(profile.id);
    onProfileSelected(profile);
  };

  const handleDelete = async (id: string) => {
    const updated = await deleteProfile(id);
    setProfiles(updated);
    onProfilesChanged?.(updated);
  };

  const handleSaved = (updated: UserProfile[]) => {
    setProfiles(updated);
    onProfilesChanged?.(updated);
    setMode('select');
    setEditingProfile(null);
  };

  const handleEdit = (profile: UserProfile) => {
    setEditingProfile(profile);
    setMode('edit');
  };

  const showForm = mode === 'create' || mode === 'edit';

  return (
    <div style={S.root}>
      <div style={S.topBar}>
        <div>
          <p style={S.logo}>fluxa</p>
          <p style={S.kicker}>{t('app.desktop')}</p>
        </div>
        {showForm && (
          <button style={S.closeButton} onClick={() => { setMode('select'); setEditingProfile(null); }} aria-label={t('common.close')}>
            <X size={20} />
          </button>
        )}
      </div>

      <main style={showForm ? S.main : S.mainSelect}>
        {showForm ? (
          <section style={S.hero}>
            <p style={S.eyebrow}>{t('profiles.settings')}</p>
            <h1 style={S.title}>{editingProfile ? t('profiles.edit') : t('profiles.create_new')}</h1>
            <p style={S.subtitle}>{t('profiles.form_subtitle')}</p>
          </section>
        ) : (
          <h1 style={S.selectTitle}>{t('profiles.who_watching')}</h1>
        )}

        {mode === 'select' && (
          <section style={S.profileGrid} aria-label={t('profiles.list')}>
            {profiles.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                onSelect={() => void handleSelect(profile)}
                onDelete={() => void handleDelete(profile.id)}
                onEdit={() => handleEdit(profile)}
              />
            ))}
            <AddProfileCard onClick={() => setMode('create')} />
          </section>
        )}

        {showForm && (
          <ProfileForm
            existing={editingProfile}
            allProfiles={profiles}
            onSaved={handleSaved}
            onCancel={() => { setMode('select'); setEditingProfile(null); }}
          />
        )}
      </main>

      {pinProfile && (
        <PinPrompt
          profile={pinProfile}
          onCancel={() => setPinProfile(null)}
          onSuccess={() => {
            const profile = pinProfile;
            setPinProfile(null);
            void (async () => { await setActiveProfileId(profile.id); onProfileSelected(profile); })();
          }}
        />
      )}
    </div>
  );
}

function ProfileCard({ profile, onSelect, onDelete, onEdit }: {
  profile: UserProfile; onSelect: () => void; onDelete: () => void; onEdit: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <article style={S.profileCard} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button onClick={onSelect} style={S.profileSelectButton}>
        <div style={{ ...S.avatarCircleWrap, opacity: hovered ? 1 : 0.85, transform: hovered ? 'scale(1.04)' : 'scale(1)' }}>
          <AvatarPreview profile={profile} size={130} circular />
        </div>
        <span style={S.profileName}>{profile.name ?? t('auto.profile')}</span>
      </button>
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          style={{ ...S.editPencilBtn, opacity: hovered ? 1 : 0.55 }}
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          title={t('auto.edit')}
          aria-label={t('profiles.edit')}
        >
          <Pencil size={16} />
        </button>
        <button
          style={{ ...S.editPencilBtn, opacity: hovered ? 1 : 0.55, color: 'rgba(255,80,80,0.8)' }}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title={t('profiles.delete')}
          aria-label={t('profiles.delete')}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </article>
  );
}

function AddProfileCard({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div style={S.profileCard}>
      <button
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={S.profileSelectButton}
      >
        <div style={{ ...S.addCircle, background: hovered ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)', transform: hovered ? 'scale(1.04)' : 'scale(1)' }}>
          <Plus size={36} color="rgba(255,255,255,0.55)" />
        </div>
        <span style={S.addLabel}>{t('profiles.add_profile')}</span>
      </button>
    </div>
  );
}

const FONT = "'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

const S: Record<string, React.CSSProperties> = {
  root: { position: 'fixed', inset: 0, zIndex: 9999, background: '#0C0C0C', color: colors.white, overflow: 'auto', fontFamily: FONT },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 44px', zIndex: 2 },
  logo: { margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: 2, fontFamily: FONT },
  kicker: { margin: '2px 0 0', color: 'rgba(255,255,255,0.28)', fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.09em', fontFamily: FONT },
  main: { minHeight: '100%', width: 'min(1100px, calc(100vw - 56px))', margin: '0 auto', padding: '110px 0 56px' },
  mainSelect: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 40px 60px' },
  selectTitle: { margin: '0 0 52px', fontSize: 38, fontWeight: 700, letterSpacing: '-0.03em', textAlign: 'center', fontFamily: FONT },
  hero: { marginBottom: 32, maxWidth: 600 },
  eyebrow: { color: 'rgba(255,255,255,0.40)', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.09em', margin: '0 0 14px', fontFamily: FONT },
  title: { margin: 0, fontSize: 40, lineHeight: 1.05, fontWeight: 700, letterSpacing: '-0.03em', fontFamily: FONT },
  subtitle: { margin: '12px 0 0', color: 'rgba(255,255,255,0.45)', fontSize: 14, lineHeight: 1.65, maxWidth: 520, fontFamily: FONT },
  profileGrid: { display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 40, alignItems: 'flex-start', justifyContent: 'center' },
  profileCard: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, background: 'transparent', border: 'none' },
  profileSelectButton: { width: 'auto', border: 'none', background: 'transparent', color: colors.white, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', cursor: 'pointer', padding: 0, outline: 'none' },
  avatarCircleWrap: { borderRadius: '50%', overflow: 'hidden', transition: 'opacity 0.15s, transform 0.15s', width: 130, height: 130, flexShrink: 0 },
  profileName: { marginTop: 14, maxWidth: 140, color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: FONT },
  editPencilBtn: { marginTop: 8, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.45)', cursor: 'pointer', padding: '4px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'opacity 0.15s', outline: 'none' },
  addCircle: { width: 130, height: 130, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s, transform 0.15s', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.10)' },
  addLabel: { marginTop: 14, color: 'rgba(255,255,255,0.35)', fontSize: 14, fontWeight: 500, fontFamily: FONT },
  emptyState: { gridColumn: '1 / -1', height: 60, borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontSize: 13, fontFamily: FONT },
  closeButton: { width: 36, height: 36, borderRadius: 8, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', outline: 'none' },
};

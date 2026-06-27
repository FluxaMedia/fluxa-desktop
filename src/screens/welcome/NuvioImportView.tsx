import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { t } from '../../i18n';
import {
  nuvioPullProfiles,
  nuvioListAvatars,
} from '../../core/nuvioApi';
import { loadProfiles, saveProfiles, setActiveProfileId } from '../../core/profiles';
import { buildLocalNuvioProfiles, importNuvioProfileData, type NuvioImportStep } from '../../core/nuvioSync';
import type { UserProfile } from '../../core/types';
import { S, FONT } from './styles';

interface ImportProgress {
  profile: boolean;
  addons: boolean;
  library: boolean;
  progress: boolean;
  history: boolean;
  collections: boolean;
  settings: boolean;
}

interface NuvioImportViewProps {
  profile: UserProfile;
  onDone: (profile: UserProfile) => void;
}

export function NuvioImportView({ profile, onDone }: NuvioImportViewProps) {
  const [imp, setImp] = useState<ImportProgress>({
    profile: false, addons: false, library: false,
    progress: false, history: false, collections: false, settings: false,
  });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    void runImport();
  }, []);

  const mark = (key: keyof ImportProgress, ok = true, message?: string) => {
    if (ok) setImp((prev) => ({ ...prev, [key]: true }));
    else if (message) setError((prev) => prev || message);
  };

  const runImport = async () => {
    const token = profile.nuvioAccessToken!;
    const profileIdx = profile.nuvioProfileIndex ?? 1;

    try {
      const [nuvioProfiles, avatarCatalog, existingProfiles] = await Promise.all([
        nuvioPullProfiles(token),
        nuvioListAvatars(),
        loadProfiles(),
      ]);
      const localProfiles = buildLocalNuvioProfiles(profile, nuvioProfiles, avatarCatalog, existingProfiles);
      await saveProfiles(localProfiles);
      const selectedProfile = localProfiles.find((p) => p.nuvioUserId === profile.nuvioUserId && p.nuvioProfileIndex === profileIdx)
        ?? localProfiles.find((p) => p.nuvioUserId === profile.nuvioUserId)
        ?? profile;
      await setActiveProfileId(selectedProfile.id);
      mark('profile');

      const report = await importNuvioProfileData(selectedProfile, (step: NuvioImportStep, ok, message) => {
        mark(step as keyof ImportProgress, ok, message);
      });
      const finalProfiles = await loadProfiles();
      const finalProfile = finalProfiles.find((p) => p.id === selectedProfile.id) ?? selectedProfile;
      const failed = Object.keys(report.errors);
      if (failed.length > 0) {
        setError(`Nuvio import incomplete: ${failed.join(', ')}`);
      }

      setDone(true);
      setTimeout(() => onDone(finalProfile), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.error.network'));
    }
  };

  const steps: Array<{ key: keyof ImportProgress; label: string }> = [
    { key: 'profile', label: t('auth.nuvio.import.profile') },
    { key: 'addons', label: t('auth.nuvio.import.addons') },
    { key: 'library', label: t('auth.nuvio.import.library') },
    { key: 'progress', label: t('auth.nuvio.import.progress') },
    { key: 'history', label: t('auth.nuvio.import.history') },
    { key: 'collections', label: t('auth.nuvio.import.collections') },
    { key: 'settings', label: t('nav.settings') },
  ];

  return (
    <div style={S.root}>
      <div style={S.topBar}>
        <div>
          <p style={S.logo}>fluxa</p>
          <p style={S.kicker}>{t('app.desktop')}</p>
        </div>
      </div>

      <main style={S.authMain}>
        <div style={{ ...S.card, maxWidth: 360 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
            <img
              src="https://nuvio.tv//assets/Logo_1080x1080.png"
              alt="Nuvio"
              style={{ width: 32, height: 32, objectFit: 'contain' }}
            />
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, fontFamily: FONT }}>
              {done ? t('auth.nuvio.import.done') : t('auth.nuvio.import.title')}
            </p>
          </div>

          {error && <p style={S.globalError}>{error}</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {steps.map(({ key, label }) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  background: imp[key] ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.08)',
                  border: imp[key] ? 'none' : '1px solid rgba(255,255,255,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.3s',
                }}>
                  {imp[key] && <Check size={11} color="#000" strokeWidth={3} />}
                </div>
                <span style={{
                  fontSize: 13, fontFamily: FONT,
                  color: imp[key] ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.30)',
                  transition: 'color 0.3s',
                }}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

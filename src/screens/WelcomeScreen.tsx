import { useState } from 'react';
import { t } from '../i18n';
import type { UserProfile } from '../core/types';
import { AuthView } from './welcome/AuthView';
import { NuvioLoginView } from './welcome/NuvioLoginView';
import { NuvioImportView } from './welcome/NuvioImportView';
import { ProfileSetupView } from './welcome/ProfileSetupView';
import { S } from './welcome/styles';

interface Props {
  onGetStarted: () => void;
  onContinueLocal: () => Promise<void>;
  onNuvioLogin: (profile: UserProfile) => void;
}

type View = 'welcome' | 'auth' | 'nuvio' | 'nuvio-import' | 'profile-setup';
type AuthTab = 'login' | 'signup';

export function WelcomeScreen({ onGetStarted, onContinueLocal, onNuvioLogin }: Props) {
  const [view, setView] = useState<View>('welcome');
  const [tab, setTab] = useState<AuthTab>('login');
  const [localLoading, setLocalLoading] = useState(false);
  const [pendingProfile, setPendingProfile] = useState<UserProfile | null>(null);

  const handleContinueLocal = async () => {
    setLocalLoading(true);
    await onContinueLocal();
  };

  if (view === 'auth') {
    return (
      <AuthView
        tab={tab}
        onTabChange={setTab}
        onBack={() => setView('welcome')}
        onSubmit={onGetStarted}
        onNuvioClick={() => setView('nuvio')}
        onContinueLocal={handleContinueLocal}
        localLoading={localLoading}
      />
    );
  }

  if (view === 'nuvio') {
    return (
      <NuvioLoginView
        onBack={() => setView('auth')}
        onImporting={(p) => { setPendingProfile(p); setView('nuvio-import'); }}
        onContinueLocal={handleContinueLocal}
        localLoading={localLoading}
      />
    );
  }

  if (view === 'nuvio-import' && pendingProfile) {
    return (
      <NuvioImportView
        profile={pendingProfile}
        onDone={onNuvioLogin}
      />
    );
  }

  if (view === 'profile-setup') {
    return (
      <ProfileSetupView
        onBack={() => setView('auth')}
        onDone={onGetStarted}
      />
    );
  }

  return (
    <div style={S.root}>
      <div style={S.topBar}>
        <div>
          <p style={S.logo}>fluxa</p>
          <p style={S.kicker}>{t('app.desktop')}</p>
        </div>
      </div>

      <main style={S.main}>
        <section style={S.hero}>
          <h1 style={S.headline}>{t('welcome.headline')}</h1>
          <p style={S.subheadline}>{t('welcome.subheadline')}</p>
        </section>

        <div style={S.actions}>
          <button style={S.primaryBtn} onClick={() => setView('auth')}>
            {t('welcome.get_started')}
          </button>
          <button
            style={{ ...S.secondaryBtn, opacity: localLoading ? 0.4 : 1 }}
            onClick={handleContinueLocal}
            disabled={localLoading}
          >
            {localLoading ? t('welcome.loading') : t('welcome.continue_local')}
          </button>
        </div>

        <p style={S.note}>{t('welcome.local_note')}</p>
      </main>
    </div>
  );
}

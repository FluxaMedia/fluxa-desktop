import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../../i18n';
import { ChoiceTile, ToggleTile, InputTile, SettingsSection } from './SettingsUI';
import type { Prefs } from './settingsTypes';
import { setRpdbApiKey, validateRpdbApiKey } from '../../core/rpdb';

function applyDiscordPresenceConfig(enabled: boolean) {
  void invoke('discord_presence_configure', { enabled });
}

export function GeneralSection({ prefs, setPref }: { prefs: Prefs; setPref: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void }) {
  const [rpdbKeyStatus, setRpdbKeyStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const rpdbCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!prefs.rpdbApiKey) { setRpdbKeyStatus('idle'); return; }
    setRpdbKeyStatus('checking');
    if (rpdbCheckTimer.current) clearTimeout(rpdbCheckTimer.current);
    rpdbCheckTimer.current = setTimeout(() => {
      void validateRpdbApiKey(prefs.rpdbApiKey).then((valid) => setRpdbKeyStatus(valid ? 'valid' : 'invalid'));
    }, 500);
    return () => { if (rpdbCheckTimer.current) clearTimeout(rpdbCheckTimer.current); };
  }, [prefs.rpdbApiKey]);

  return (
    <>
    <SettingsSection title={t('auto.app')} subtitle={t('auto.language_theme_startup')}>
      <ChoiceTile
        title={t('auto.interface_language')}
        subtitle={t('settings.language_desc')}
        options={[{ value: 'en', label: t('language.english') }, { value: 'tr', label: t('language.turkish') }]}
        selected={prefs.language}
        onSelect={(v) => setPref('language', v)}
      />
      <ChoiceTile
        title={t('auto.start_page')}
        subtitle={t('settings.start_page_desc')}
        options={[{ value: 'home', label: t('nav.home') }, { value: 'discover', label: t('nav.discover') }, { value: 'library', label: t('nav.library') }]}
        selected={prefs.startPage}
        onSelect={(v) => setPref('startPage', v)}
      />
      <ToggleTile
        title={t('auto.background_playback')}
        subtitle={t('settings.background_playback_desc')}
        checked={prefs.backgroundPlayback}
        onToggle={(v) => setPref('backgroundPlayback', v)}
      />
      <ToggleTile
        title={t('settings.automatic_updates') || 'Otomatik Güncellemeler'}
        subtitle={t('settings.automatic_updates_desc') || 'Uygulama güncellemelerini otomatik olarak indir'}
        checked={prefs.automaticUpdates}
        onToggle={(v) => setPref('automaticUpdates', v)}
      />
    </SettingsSection>
    <SettingsSection title={t('settings.notifications')} subtitle={t('settings.notifications_desc')}>
      <ToggleTile
        title={t('settings.notifications_master') || 'Bildirimleri Etkinleştir'}
        subtitle={t('settings.notifications_master_desc') || 'Tüm uygulama bildirimlerini aç/kapat'}
        checked={prefs.notificationsEnabled}
        onToggle={(v) => setPref('notificationsEnabled', v)}
      />
    </SettingsSection>
    <SettingsSection title={t('settings.discord_rich_presence')} subtitle={t('settings.discord_rich_presence_desc')}>
      <ToggleTile
        title={t('settings.discord_rich_presence_enable')}
        subtitle={t('settings.discord_rich_presence_enable_desc')}
        checked={prefs.discordRichPresenceEnabled}
        onToggle={(v) => {
          void setPref('discordRichPresenceEnabled', v);
          applyDiscordPresenceConfig(v);
        }}
      />
    </SettingsSection>
    <SettingsSection title={t('settings.integrations')} subtitle={t('settings.integrations_desc')}>
      <InputTile
        title={t('settings.tmdb_api_key')}
        subtitle={t('settings.tmdb_api_key_desc')}
        value={prefs.tmdbApiKey}
        placeholder={t('settings.api_key_placeholder')}
        onChange={(v) => setPref('tmdbApiKey', v)}
      />
      <InputTile
        title={t('settings.rpdb_api_key')}
        subtitle={t('settings.rpdb_api_key_desc')}
        value={prefs.rpdbApiKey}
        placeholder={t('settings.api_key_placeholder')}
        onChange={(v) => {
          void setPref('rpdbApiKey', v);
          setRpdbApiKey(v);
        }}
        status={rpdbKeyStatus !== 'idle' && (
          <p style={{ fontSize: 12, marginTop: 6, color: rpdbKeyStatus === 'invalid' ? 'var(--primary-accent-color)' : 'rgba(255,255,255,0.45)' }}>
            {rpdbKeyStatus === 'checking' ? t('settings.rpdb_key_checking') : rpdbKeyStatus === 'valid' ? t('settings.rpdb_key_valid') : t('settings.rpdb_key_invalid')}
          </p>
        )}
      />
      <InputTile
        title={t('settings.omdb_api_key')}
        subtitle={t('settings.omdb_api_key_desc')}
        value={prefs.omdbApiKey}
        placeholder={t('settings.api_key_placeholder')}
        onChange={(v) => setPref('omdbApiKey', v)}
      />
      <InputTile
        title={t('settings.fanart_api_key')}
        subtitle={t('settings.fanart_api_key_desc')}
        value={prefs.fanartApiKey}
        placeholder={t('settings.api_key_placeholder')}
        onChange={(v) => setPref('fanartApiKey', v)}
      />
    </SettingsSection>
    </>
  );
}

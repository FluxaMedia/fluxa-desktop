import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { storageRead, storageWrite } from '../../core/engine';
import type { UserProfile } from '../../core/types';
import { t } from '../../i18n';
import { isTraktConnected, profileColor, saveProfile } from '../../core/profiles';
import { AvatarPreview } from '../../screens/ProfileForm';
import { syncExternalIntegrationNow } from '../../core/effectRunner';
import { refreshAnimeTrackingProfile } from '../../core/animeExternalSync';
import { SettingsSection, SyncServicePopover, SyncServiceRow } from './SettingsUI';
import type { Prefs, SyncMeta, TraktTokenResponse } from './settingsTypes';

function generateCodeVerifier(): string {
  const array = new Uint8Array(48);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
    .slice(0, 64);
}

interface OAuthCodePayload {
  code: string;
  state: string | null;
}

type OAuthService = 'trakt' | 'anilist' | 'simkl';

export function AccountSection({
  prefs,
  setPref: _setPref,
  activeProfile,
  onProfileUpdated,
  onSwitchProfile,
  onDispatch,
}: {
  prefs: Prefs;
  setPref: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void;
  activeProfile: UserProfile | null;
  onProfileUpdated: (profile: UserProfile) => void;
  onSwitchProfile: () => void;
  onDispatch: (actionJson: string) => void;
}) {
  const [traktBusy, setTraktBusy] = useState(false);
  const [traktError, setTraktError] = useState<string | null>(null);
  const [traktPopoverOpen, setTraktPopoverOpen] = useState(false);
  const [traktSyncMeta, setTraktSyncMeta] = useState<SyncMeta | null>(null);
  const traktStateRef = useRef<string | null>(null);
  const anilistStateRef = useRef<string | null>(null);
  const simklStateRef = useRef<string | null>(null);
  const [anilistBusy, setAnilistBusy] = useState(false);
  const [anilistError, setAnilistError] = useState<string | null>(null);
  const [anilistPopoverOpen, setAnilistPopoverOpen] = useState(false);
  const [anilistSyncMeta, setAnilistSyncMeta] = useState<SyncMeta | null>(null);
  const [simklBusy, setSimklBusy] = useState(false);
  const [simklError, setSimklError] = useState<string | null>(null);
  const [simklPopoverOpen, setSimklPopoverOpen] = useState(false);
  const [simklSyncMeta, setSimklSyncMeta] = useState<SyncMeta | null>(null);
  const [authUrls, setAuthUrls] = useState<Partial<Record<OAuthService, string>>>({});

  useEffect(() => {
    storageRead<SyncMeta>('trakt_sync_meta').then((m) => { if (m) setTraktSyncMeta(m); });
    storageRead<SyncMeta>('anilist_sync_meta').then((m) => { if (m) setAnilistSyncMeta(m); });
    storageRead<SyncMeta>('simkl_sync_meta').then((m) => { if (m) setSimklSyncMeta(m); });
  }, []);

  const traktConnected = isTraktConnected(activeProfile);
  const anilistConnected = Boolean(activeProfile?.anilistAccessToken);
  const simklConnected = Boolean(activeProfile?.simklAccessToken);

  useEffect(() => { if (traktConnected) setTraktBusy(false); }, [traktConnected]);
  useEffect(() => { if (anilistConnected) setAnilistBusy(false); }, [anilistConnected]);
  useEffect(() => { if (simklConnected) setSimklBusy(false); }, [simklConnected]);

  const setAuthUrl = (service: OAuthService, url?: string) => {
    setAuthUrls((current) => ({ ...current, [service]: url }));
  };

  const copyAuthUrl = async (service: OAuthService) => {
    const url = authUrls[service];
    if (!url) return;
    await navigator.clipboard.writeText(url).catch(() => undefined);
  };

  const renderOAuthFallback = (service: OAuthService) => {
    const url = authUrls[service];
    if (!url) return null;
    return (
      <div style={{ padding: '0 18px 10px', borderBottom: '1px solid rgba(255,255,255,0.055)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <p style={{ color: 'rgba(255,255,255,0.44)', fontSize: 12, margin: 0, flex: 1, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Ubuntu", "Noto Sans", sans-serif' }}>
          {t('settings.oauth_waiting_browser')}
        </p>
        <button
          onClick={() => void shellOpen(url)}
          style={{ height: 28, borderRadius: 7, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
        >
          {t('settings.oauth_reopen')}
        </button>
        <button
          onClick={() => void copyAuthUrl(service)}
          style={{ height: 28, borderRadius: 7, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
        >
          {t('settings.oauth_copy_link')}
        </button>
      </div>
    );
  };

  const handleTraktConnect = async () => {
    if (!activeProfile || traktBusy) return;
    setTraktBusy(true);
    setTraktError(null);
    try {
      const traktClientId = await invoke<string>('get_oauth_client_id', { service: 'trakt' });
      const state = generateCodeVerifier();
      traktStateRef.current = state;
      const authUrl = `https://trakt.tv/oauth/authorize?response_type=code&client_id=${traktClientId}&redirect_uri=${encodeURIComponent('fluxa://oauth/trakt')}&state=${state}`;
      setAuthUrl('trakt', authUrl);
      await shellOpen(authUrl);

      const unlisten = await listen<OAuthCodePayload>('trakt-oauth-code', async (event) => {
        unlisten();
        if (event.payload.state !== traktStateRef.current) {
          setTraktError(t('settings.oauth_state_mismatch'));
          setAuthUrl('trakt');
          setTraktBusy(false);
          return;
        }
        traktStateRef.current = null;
        setAuthUrl('trakt');
        try {
          const tokenJson = await invoke<string>('trakt_oauth_exchange', { code: event.payload.code });
          const tokens = JSON.parse(tokenJson) as TraktTokenResponse;
          const updated: UserProfile = { ...activeProfile, traktAccessToken: tokens.access_token, traktRefreshToken: tokens.refresh_token, traktTokenExpiresAt: tokens.created_at + tokens.expires_in };
          await saveProfile(updated);
          onProfileUpdated(updated);
        } catch (err) {
          setTraktError(err instanceof Error ? err.message : String(err));
        } finally {
          setTraktBusy(false);
        }
      });
    } catch (err) {
      setTraktError(err instanceof Error ? err.message : String(err));
      setAuthUrl('trakt');
      setTraktBusy(false);
    }
  };

  const handleTraktDisconnect = async () => {
    if (!activeProfile) return;
    const updated: UserProfile = { ...activeProfile, traktAccessToken: undefined, traktRefreshToken: undefined, traktTokenExpiresAt: undefined };
    await saveProfile(updated);
    onProfileUpdated(updated);
  };

  const handleAnilistConnect = async () => {
    if (!activeProfile || anilistBusy) return;
    setAnilistBusy(true);
    setAnilistError(null);
    try {
      const anilistClientId = await invoke<string>('get_oauth_client_id', { service: 'anilist' });
      if (!anilistClientId) {
        setAnilistError('FLUXA_ANILIST_CLIENT_ID is not set.');
        setAnilistBusy(false);
        return;
      }
      const state = generateCodeVerifier();
      anilistStateRef.current = state;
      const authUrl = `https://anilist.co/api/v2/oauth/authorize?response_type=code&client_id=${anilistClientId}&redirect_uri=${encodeURIComponent('fluxa://oauth/anilist')}&state=${state}`;
      setAuthUrl('anilist', authUrl);
      await shellOpen(authUrl);

      const unlisten = await listen<OAuthCodePayload>('anilist-oauth-code', async (event) => {
        unlisten();
        if (event.payload.state !== anilistStateRef.current) {
          setAnilistError(t('settings.oauth_state_mismatch'));
          setAuthUrl('anilist');
          setAnilistBusy(false);
          return;
        }
        anilistStateRef.current = null;
        setAuthUrl('anilist');
        try {
          const tokenJson = await invoke<string>('anilist_oauth_exchange', { code: event.payload.code });
          const tokens = JSON.parse(tokenJson) as { access_token: string; refresh_token?: string; expires_in?: number };
          const updated: UserProfile = {
            ...activeProfile,
            anilistAccessToken: tokens.access_token,
            anilistRefreshToken: tokens.refresh_token,
            anilistTokenExpiresAt: tokens.expires_in ? Math.floor(Date.now() / 1000) + tokens.expires_in : undefined,
          };
          await saveProfile(updated);
          onProfileUpdated(updated);
        } catch (err) {
          setAnilistError(err instanceof Error ? err.message : String(err));
        } finally {
          setAnilistBusy(false);
        }
      });
    } catch (err) {
      setAnilistError(err instanceof Error ? err.message : String(err));
      setAuthUrl('anilist');
      setAnilistBusy(false);
    }
  };

  const handleAnilistDisconnect = async () => {
    if (!activeProfile) return;
    setAnilistPopoverOpen(false);
    const updated: UserProfile = {
      ...activeProfile,
      anilistAccessToken: undefined,
      anilistRefreshToken: undefined,
      anilistTokenExpiresAt: undefined,
    };
    await saveProfile(updated);
    onProfileUpdated(updated);
  };

  const handleSimklConnect = async () => {
    if (!activeProfile || simklBusy) return;
    setSimklBusy(true);
    setSimklError(null);
    try {
      const simklClientId = await invoke<string>('get_oauth_client_id', { service: 'simkl' });
      if (!simklClientId) {
        setSimklError('FLUXA_SIMKL_CLIENT_ID is not set.');
        setSimklBusy(false);
        return;
      }
      const state = generateCodeVerifier();
      simklStateRef.current = state;
      const authUrl = `https://simkl.com/oauth/authorize?response_type=code&client_id=${simklClientId}&redirect_uri=${encodeURIComponent('fluxa://oauth/simkl')}&state=${state}`;
      setAuthUrl('simkl', authUrl);
      await shellOpen(authUrl);

      const unlisten = await listen<OAuthCodePayload>('simkl-oauth-code', async (event) => {
        unlisten();
        if (event.payload.state !== simklStateRef.current) {
          setSimklError(t('settings.oauth_state_mismatch'));
          setAuthUrl('simkl');
          setSimklBusy(false);
          return;
        }
        simklStateRef.current = null;
        setAuthUrl('simkl');
        try {
          const tokenJson = await invoke<string>('simkl_oauth_exchange', { code: event.payload.code });
          const tokens = JSON.parse(tokenJson) as { access_token: string; refresh_token?: string };
          const updated: UserProfile = { ...activeProfile, simklAccessToken: tokens.access_token, simklRefreshToken: tokens.refresh_token };
          await saveProfile(updated);
          onProfileUpdated(updated);
        } catch (err) {
          setSimklError(err instanceof Error ? err.message : String(err));
        } finally {
          setSimklBusy(false);
        }
      });
    } catch (err) {
      setSimklError(err instanceof Error ? err.message : String(err));
      setAuthUrl('simkl');
      setSimklBusy(false);
    }
  };

  const handleSimklDisconnect = async () => {
    if (!activeProfile) return;
    setSimklPopoverOpen(false);
    const updated: UserProfile = { ...activeProfile, simklAccessToken: undefined, simklRefreshToken: undefined };
    await saveProfile(updated);
    onProfileUpdated(updated);
  };

  const handleTraktSyncNow = async () => {
    if (!activeProfile?.traktAccessToken) return;
    setTraktBusy(true);
    setTraktError(null);
    try {
      const traktClientId = await invoke<string>('get_oauth_client_id', { service: 'trakt' });
      const result = await syncExternalIntegrationNow({
        provider: 'trakt',
        profile: activeProfile,
        token: activeProfile.traktAccessToken,
        clientId: traktClientId,
      }) as { synced?: boolean; error?: string; continueWatchingCount?: number; watchlistCount?: number };
      if (!result.synced) {
        setTraktError(result.error ?? t('toast.trakt_sync_failed'));
      } else {
        const meta: SyncMeta = { lastSyncAt: Date.now(), continueWatchingCount: result.continueWatchingCount ?? 0, watchlistCount: result.watchlistCount ?? 0 };
        setTraktSyncMeta(meta);
        await storageWrite('trakt_sync_meta', meta);
      }
    } catch (error) {
      setTraktError(error instanceof Error ? error.message : String(error));
    } finally {
      setTraktBusy(false);
    }
    onDispatch(JSON.stringify({ type: 'libraryHydrateRequested' }));
    onDispatch(JSON.stringify({ type: 'homeLoadRequested', force: true, language: prefs.language }));
  };

  const handleSimklSyncNow = async () => {
    if (!activeProfile?.simklAccessToken) return;
    setSimklBusy(true);
    setSimklError(null);
    try {
      const simklClientId = await invoke<string>('get_oauth_client_id', { service: 'simkl' });
      const result = await syncExternalIntegrationNow({
        provider: 'simkl',
        profile: activeProfile,
        token: activeProfile.simklAccessToken,
        clientId: simklClientId,
      }) as { synced?: boolean; error?: string; continueWatchingCount?: number; watchlistCount?: number };
      if (!result.synced) {
        setSimklError(result.error ?? 'Simkl sync failed');
      } else {
        const meta: SyncMeta = { lastSyncAt: Date.now(), continueWatchingCount: result.continueWatchingCount ?? 0, watchlistCount: result.watchlistCount ?? 0 };
        setSimklSyncMeta(meta);
        await storageWrite('simkl_sync_meta', meta);
      }
    } catch (error) {
      setSimklError(error instanceof Error ? error.message : String(error));
    } finally {
      setSimklBusy(false);
    }
    onDispatch(JSON.stringify({ type: 'libraryHydrateRequested' }));
    onDispatch(JSON.stringify({ type: 'homeLoadRequested', force: true, language: prefs.language }));
  };

  const handleAnilistSyncNow = async () => {
    if (!activeProfile?.anilistAccessToken) return;
    setAnilistBusy(true);
    setAnilistError(null);
    try {
      const updated = await refreshAnimeTrackingProfile(activeProfile);
      if (updated !== activeProfile) onProfileUpdated(updated);
      const result = await syncExternalIntegrationNow({
        provider: 'anilist',
        profile: updated,
        token: updated.anilistAccessToken,
      }) as { synced?: boolean; error?: string; continueWatchingCount?: number; watchlistCount?: number };
      if (!result.synced) {
        setAnilistError(result.error ?? 'AniList sync failed');
        return;
      }
      const meta: SyncMeta = { lastSyncAt: Date.now(), continueWatchingCount: result.continueWatchingCount ?? 0, watchlistCount: result.watchlistCount ?? 0 };
      setAnilistSyncMeta(meta);
      await storageWrite('anilist_sync_meta', meta);
    } catch (error) {
      setAnilistError(error instanceof Error ? error.message : String(error));
    } finally {
      setAnilistBusy(false);
    }
    onDispatch(JSON.stringify({ type: 'libraryHydrateRequested' }));
    onDispatch(JSON.stringify({ type: 'homeLoadRequested', force: true, language: prefs.language }));
  };

  return (
    <>
      {activeProfile && (
        <SettingsSection title={t('profiles.active_profile')} subtitle={t('profiles.active_profile_desc')}>
          <SyncServiceRow
            icon={<AvatarPreview profile={activeProfile} size={36} circular />}
            title={activeProfile.name ?? t('auto.profile')}
            value={t('settings.switch_profiles_desc')}
            onClick={onSwitchProfile}
          />
        </SettingsSection>
      )}

      <SettingsSection title={t('settings.sync_with')} subtitle={t('settings.sync_with_desc')}>
        {/* Trakt */}
        {!traktConnected && (
          <SyncServiceRow
            icon={<div style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(237,28,36,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}><img src="/trakt.svg" alt="Trakt" style={{ width: 26, height: 26, objectFit: 'contain' }} /></div>}
            title="Trakt.tv"
            value={traktBusy ? t('trakt.device.waiting') : t('auto.connect_trakt_tv_account')}
            onClick={() => void handleTraktConnect()}
            busy={traktBusy}
          />
        )}
        {!traktConnected && renderOAuthFallback('trakt')}
        {traktError && (
          <div style={{ padding: '0 18px 10px', borderBottom: '1px solid rgba(255,255,255,0.055)' }}>
            <p style={{ color: '#FF5D5D', fontSize: 12, margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Ubuntu", "Noto Sans", sans-serif' }}>{t('common.error')}: {traktError}</p>
          </div>
        )}
        {traktConnected && (
          <div style={{ position: 'relative' }}>
            <SyncServiceRow
              icon={<div style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(237,28,36,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}><img src="/trakt.svg" alt="Trakt" style={{ width: 26, height: 26, objectFit: 'contain' }} /></div>}
              title="Trakt.tv"
              value={traktBusy ? t('trakt.device.syncing') : t('trakt.device.connected')}
              valueColor="#54D17A"
              onClick={() => setTraktPopoverOpen((o) => !o)}
              busy={traktBusy}
              expanded={traktPopoverOpen}
            />
            {traktPopoverOpen && (
              <SyncServicePopover
                serviceName="Trakt.tv"
                meta={traktSyncMeta}
                busy={traktBusy}
                onSyncNow={() => void handleTraktSyncNow()}
                onDisconnect={() => void handleTraktDisconnect()}
                onClose={() => setTraktPopoverOpen(false)}
              />
            )}
          </div>
        )}

        {/* AniList */}
        {!anilistConnected && (
          <SyncServiceRow
            icon={<div style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(2,169,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}><img src="/anilist.svg" alt="AniList" style={{ width: 26, height: 26, objectFit: 'contain' }} /></div>}
            title="AniList"
            value={anilistBusy ? t('trakt.device.waiting') : t('auto.connect_anilist_account')}
            onClick={() => void handleAnilistConnect()}
            busy={anilistBusy}
          />
        )}
        {!anilistConnected && renderOAuthFallback('anilist')}
        {anilistError && (
          <div style={{ padding: '0 18px 10px', borderBottom: '1px solid rgba(255,255,255,0.055)' }}>
            <p style={{ color: '#FF5D5D', fontSize: 12, margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Ubuntu", "Noto Sans", sans-serif' }}>{t('common.error')}: {anilistError}</p>
          </div>
        )}
        {anilistConnected && (
          <div style={{ position: 'relative' }}>
            <SyncServiceRow
              icon={<div style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(2,169,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}><img src="/anilist.svg" alt="AniList" style={{ width: 26, height: 26, objectFit: 'contain' }} /></div>}
              title="AniList"
              value={anilistBusy ? t('trakt.device.syncing') : t('settings.anime_tracking_enabled')}
              valueColor="#54D17A"
              onClick={() => setAnilistPopoverOpen((o) => !o)}
              busy={anilistBusy}
              expanded={anilistPopoverOpen}
            />
            {anilistPopoverOpen && (
              <SyncServicePopover
                serviceName="AniList"
                meta={anilistSyncMeta}
                busy={anilistBusy}
                statusLabel={anilistSyncMeta ? `${t('settings.anime_tracking_enabled')} · ${new Date(anilistSyncMeta.lastSyncAt).toLocaleString()}` : t('settings.anime_tracking_enabled')}
                statusColor="#54D17A"
                syncLabel={t('settings.sync_now')}
                onSyncNow={() => void handleAnilistSyncNow()}
                onDisconnect={() => void handleAnilistDisconnect()}
                onClose={() => setAnilistPopoverOpen(false)}
              />
            )}
          </div>
        )}

        {/* Simkl */}
        {!simklConnected && (
          <SyncServiceRow
            icon={<div style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(28,177,74,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}><img src="/simkl.svg" alt="Simkl" style={{ width: 26, height: 26, objectFit: 'contain' }} /></div>}
            title="Simkl"
            value={simklBusy ? t('trakt.device.waiting') : t('auto.connect_simkl_account')}
            onClick={() => void handleSimklConnect()}
            busy={simklBusy}
          />
        )}
        {!simklConnected && renderOAuthFallback('simkl')}
        {simklError && (
          <div style={{ padding: '0 18px 10px', borderBottom: '1px solid rgba(255,255,255,0.055)' }}>
            <p style={{ color: '#FF5D5D', fontSize: 12, margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Ubuntu", "Noto Sans", sans-serif' }}>{t('common.error')}: {simklError}</p>
          </div>
        )}
        {simklConnected && (
          <div style={{ position: 'relative' }}>
            <SyncServiceRow
              icon={<div style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(28,177,74,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}><img src="/simkl.svg" alt="Simkl" style={{ width: 26, height: 26, objectFit: 'contain' }} /></div>}
              title="Simkl"
              value={simklBusy ? t('trakt.device.syncing') : t('trakt.device.connected')}
              valueColor="#54D17A"
              onClick={() => setSimklPopoverOpen((o) => !o)}
              busy={simklBusy}
              expanded={simklPopoverOpen}
            />
            {simklPopoverOpen && (
              <SyncServicePopover
                serviceName="Simkl"
                meta={simklSyncMeta}
                busy={simklBusy}
                onSyncNow={() => void handleSimklSyncNow()}
                onDisconnect={() => void handleSimklDisconnect()}
                onClose={() => setSimklPopoverOpen(false)}
              />
            )}
          </div>
        )}
      </SettingsSection>
    </>
  );
}

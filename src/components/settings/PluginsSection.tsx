import React from 'react';
import type { PluginRepository, PluginScraper } from '../../core/types';
import { t } from '../../i18n';
import { ExtensionIcon, SettingsSection } from './SettingsUI';
import { FONT } from './settingsStyles';

function Toggle({ enabled, onClick }: { enabled: boolean; onClick: () => void }) {
  return <button onClick={onClick} aria-label={enabled ? t('plugins.disable') : t('plugins.enable')} style={{ width: '2.75rem', height: '1.625rem', borderRadius: '0.8125rem', border: 'none', padding: 0, cursor: 'pointer', background: enabled ? '#fff' : 'rgba(255,255,255,0.14)', position: 'relative', flexShrink: 0 }}>
    <span style={{ position: 'absolute', top: '0.1875rem', left: enabled ? 21 : 3, width: '1.25rem', height: '1.25rem', borderRadius: '50%', background: enabled ? '#111' : 'rgba(255,255,255,0.6)', transition: 'left 0.18s' }} />
  </button>;
}

function IconButton({ title, onClick, destructive = false, children }: { title: string; onClick: () => void; destructive?: boolean; children: React.ReactNode }) {
  return <button title={title} onClick={onClick} style={{ width: '1.875rem', height: '1.875rem', border: 'none', borderRadius: '0.4375rem', padding: 0, background: 'transparent', color: destructive ? 'rgba(255,120,120,0.75)' : 'rgba(255,255,255,0.5)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>{children}</button>;
}

export function PluginsSection({
  pluginUrl, setPluginUrl, repositories, scrapers, loading, error, onInstall, onRemove, onRefresh, onToggleScraper,
}: {
  pluginUrl: string;
  setPluginUrl: (value: string) => void;
  repositories: PluginRepository[];
  scrapers: PluginScraper[];
  loading: boolean;
  error: string | null;
  onInstall: () => void;
  onRemove: (repository: PluginRepository) => void;
  onRefresh: (repository: PluginRepository) => void;
  onToggleScraper: (scraper: PluginScraper) => void;
}) {
  return <>
    <SettingsSection title={t('plugins.install')} subtitle={t('plugins.install_description')}>
      <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.055)' }}>
        <input value={pluginUrl} onChange={(event) => setPluginUrl(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onInstall()} disabled={loading} placeholder={t('plugins.install_placeholder')} style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '0.5rem', padding: '0.6875rem 0.8125rem', color: '#fff', fontSize: '0.8125rem', fontFamily: FONT, outline: 'none', marginBottom: error ? 8 : 10 }} />
        {error && <p style={{ color: '#FF6B6B', fontSize: '0.75rem', margin: '0 0 0.625rem', fontFamily: FONT }}>{error}</p>}
        <button onClick={onInstall} disabled={!pluginUrl.trim() || loading} style={{ background: pluginUrl.trim() && !loading ? '#fff' : 'rgba(255,255,255,0.10)', color: pluginUrl.trim() && !loading ? '#000' : 'rgba(255,255,255,0.35)', border: 'none', borderRadius: '0.5rem', padding: '0.5rem 1.125rem', fontSize: '0.8125rem', fontWeight: 500, fontFamily: FONT, cursor: pluginUrl.trim() && !loading ? 'pointer' : 'default' }}>{loading ? t('plugins.installing') : t('plugins.install')}</button>
      </div>
    </SettingsSection>

    {repositories.length > 0 ? <SettingsSection title={`${t('plugins.installed')} (${repositories.length})`} subtitle={t('plugins.installed_description')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.5rem' }}>
        {repositories.map((repository) => {
          const repoScrapers = scrapers.filter((scraper) => scraper.repositoryUrl === repository.manifestUrl);
          return <div key={repository.manifestUrl} style={{ background: '#1A1A1A', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '0.75rem', overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: '0.6875rem', alignItems: 'center', padding: '0.8125rem' }}>
              <div style={{ width: '2.75rem', height: '2.75rem', borderRadius: '0.625rem', display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.45)', flexShrink: 0 }}><ExtensionIcon /></div>
              <div style={{ flex: 1, minWidth: 0 }}><p style={{ color: 'rgba(255,255,255,0.92)', fontSize: '0.875rem', fontWeight: 600, margin: 0, fontFamily: FONT }}>{repository.name || t('plugins.unnamed')}</p><p style={{ color: 'rgba(255,255,255,0.32)', fontSize: '0.6875rem', margin: '0.125rem 0 0', fontFamily: FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{repository.version || repository.manifestUrl}</p></div>
              <IconButton title={t('common.refresh')} onClick={() => onRefresh(repository)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></IconButton>
              <IconButton title={t('common.forget')} destructive onClick={() => onRemove(repository)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg></IconButton>
            </div>
            {repository.description && <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', lineHeight: 1.5, margin: '0 0.8125rem 0.75rem', fontFamily: FONT }}>{repository.description}</p>}
            {repoScrapers.map((scraper) => <div key={scraper.id} style={{ display: 'flex', gap: '0.625rem', alignItems: 'center', padding: '0.625rem 0.8125rem', borderTop: '1px solid rgba(255,255,255,0.055)', opacity: scraper.enabled ? 1 : 0.5 }}><div style={{ flex: 1, minWidth: 0 }}><p style={{ color: 'rgba(255,255,255,0.78)', fontSize: '0.75rem', margin: 0, fontFamily: FONT }}>{scraper.name}</p><p style={{ color: 'rgba(255,255,255,0.32)', fontSize: '0.6875rem', margin: '0.125rem 0 0', fontFamily: FONT }}>{scraper.supportedTypes?.join(', ') || t('plugins.all_media')}</p></div><Toggle enabled={scraper.enabled} onClick={() => onToggleScraper(scraper)} /></div>)}
          </div>;
        })}
      </div>
    </SettingsSection> : <div style={{ padding: '0.875rem 1rem' }}><p style={{ color: 'rgba(255,255,255,0.32)', fontSize: '0.8125rem', margin: 0, fontFamily: FONT }}>{t('plugins.none')}</p></div>}
  </>;
}

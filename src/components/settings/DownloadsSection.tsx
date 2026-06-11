import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { t } from '../../i18n';
import { ChoiceTile, InputTile, SettingsSection, streamSourceOptions } from './SettingsUI';
import { styles, FONT } from './settingsStyles';
import type { Prefs } from './settingsTypes';

interface OfflineDownloadItem {
  id: string;
  videoFileName: string;
  path: string;
  sizeBytes: number;
  status: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  );
}

function DownloadItemRow({ item, onDelete }: { item: OfflineDownloadItem; onDelete: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [deleteHovered, setDeleteHovered] = useState(false);

  return (
    <div
      style={{
        width: '100%',
        borderBottom: '1px solid rgba(255,255,255,0.055)',
        background: hovered ? 'rgba(255,255,255,0.03)' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        padding: '13px 16px',
        boxSizing: 'border-box',
        gap: 12,
        transition: 'background 0.15s',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ ...styles.rowTitle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.videoFileName}
        </p>
        <p style={styles.rowSubtitle}>{formatBytes(item.sizeBytes)}</p>
      </div>
      <button
        style={{
          background: deleteHovered ? 'rgba(255,80,80,0.12)' : 'transparent',
          border: 'none',
          color: deleteHovered ? 'rgba(255,120,120,0.9)' : 'rgba(255,255,255,0.25)',
          cursor: 'pointer',
          padding: 7,
          borderRadius: 7,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'background 0.12s, color 0.12s',
          opacity: hovered ? 1 : 0,
        }}
        onMouseEnter={() => setDeleteHovered(true)}
        onMouseLeave={() => setDeleteHovered(false)}
        onClick={onDelete}
        aria-label={t('common.delete')}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function RefreshButton({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={t('common.refresh')}
      style={{
        background: hovered ? 'rgba(255,255,255,0.08)' : 'transparent',
        border: 'none',
        color: hovered ? '#FFFFFF' : 'rgba(255,255,255,0.35)',
        cursor: 'pointer',
        padding: 6,
        borderRadius: 7,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.12s, color 0.12s',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
      </svg>
    </button>
  );
}

function DownloadDirRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const [btnHovered, setBtnHovered] = useState(false);
  const [defaultDir, setDefaultDir] = useState('');

  useEffect(() => {
    invoke<string | null>('get_data_dir')
      .then((d) => { if (d) setDefaultDir(`${d}/offline`); })
      .catch(() => {});
  }, []);

  const pick = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === 'string' && selected) onChange(selected);
  };

  const effectivePath = value || defaultDir;
  const displayPath = effectivePath || t('settings.download_dir_default');

  return (
    <div
      style={{
        width: '100%',
        borderBottom: '1px solid rgba(255,255,255,0.055)',
        background: hovered ? 'rgba(255,255,255,0.03)' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        padding: '12px 16px',
        boxSizing: 'border-box',
        gap: 16,
        transition: 'background 0.12s',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={styles.rowTitle}>{t('settings.download_dir')}</p>
        <p style={styles.rowSubtitle}>{t('settings.download_dir_desc')}</p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span
          style={{
            color: 'rgba(255,255,255,0.38)',
            fontSize: 12,
            fontFamily: FONT,
            maxWidth: 340,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={effectivePath || undefined}
        >
          {displayPath}
        </span>
        <button
          onClick={pick}
          onMouseEnter={() => setBtnHovered(true)}
          onMouseLeave={() => setBtnHovered(false)}
          style={{
            height: 32,
            padding: '0 14px',
            background: btnHovered ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)',
            border: 'none',
            outline: 'none',
            borderRadius: 8,
            color: '#FFFFFF',
            fontSize: 12,
            fontWeight: 500,
            fontFamily: FONT,
            cursor: 'pointer',
            transition: 'background 0.12s',
            whiteSpace: 'nowrap',
          }}
        >
          {t('settings.download_dir_browse')}
        </button>
        {value && (
          <button
            onClick={() => onChange('')}
            title={t('common.delete')}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.28)',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 5,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

export function DownloadsSection({ prefs, setPref }: { prefs: Prefs; setPref: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void }) {
  const [downloads, setDownloads] = useState<OfflineDownloadItem[]>([]);

  useEffect(() => {
    invoke('set_download_dir', { path: prefs.downloadDir || null }).catch(() => {});
  }, [prefs.downloadDir]);

  const refreshDownloads = () => {
    invoke<OfflineDownloadItem[]>('list_offline_downloads')
      .then(setDownloads)
      .catch(() => setDownloads([]));
  };

  useEffect(() => { refreshDownloads(); }, []);

  const handleDelete = async (item: OfflineDownloadItem) => {
    try {
      await invoke('delete_offline_download', { fileName: item.videoFileName });
      refreshDownloads();
    } catch { /* ignore */ }
  };

  const totalSize = downloads.reduce((acc, d) => acc + d.sizeBytes, 0);

  return (
    <>
      <SettingsSection title={t('auto.downloads')} subtitle={t('settings.downloads_desc')}>
        <DownloadDirRow
          value={prefs.downloadDir}
          onChange={(v) => setPref('downloadDir', v)}
        />
        <ChoiceTile
          title={t('settings.download_source_selection')}
          subtitle={t('settings.download_source_selection_desc')}
          options={streamSourceOptions()}
          selected={prefs.downloadSourceSelectionMode}
          onSelect={(v) => setPref('downloadSourceSelectionMode', v)}
        />
        {prefs.downloadSourceSelectionMode === 'regex' && (
          <InputTile
            title={t('settings.regex_pattern')}
            subtitle={t('settings.regex_pattern_desc')}
            value={prefs.downloadSourceRegexPattern}
            placeholder={t('settings.regex_pattern_placeholder')}
            onChange={(v) => setPref('downloadSourceRegexPattern', v)}
          />
        )}
        <ChoiceTile
          title={t('settings.download_subtitle')}
          subtitle={t('settings.download_subtitle_desc')}
          options={[
            { value: 'off', label: t('settings.download_subtitle_off') },
            { value: 'preferred', label: t('settings.download_subtitle_preferred') },
          ]}
          selected={prefs.downloadSubtitleLanguage}
          onSelect={(v) => setPref('downloadSubtitleLanguage', v)}
        />
      </SettingsSection>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
        <div style={{ paddingLeft: 4, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <p style={styles.groupTitle}>{t('settings.downloads_list_desc')}</p>
            {downloads.length > 0 && (
              <p style={styles.groupSubtitle}>{t('downloads.storage_summary', downloads.length, formatBytes(totalSize))}</p>
            )}
          </div>
          <RefreshButton onClick={refreshDownloads} />
        </div>

        <div style={styles.settingsCard}>
          {downloads.length === 0 ? (
            <div style={{ padding: '28px 16px', textAlign: 'center' }}>
              <p style={{ color: 'rgba(255,255,255,0.30)', fontSize: 13, margin: 0, fontFamily: FONT }}>{t('downloads.empty')}</p>
            </div>
          ) : (
            downloads.map((item) => (
              <DownloadItemRow key={item.id} item={item} onDelete={() => void handleDelete(item)} />
            ))
          )}
        </div>
      </div>
    </>
  );
}

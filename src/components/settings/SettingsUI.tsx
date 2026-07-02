import React, { useEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import {
  ArrowLeft,
  Download,
  HardDrive,
  Palette,
  PlayCircle,
  Puzzle,
  RefreshCw,
  Settings,
  User,
} from 'lucide-react';
import { t } from '../../i18n';
import { styles, FONT } from './settingsStyles';
import type { SyncMeta } from './settingsTypes';

export function AccountIcon() {
  return <User size={22} />;
}
export function PaletteIcon() {
  return <Palette size={22} />;
}
export function PlayCircleIcon() {
  return <PlayCircle size={22} />;
}
export function ExtensionIcon() {
  return <Puzzle size={22} />;
}
export function SettingsIcon() {
  return <Settings size={22} />;
}
export function ArrowBackIcon() {
  return <ArrowLeft size={22} />;
}
export function StorageIcon() {
  return <HardDrive size={22} />;
}
export function DownloadIcon() {
  return <Download size={22} />;
}
export function RefreshIcon() {
  return <RefreshCw size={22} />;
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m !== 1 ? 's' : ''} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h !== 1 ? 's' : ''} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d !== 1 ? 's' : ''} ago`;
  return `${Math.floor(d / 7)} week${Math.floor(d / 7) !== 1 ? 's' : ''} ago`;
}

export function langOptions() {
  return [
    { value: 'none', label: t('settings.none') },
    { value: 'tr', label: t('language.turkish') },
    { value: 'en', label: t('language.english') },
    { value: 'ja', label: t('language.japanese') },
    { value: 'ko', label: t('language.korean') },
    { value: 'zh', label: t('language.chinese') },
    { value: 'de', label: t('language.german') },
    { value: 'fr', label: t('language.french') },
    { value: 'es', label: t('language.spanish') },
    { value: 'it', label: t('language.italian') },
    { value: 'pt', label: t('language.portuguese') },
    { value: 'ru', label: t('language.russian') },
    { value: 'ar', label: t('language.arabic') },
    { value: 'hi', label: t('language.hindi') },
  ];
}

export function streamSourceOptions() {
  return [
    { value: 'first', label: t('settings.stream_source_first_available') },
    { value: 'manual', label: t('settings.stream_source_manual') },
    { value: 'regex', label: t('settings.stream_source_regex_short') },
  ];
}

export function isFeedEnabled(selected: string[], key: string): boolean {
  return selected.length === 0 || selected.includes(key);
}

export function SidebarItem({
  label,
  subtitle,
  icon,
  selected,
  onClick,
}: {
  label: string;
  subtitle?: string;
  icon: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      style={{
        width: '100%',
        minHeight: 46,
        background: selected
          ? 'rgba(255,255,255,0.08)'
          : hovered
          ? 'rgba(255,255,255,0.04)'
          : 'transparent',
        color: '#FFFFFF',
        border: 'none',
        borderRadius: 9,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 12px',
        fontFamily: FONT,
        transition: 'background 0.12s',
        textAlign: 'left',
        flexShrink: 0,
        position: 'relative',
        outline: 'none',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {selected && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 3,
          height: 18,
          borderRadius: '0 2px 2px 0',
          background: '#FFFFFF',
        }} />
      )}
      <span style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        width: 22,
        height: 22,
        color: selected ? '#FFFFFF' : 'rgba(255,255,255,0.40)',
        transition: 'color 0.12s',
      }}>
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: 'block',
          fontSize: 14,
          fontWeight: selected ? 600 : 500,
          color: selected ? '#FFFFFF' : 'rgba(255,255,255,0.65)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          transition: 'color 0.12s',
        }}>
          {label}
        </span>
        {subtitle && (
          <span style={{
            display: 'block',
            fontSize: 11,
            color: 'rgba(255,255,255,0.30)',
            marginTop: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {subtitle}
          </span>
        )}
      </span>
    </button>
  );
}

export function SettingsDetailHeader({ title }: { title: string }) {
  return (
    <div style={styles.detailHeader}>
      <p style={styles.detailTitle}>{title}</p>
    </div>
  );
}

export function SidebarDivider() {
  return <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '10px 0' }} />;
}

export function SettingsSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div style={styles.settingsGroup}>
      <div style={styles.groupHeading}>
        <p style={styles.groupTitle}>{title}</p>
        {subtitle && <p style={styles.groupSubtitle}>{subtitle}</p>}
      </div>
      <div style={styles.settingsCard}>{children}</div>
    </div>
  );
}

export function SettingsPanel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: '100%',
        boxSizing: 'border-box',
        borderRadius: 0,
        background: 'transparent',
        borderBottom: '1px solid rgba(255,255,255,0.055)',
        padding: '14px 16px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{children}</div>
    </div>
  );
}

export function SliderTile({
  title,
  subtitle,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  title: string;
  subtitle: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const label = format ? format(value) : `${value}%`;
  return (
    <div
      style={{
        width: '100%',
        borderBottom: '1px solid rgba(255,255,255,0.055)',
        padding: '14px 16px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ flex: 1, paddingRight: 12, minWidth: 0 }}>
          <p style={styles.rowTitle}>{title}</p>
          <p style={styles.rowSubtitle}>{subtitle}</p>
        </div>
        <span style={{ color: 'var(--primary-accent-color)', fontSize: 13, fontWeight: 600, fontFamily: FONT, flexShrink: 0, minWidth: 38, textAlign: 'right' }}>
          {label}
        </span>
      </div>
      <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.10)' }} />
        <div style={{ position: 'absolute', left: 0, width: `${pct}%`, height: 3, borderRadius: 2, background: 'var(--primary-accent-color)', transition: 'width 0.05s' }} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ position: 'absolute', left: 0, right: 0, width: '100%', margin: 0, opacity: 0, cursor: 'pointer', height: 20 }}
        />
        <div
          style={{
            position: 'absolute',
            left: `calc(${pct}% - 8px)`,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: 'var(--primary-accent-color)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
            transition: 'left 0.05s',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}

export function ToggleTile({
  title,
  subtitle,
  checked,
  onToggle,
}: {
  title: string;
  subtitle: string;
  checked: boolean;
  onToggle: (v: boolean) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        width: '100%',
        minHeight: 60,
        borderRadius: 0,
        background: hovered ? 'rgba(255,255,255,0.03)' : 'transparent',
        border: 'none',
        borderBottom: '1px solid rgba(255,255,255,0.055)',
        display: 'flex',
        alignItems: 'center',
        padding: '12px 16px',
        boxSizing: 'border-box',
        justifyContent: 'space-between',
        cursor: 'pointer',
        transition: 'background 0.12s',
      }}
      onClick={() => onToggle(!checked)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ flex: 1, paddingRight: 16 }}>
        <p style={styles.rowTitle}>{title}</p>
        <p style={styles.rowSubtitle}>{subtitle}</p>
      </div>
      <div
        onClick={(e) => { e.stopPropagation(); onToggle(!checked); }}
        style={{ flexShrink: 0, width: 44, height: 26, borderRadius: 999, background: checked ? 'var(--primary-accent-color)' : 'rgba(255,255,255,0.14)', position: 'relative', transition: 'background 0.18s', cursor: 'pointer', boxSizing: 'border-box' }}
      >
        <div style={{ position: 'absolute', top: 3, left: checked ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: checked ? '#000000' : 'rgba(255,255,255,0.80)', transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }} />
      </div>
    </div>
  );
}

export function ChoiceTile({
  title,
  subtitle,
  options,
  selected,
  onSelect,
}: {
  title: string;
  subtitle: string;
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (v: string) => void;
}) {
  const selectedLabel = options.find((opt) => opt.value === selected)?.label ?? selected;
  return (
    <div style={{
      width: '100%',
      minHeight: 60,
      borderBottom: '1px solid rgba(255,255,255,0.055)',
      display: 'flex',
      alignItems: 'center',
      padding: '12px 16px',
      boxSizing: 'border-box',
      gap: 16,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={styles.rowTitle}>{title}</p>
        <p style={styles.rowSubtitle}>{subtitle}</p>
      </div>
      <Dropdown
        ariaLabel={`${title}: ${selectedLabel}`}
        options={options}
        selected={selected}
        onSelect={onSelect}
      />
    </div>
  );
}

export function Dropdown({
  ariaLabel,
  options,
  selected,
  onSelect,
}: {
  ariaLabel: string;
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selectedLabel = options.find((opt) => opt.value === selected)?.label ?? selected;

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    return () => document.removeEventListener('mousedown', handlePointer);
  }, [open]);

  return (
    <div ref={ref} style={{ ...styles.dropdownWrap, zIndex: open ? 1000 : 2 }}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        style={{
          ...styles.dropdownButton,
          borderColor: open ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.10)',
          background: '#1A1A1A',
        }}
        onClick={() => setOpen((value) => !value)}
      >
        <span style={styles.dropdownValue}>{selectedLabel}</span>
        <span style={{ ...styles.dropdownIcon, transform: open ? 'rotate(180deg)' : 'none' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 10l5 5 5-5z" />
          </svg>
        </span>
      </button>
      {open && (
        <div style={{ ...styles.dropdownMenu, zIndex: 1001 }}>
          {options.map((option) => {
            const active = option.value === selected;
            return (
              <button
                key={option.value}
                type="button"
                style={{
                  ...styles.dropdownItem,
                  background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: active ? '#FFFFFF' : 'rgba(255,255,255,0.72)',
                }}
                onClick={() => { onSelect(option.value); setOpen(false); }}
              >
                <span style={styles.dropdownItemLabel}>{option.label}</span>
                {active && (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                    <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function InputTile({
  title,
  subtitle,
  value,
  placeholder,
  multiline,
  onChange,
  status,
}: {
  title: string;
  subtitle: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  onChange: (v: string) => void;
  status?: React.ReactNode;
}) {
  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.045)',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: 8,
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: FONT,
    padding: '10px 12px',
    outline: 'none',
    resize: 'vertical',
    lineHeight: '1.5',
  };
  return (
    <div style={{
      width: '100%',
      borderBottom: '1px solid rgba(255,255,255,0.055)',
      padding: '14px 16px',
      boxSizing: 'border-box',
    }}>
      <p style={styles.rowTitle}>{title}</p>
      <p style={{ ...styles.rowSubtitle, marginBottom: 10 }}>{subtitle}</p>
      {multiline ? (
        <textarea value={value} placeholder={placeholder} rows={5} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
      ) : (
        <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
      )}
      {status}
    </div>
  );
}

export function ActionTile({
  title,
  subtitle,
  icon,
  onClick,
  accent = '#FFFFFF',
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  onClick?: () => void;
  accent?: string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        width: '100%',
        minHeight: 58,
        borderRadius: 0,
        border: 'none',
        borderBottom: '1px solid rgba(255,255,255,0.055)',
        background: hovered
          ? accent === '#FFFFFF'
            ? 'rgba(255,255,255,0.03)'
            : `${accent}18`
          : 'transparent',
        display: 'flex',
        alignItems: 'center',
        padding: '12px 16px',
        boxSizing: 'border-box',
        gap: 12,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.12s',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ ...styles.rowIcon, color: accent }}>{icon}</span>
      <div>
        <p style={{ ...styles.rowTitle, color: accent }}>{title}</p>
        <p style={styles.rowSubtitle}>{subtitle}</p>
      </div>
    </div>
  );
}

export function InfoTile({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
  return (
    <div style={{
      width: '100%',
      minHeight: 60,
      borderBottom: '1px solid rgba(255,255,255,0.055)',
      display: 'flex',
      alignItems: 'center',
      padding: '12px 16px',
      boxSizing: 'border-box',
      gap: 12,
    }}>
      <span style={styles.rowIcon}>{icon}</span>
      <div>
        <p style={styles.rowTitle}>{title}</p>
        <p style={styles.rowSubtitle}>{value}</p>
      </div>
    </div>
  );
}

export function SyncServiceRow({
  icon,
  title,
  value,
  valueColor,
  onClick,
  destructive = false,
  busy = false,
  expanded,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  valueColor?: string;
  onClick?: () => void;
  destructive?: boolean;
  busy?: boolean;
  expanded?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        width: '100%',
        minHeight: 62,
        borderBottom: '1px solid rgba(255,255,255,0.055)',
        background: hovered && onClick ? (destructive ? 'rgba(255,80,80,0.05)' : 'rgba(255,255,255,0.03)') : 'transparent',
        display: 'flex',
        alignItems: 'center',
        padding: '12px 16px',
        boxSizing: 'border-box',
        gap: 12,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.12s',
        opacity: busy ? 0.55 : 1,
      }}
      onClick={busy ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ color: destructive ? '#FF5A5A' : 'rgba(255,255,255,0.90)', fontSize: 14, fontWeight: 600, margin: 0, fontFamily: FONT, lineHeight: 1.25 }}>
          {title}
        </p>
        {value && (
          <p style={{ color: valueColor ?? 'rgba(255,255,255,0.40)', fontSize: 12, margin: '2px 0 0', fontFamily: FONT, lineHeight: '15px', fontWeight: 400 }}>
            {value}
          </p>
        )}
      </div>
      {onClick && (
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="rgba(255,255,255,0.22)"
          style={expanded === undefined ? undefined : { transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.14s' }}
        >
          <path d={expanded === undefined ? 'm9 18 6-6-6-6v12z' : 'M7 10l5 5 5-5z'} />
        </svg>
      )}
    </div>
  );
}

export function SyncServicePopover({
  serviceName,
  meta,
  busy,
  statusLabel,
  statusColor,
  syncLabel,
  onSyncNow,
  onDisconnect,
  onClose,
}: {
  serviceName: string;
  meta: SyncMeta | null;
  busy: boolean;
  statusLabel?: string;
  statusColor?: string;
  syncLabel?: string;
  onSyncNow: () => void;
  onDisconnect: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handlePointer);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const isOutOfSync = !meta || Date.now() - meta.lastSyncAt > 6 * 60 * 60 * 1000;
  const effectiveStatus = statusLabel ?? `${isOutOfSync ? t('settings.out_of_sync') : t('settings.synced')}${meta ? ` · ${timeAgo(meta.lastSyncAt)}` : ''}`;
  const effectiveStatusColor = statusColor ?? (isOutOfSync ? '#FF9500' : '#54D17A');
  const counts = [
    meta && meta.continueWatchingCount > 0 ? `${meta.continueWatchingCount} ${t('auto.continue_watching')}` : null,
    meta && meta.watchlistCount > 0 ? `${meta.watchlistCount} ${t('settings.watchlist')}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div ref={ref} style={{ ...styles.dropdownMenu, top: 'calc(100% + 5px)', padding: 0, zIndex: 30 }}>
      <div style={{ padding: '11px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: effectiveStatusColor, flexShrink: 0 }} />
          <span style={{ color: effectiveStatusColor, fontSize: 12, fontWeight: 500, fontFamily: FONT }}>{effectiveStatus}</span>
        </div>
        {counts && <p style={{ ...styles.rowSubtitle, marginTop: 4 }}>{counts}</p>}
      </div>
      <PopoverActionButton
        label={busy ? '…' : syncLabel ?? t('settings.sync_now')}
        onClick={() => { onSyncNow(); onClose(); }}
        disabled={busy}
      />
      <PopoverActionButton
        label={t('auto.disconnect')}
        onClick={() => { onDisconnect(); onClose(); }}
        color="#FF5A5A"
      />
    </div>
  );
}

function PopoverActionButton({
  label,
  onClick,
  disabled = false,
  color = 'rgba(255,255,255,0.85)',
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  color?: string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...styles.dropdownItem,
        justifyContent: 'flex-start',
        color,
        background: hovered && !disabled ? 'rgba(255,255,255,0.06)' : 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

export function VersionFooter() {
  const [version, setVersion] = useState('');
  useEffect(() => { getVersion().then((v) => setVersion(v)).catch(() => {}); }, []);
  return <p style={styles.versionFooter}>{version ? `v${version}` : ''}</p>;
}

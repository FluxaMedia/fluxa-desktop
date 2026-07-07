import { invoke } from '@tauri-apps/api/core';

export function configureDiscordPresence(enabled: boolean): void {
  void invoke('discord_presence_configure', { enabled }).catch(() => undefined);
}

export function updateDiscordPresence(opts: {
  title: string;
  detail?: string;
  paused: boolean;
  startUnixSecs?: number;
  posterUrl?: string;
}): void {
  void invoke('discord_presence_update', {
    title: opts.title,
    detail: opts.detail,
    paused: opts.paused,
    startUnixSecs: opts.startUnixSecs ?? null,
    posterUrl: opts.posterUrl ?? null,
  }).catch(() => undefined);
}

export function setViewingDiscordPresence(opts: { title: string; posterUrl?: string }): void {
  void invoke('discord_presence_set_viewing', {
    title: opts.title,
    posterUrl: opts.posterUrl ?? null,
  }).catch(() => undefined);
}

export function setIdleDiscordPresence(): void {
  void invoke('discord_presence_set_idle').catch(() => undefined);
}

export function clearDiscordPresence(): void {
  void invoke('discord_presence_clear').catch(() => undefined);
}

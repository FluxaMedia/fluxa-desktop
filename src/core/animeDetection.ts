import type { Meta } from './types';

const ANIME_ID_PREFIXES = ['kitsu:', 'mal:', 'anilist:', 'anidb:'];
const ANIME_LINK_HOSTS = ['anilist.co', 'myanimelist.net', 'kitsu.io', 'anidb.net'];

export function isAnimeItem(meta: Pick<Meta, 'id' | 'type' | 'genres' | 'links'>): boolean {
  if (normalize(meta.type ?? '') === 'anime') return true;
  const id = (meta.id ?? '').toLowerCase();
  if (ANIME_ID_PREFIXES.some((prefix) => id.startsWith(prefix))) return true;
  if ((meta.genres ?? []).some((genre) => normalize(genre) === 'anime')) return true;
  const linkText = (meta.links ?? []).map((link) => `${link.name} ${link.category} ${link.url}`).join(' ');
  return matchesAny(linkText, ANIME_LINK_HOSTS);
}

export type LibraryContentType = 'movie' | 'series' | 'anime';

export function libraryContentType(meta: Pick<Meta, 'id' | 'type' | 'genres' | 'links'>): LibraryContentType {
  if (isAnimeItem(meta)) return 'anime';
  return normalize(meta.type ?? '') === 'movie' ? 'movie' : 'series';
}

function matchesAny(value: string, needles: string[]): boolean {
  const normalized = normalize(value);
  return needles.some((needle) => normalized.includes(normalize(needle)));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_./:[\](){}-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

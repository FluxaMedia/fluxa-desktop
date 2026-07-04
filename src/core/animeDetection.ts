import type { AddonDescriptor, Meta, Stream, Video } from './types';

export type AnimeDetection = {
  isAnime: boolean;
  confidence: number;
  reasons: string[];
};

const HIGH_CONFIDENCE_THRESHOLD = 80;

const ANIME_PROVIDER_PATTERNS = [
  'anime',
  'anilist',
  'ani-list',
  'myanimelist',
  'mal',
  'kitsu',
  'anidb',
  'jikan',
  'aniskip',
];

const ANIME_RELEASE_PATTERNS = [
  'subsplease',
  'erai-raws',
  'horriblesubs',
  'commie',
  'judas',
  'ember',
  'anime time',
  'animepahe',
  'nyaa',
];

export function detectAnimePlayback(
  meta?: Meta,
  episode?: Video | null,
  stream?: Stream,
  addons: AddonDescriptor[] = [],
): AnimeDetection {
  const reasons: string[] = [];
  let confidence = 0;
  const add = (score: number, reason: string) => {
    confidence += score;
    reasons.push(reason);
  };

  const textFields = [
    meta?.id,
    meta?.name,
    episode?.id,
    episode?.title,
    episode?.name,
    stream?.addonName,
    stream?.name,
    stream?.title,
    stream?.description,
    stream?.behaviorHints?.filename,
    ...(stream?.sources ?? []),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  const linkText = (meta?.links ?? [])
    .map((link) => `${link.name} ${link.category} ${link.url}`)
    .join(' ');
  if (matchesAny(linkText, ['anilist.co', 'myanimelist.net', 'kitsu.io', 'anidb.net'])) {
    add(100, 'anime external link');
  }

  const genres = meta?.genres ?? [];
  if (genres.some((genre) => normalize(genre) === 'anime')) {
    add(65, 'anime genre');
  }

  const allText = textFields.join(' ');
  if (matchesAny(allText, ANIME_PROVIDER_PATTERNS)) {
    add(85, 'anime provider or source text');
  }
  if (matchesAny(allText, ANIME_RELEASE_PATTERNS)) {
    add(30, 'anime release group or filename');
  }

  const addonText = addons
    .flatMap((addon) => [
      addon.id,
      addon.name,
      addon.manifest?.id,
      addon.manifest?.name,
      addon.transportUrl,
      ...(addon.types ?? []),
      ...(addon.catalogs ?? []).flatMap((catalog) => [catalog.id, catalog.name, catalog.type]),
    ])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
  if (stream?.addonName && matchesAny(addonText, ANIME_PROVIDER_PATTERNS) && matchesAny(stream.addonName, ANIME_PROVIDER_PATTERNS)) {
    add(85, 'anime addon');
  }

  if (
    genres.some((genre) => normalize(genre) === 'animation')
    && matchesAny(allText, ['japanese', 'japan', 'jpn', 'dual audio', 'japanese audio'])
  ) {
    add(45, 'animation with Japanese signal');
  }

  const clamped = Math.min(100, confidence);
  return {
    isAnime: clamped >= HIGH_CONFIDENCE_THRESHOLD,
    confidence: clamped,
    reasons,
  };
}

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
